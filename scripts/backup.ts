#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * پشتیبان‌گیری سازگار از پایگاه‌دادهٔ SQLite — با روش VACUUM INTO
 *
 * چرا این روش؟
 * - کپی خام فایل .db در حین نوشتن سرویس ناسازگار است؛ VACUUM INTO یک snapshot
 *   تراکنشیِ کامل می‌سازد (شامل محتوای journal/WAL تا لحظهٔ snapshot) و
 *   منبع را تغییر نمی‌دهد — حتی اگر منبع فقط-خواندنی باز شود.
 * - رسانه‌ها به‌صورت base64 داخل خود پایگاه‌داده ذخیره می‌شوند؛ پس پشتیبانِ
 *   فایل .db، کل سیستم (محتوا + رسانه‌ها) را یک‌جا و سازگار زمانی پوشش می‌دهد.
 *
 * خروجی: backups/cms_<stamp>.db + backups/cms_<stamp>.manifest.json
 * مانیفست هیچ مقدار حساسی ندارد (فقط نام کلیدها؛ مقادیر تنظیمات هرگز).
 *
 * اجرا:  bun run db:backup   یا   bun scripts/backup.ts --out <dir> --keep <n>
 */

import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readdirSync, unlinkSync, renameSync, statSync, readFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";

type TableCounts = Record<string, number>;
type TableColumns = Record<string, string[]>;
type MediaSample = { id: string; size: number; dataSha256: string };

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function dbUrlToPath(url: string, repoRoot: string): string {
  if (!url.startsWith("file:")) {
    console.error("فقط provider=sqlite (file:) پشتیبانی می‌شود");
    process.exit(2);
  }
  let p = url.slice("file:".length);
  if (p.startsWith("./")) p = p.slice(1); // file:./x → file:/x (رفتار SQLite)
  if (!p.startsWith("/")) return resolve(repoRoot, "prisma", p);
  return p;
}

function resolveDatabaseUrl(): string {
  // ۱) اولویت با آرگومان صریح
  const explicit = argValue("--db");
  if (explicit) return resolve(explicit);
  // ۲) DATABASE_URL از متغیر محیطی
  const url = process.env.DATABASE_URL;
  const repoRoot = resolve(import.meta.dir, "..");
  if (url) return dbUrlToPath(url, repoRoot);
  // ۳) DATABASE_URL از .env — هم‌راستا با قرارداد Prisma (نسبی نسبت به prisma/)
  const envPath = join(repoRoot, ".env");
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, "utf8") as string;
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/);
      if (m) return dbUrlToPath(m[1], repoRoot);
    }
  }
  console.error("DATABASE_URL یافت نشد — با --db مسیر را مشخص کنید یا .env را تنظیم کنید");
  process.exit(2);
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

