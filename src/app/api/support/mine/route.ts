/**
 * گزارش‌های پشتیبانی کاربر جاری
 * GET /api/support/mine — ۲۰ گزارش آخرِ کاربر واردشده (جدیدترین اول)
 * وضعیت‌های قدیمی سازگار نگاشت می‌شوند: OPEN→NEW (RESOLVED بدون تغییر)
 */
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'

export async function GET() {
  try {
    const user = await requireAuth()

    const items = await db.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, code: true, subject: true, status: true, createdAt: true, updatedAt: true },
    })

    return ok({
      items: items.map((t) => ({ ...t, status: t.status === 'OPEN' ? 'NEW' : t.status })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
