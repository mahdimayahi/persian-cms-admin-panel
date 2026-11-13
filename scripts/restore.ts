#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * بازیابی پشتیبان SQLite در یک مسیر جدید + راستی‌آزمایی کامل
 *
 * قواعد ایمنی:
 * - بازیابی هرگز روی «دادهٔ اصلی» انجام نمی‌شود؛ فقط به مسیرِ جدید. اگر فایل
 *   هدف وجود داشته باشد، بدون --force خطا می‌دهد.
 * - بازیابی در سرویس زنده ممنوع است: اول سرویس را متوقف کنید (گام ۷.۴ DEPLOYMENT.md).
 * - پس از کپی: integrity_check + foreign_key_check + مقایسهٔ شمارش همهٔ
 *   جدول‌ها با مانیفست + هش نمونهٔ رسانه‌ها + برابری کلیدهای تنظیمات.
 *
 * اجرا:  bun scripts/restore.ts --from backups/cms_X.db --to /tmp/restore/custom.db
 */

import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

type TableCounts = Record<string, number>;
type TableColumns = Record<string, string[]>;
type MediaSample = { id: string; size: number; dataSha256: string };
type Manifest = {
  created_at: string;
  commit_sha?: string;
  source_db?: string;
  db_bytes?: number;
  table_counts: TableCounts;
  table_columns: TableColumns;
  media_samples?: MediaSample[];
  setting_keys?: string[];
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

function main() {
  const started = performance.now();
  const from = argValue("--from");
  const to = argValue("--to");
  const force = process.argv.includes("--force");
  if (!from || !to) {
    console.error("استفاده: bun scripts/restore.ts --from <backup.db> --to <مسیر جدید> [--force]");
    process.exit(2);
  }
  const fromPath = resolve(from);
  const toPath = resolve(to);
  if (fromPath === toPath) {
    console.error("مسیر هدف نباید همان فایل پشتیبان باشد");
    process.exit(2);
  }
  if (!existsSync(fromPath)) {
    console.error(`فایل پشتیبان وجود ندارد: ${fromPath}`);
    process.exit(2);
  }
  if (existsSync(toPath) && !force) {
    console.error(`فایل هدف از قبل وجود دارد — بازیابی فقط به مسیر جدید مجاز است (برای بازنویسی صریح: --force): ${toPath}`);
    process.exit(2);
  }

  const manifestPath = argValue("--manifest") ?? `${fromPath.slice(0, -3)}.manifest.json`;
  let manifest: Manifest | null = null;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  } else {
    console.error("مانیفست یافت نشد؛ راستی‌آزمایی مقایسه‌ای انجام نخواهد شد (فقط integrity)");
  }

  mkdirSync(dirname(toPath), { recursive: true });

  // ── ۱) کپی به مسیر جدید ──
  const t0 = performance.now();
  copyFileSync(fromPath, toPath);
  const copyMs = Math.round(performance.now() - t0);

  // ── ۲) راستی‌آزمایی ──
  const db = new Database(toPath, { readonly: true });
  const checks: { name: string; ok: boolean; detail?: string }[] = [];

  const integrity = (db.query("PRAGMA integrity_check").get() as Record<string, unknown>).integrity_check;
  checks.push({ name: "integrity_check", ok: integrity === "ok", detail: String(integrity) });

  const fkViolations = db.query("PRAGMA foreign_key_check").all() as unknown[];
  checks.push({ name: "foreign_key_check", ok: fkViolations.length === 0, detail: `${fkViolations.length} تخلف` });

  if (manifest) {
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);
    for (const [t, expected] of Object.entries(manifest.table_counts)) {
      const got = (db.query(`SELECT count(*) AS c FROM "${t}"`).get() as { c: number }).c;
      checks.push({ name: `شمارش ${t}`, ok: got === expected, detail: `مانیفست=${expected}، بازیابی=${got}` });
    }
    for (const [t, expectedCols] of Object.entries(manifest.table_columns)) {
      const gotCols = (db.query(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((r) => r.name);
      checks.push({ name: `ستون‌های ${t}`, ok: JSON.stringify(gotCols) === JSON.stringify(expectedCols) });
    }
    // نمونهٔ رسانه — هش دادهٔ base64 باید دقیقاً برابر باشد
    for (const s of manifest.media_samples ?? []) {
      const row = db.query("SELECT size, data FROM Media WHERE id = ?").get(s.id) as
        | { size: number; data: string }
        | null;
      const ok = !!row && row.size === s.size && sha256(row.data) === s.dataSha256;
      checks.push({ name: `رسانهٔ نمونه ${s.id}`, ok, detail: ok ? "هش و اندازه برابر" : "ناهمسان" });
    }
    // کلیدهای تنظیمات — فقط نام‌ها مقایسه می‌شوند
    if (manifest.setting_keys && tables.includes("Setting")) {
      const keys = (db.query("SELECT key FROM Setting ORDER BY key").all() as { key: string }[]).map((r) => r.key);
      checks.push({ name: "کلیدهای تنظیمات", ok: JSON.stringify(keys) === JSON.stringify(manifest.setting_keys) });
    }
  }
  db.close();

  // ── ۳) خلاصه ──
  const totalMs = Math.round(performance.now() - started);
  const failed = checks.filter((c) => !c.ok);
  console.log("── بازیابی + راستی‌آزمایی ──");
  console.log(`  هدف: ${toPath}`);
  for (const c of checks) {
    console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`  زمان کپی: ${copyMs}ms | کل: ${totalMs}ms`);
  if (failed.length > 0) {
    console.error(`بازیابی ناموفق: ${failed.length} چک رد شد`);
    process.exit(1);
  }
  console.log("بازیابی معتبر است.");
}

main();