function main() {
  const started = performance.now();
  const repoRoot = resolve(import.meta.dir, "..");
  const outDir = resolve(argValue("--out") ?? join(repoRoot, "backups"));
  const keep = Math.max(1, Number(argValue("--keep") ?? 7));
  const srcPath = resolveDatabaseUrl();

  if (!existsSync(srcPath)) {
    console.error(`پایگاه‌دادهٔ منبع وجود ندارد: ${srcPath}`);
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });

  const stamp = nowStamp();
  const finalDb = join(outDir, `cms_${stamp}.db`);
  const tmpDb = join(outDir, `.tmp_${stamp}.db`);

  // ── ۱) snapshot سازگار با VACUUM INTO (منبع فقط-خواندنی باز می‌شود) ──
  if (existsSync(tmpDb)) unlinkSync(tmpDb);
  const src = new Database(srcPath, { readonly: true });
  const t0 = performance.now();
  src.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
  src.close();
  const snapshotMs = Math.round(performance.now() - t0);
  renameSync(tmpDb, finalDb);

  // ── ۲) بررسی و جمع‌آوری اطلاعات از نسخهٔ پشتیبان ──
  const b = new Database(finalDb, { readonly: true });
  const integrity = (b.query("PRAGMA integrity_check").get() as Record<string, unknown>).integrity_check;
  if (integrity !== "ok") {
    console.error(`integrity_check پشتیبان: ${integrity} — پشتیبان نامعتبر است`);
    b.close();
    process.exit(1);
  }
  const tables = (
    b.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as { name: string }[]
  ).map((r) => r.name);

  const counts: TableCounts = {};
  const columns: TableColumns = {};
  for (const t of tables) {
    counts[t] = (b.query(`SELECT count(*) AS c FROM "${t}"`).get() as { c: number }).c;
    columns[t] = (b.query(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((r) => r.name);
  }

  // نمونهٔ رسانه برای راستی‌آزمایی بازیابی (هش محتوا؛ بدون افشای داده)
  const mediaSamples: MediaSample[] = [];
  if (tables.includes("Media")) {
    const rows = b
      .query("SELECT id, size, data FROM Media ORDER BY createdAt DESC LIMIT 5")
      .all() as { id: string; size: number; data: string }[];
    for (const r of rows) mediaSamples.push({ id: r.id, size: r.size, dataSha256: sha256(r.data) });
  }

  // کلیدهای تنظیمات — فقط نام‌ها، نه مقادیر
  const settingKeys: string[] = tables.includes("Setting")
    ? (b.query("SELECT key FROM Setting ORDER BY key").all() as { key: string }[]).map((r) => r.key)
    : [];

  const meta = b.query("SELECT sqlite_version() AS v").get() as { v: string };
  const journalMode = (b.query("PRAGMA journal_mode").get() as Record<string, unknown>).journal_mode;
  b.close();

  // ── ۳) مانیفست ──
  const gitSha = Bun.spawnSync(["git", "-C", repoRoot, "rev-parse", "HEAD"]);
  const schemaPath = join(repoRoot, "prisma", "schema.prisma");
  const manifest = {
    created_at: new Date().toISOString(),
    commit_sha: gitSha.exitCode === 0 ? gitSha.stdout.toString().trim() : "unknown",
    source_db: basename(srcPath),
    db_bytes: statSync(finalDb).size,
    db_sha256: (() => {
      const h = new Bun.CryptoHasher("sha256");
      h.update(new Uint8Array(readFileSync(finalDb)));
      return h.digest("hex");
    })(),
    integrity_check: integrity,
    journal_mode: journalMode,
    sqlite_version: meta.v,
    table_counts: counts,
    table_columns: columns,
    media_storage: "in-db base64 (ستون Media.data) — هیچ فایل رسانهٔ مجزایی برای پشتیبان‌گیری وجود ندارد",
    media_samples: mediaSamples,
    setting_keys: settingKeys,
    schema_file: "prisma/schema.prisma",
    schema_file_sha256: existsSync(schemaPath) ? sha256(readFileSync(schemaPath, "utf8")) : null,
    backup_method: "VACUUM INTO (snapshot تراکنشی، سازگار با نوشتن هم‌زمان سرویس)",
  };
  const manifestPath = `${finalDb.slice(0, -3)}.manifest.json`;
  Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // ── ۴) نگهداری N نسخهٔ آخر ──
  const all = readdirSync(outDir)
    .filter((f) => f.startsWith("cms_") && f.endsWith(".db"))
    .sort()
    .reverse();
  for (const old of all.slice(keep)) {
    unlinkSync(join(outDir, old));
    const m = `${old.slice(0, -3)}.manifest.json`;
    if (existsSync(join(outDir, m))) unlinkSync(join(outDir, m));
  }

  const totalMs = Math.round(performance.now() - started);
  console.log("── پشتیبان‌گیری کامل شد ──");
  console.log(`  فایل:     ${finalDb}`);
  console.log(`  مانیفست:  ${manifestPath}`);
  console.log(`  اندازه:   ${(manifest.db_bytes / 1024).toFixed(0)} KB`);
  console.log(`  جدول‌ها:  ${tables.length} | سطرها: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
  console.log(`  integrity: ${integrity}`);
  console.log(`  زمان snapshot: ${snapshotMs}ms | کل: ${totalMs}ms`);
}

main();
