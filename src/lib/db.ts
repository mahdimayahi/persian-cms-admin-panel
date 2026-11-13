import { PrismaClient } from '@prisma/client'
import path from 'node:path'

// نکته: پس از هر تغییر در prisma/schema.prisma باید «bunx prisma generate» اجرا شود
// تا کلاینت تولیدشده با ساختار مدل‌ها هم‌راستا بماند؛ در غیر این صورت پرس‌وجوهای
// مرتبط با فیلدهای جدید با خطای «Unknown field» شکست می‌خورند.

/**
 * حل مسیر دیتابیس بدون وابستگی به مسیر مطلق محیط:
 * - اگر DATABASE_URL مطلق باشد (file:/abs/…) همان استفاده می‌شود (هارنس تست/production).
 * - اگر نسبی باشد (file:../db/custom.db)، هم‌راستا با رفتار Prisma CLI نسبت به پوشهٔ
 *   schema (prisma/) حل می‌شود تا CLI و runtime هر دو به یک فایل اشاره کنند.
 * - اگر تعریف نشده باشد، پیش‌فرض db/custom.db در ریشهٔ پروژه استفاده می‌شود.
 */
function resolveDatabaseUrl(raw: string | undefined): string {
  if (!raw) return `file:${path.join(process.cwd(), 'db', 'custom.db')}`
  if (!raw.startsWith('file:')) return raw
  const p = raw.slice('file:'.length)
  if (path.isAbsolute(p)) return raw
  return `file:${path.resolve(process.cwd(), 'prisma', p)}`
}

export const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL)

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl,
    // لاگ پرس‌وجو فقط در توسعه؛ در production/serverless خروجی استاندارد شلوغ نمی‌شود
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
