/**
 * راه‌اندازی دیتابیس موقت: پوشهٔ تازه → prisma db push → seed فیکسچر
 * هیچ مسیری خارج از مخزن استفاده نمی‌شود.
 */
import { execSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { HARNESS_DB, HARNESS_DB_URL, HARNESS_DIR, REPO_ROOT } from './config'
import { createPrisma, seedFixture, type Fixture } from './fixture'

export async function setupTempDatabase(): Promise<{ prisma: import('@prisma/client').PrismaClient; fixture: Fixture }> {
  fs.rmSync(HARNESS_DIR, { recursive: true, force: true })
  fs.mkdirSync(HARNESS_DIR, { recursive: true })

  // ساخت جداول در دیتابیس موقت با همان schema مخزن
  execSync(`bunx prisma db push --skip-generate`, {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: HARNESS_DB_URL },
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  const prisma = createPrisma()
  const fixture = await seedFixture(prisma)
  return { prisma, fixture }
}

export function teardown(prisma: import('@prisma/client').PrismaClient): void {
  try {
    prisma.$disconnect()
  } catch {
    /* بی‌اهمیت */
  }
  // فایل‌های SQLite (db + journal/wal)
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(HARNESS_DB + suffix, { force: true })
    } catch {
      /* بی‌اهمیت */
    }
  }
}

export { execFileSync }
