import { PrismaClient } from '@prisma/client'

// نکته: پس از هر تغییر در prisma/schema.prisma باید «bunx prisma generate» اجرا شود
// تا کلاینت تولیدشده با ساختار مدل‌ها هم‌راستا بماند؛ در غیر این صورت پرس‌وجوهای
// مرتبط با فیلدهای جدید با خطای «Unknown field» شکست می‌خورند.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
