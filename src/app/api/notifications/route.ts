/**
 * اعلان‌های کاربر جاری
 * GET /api/notifications — فهرست اعلان‌ها با صفحه‌بندی و شمارش نخوانده‌ها
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)

    // پیش‌فرض ۲۰ مورد، حداکثر ۵۰ مورد
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const pageSize = Math.min(50, Math.max(1, Number(searchParams.get('pageSize')) || 20))
    const skip = (page - 1) * pageSize

    const [items, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      db.notification.count({ where: { userId: user.id } }),
      db.notification.count({ where: { userId: user.id, read: false } }),
    ])

    return ok({ items, total, page, pageSize, unreadCount })
  } catch (err) {
    return handleApiError(err)
  }
}
