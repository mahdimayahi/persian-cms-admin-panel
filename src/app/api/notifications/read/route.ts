/**
 * علامت‌گذاری اعلان‌ها به‌عنوان خوانده‌شده
 * PUT /api/notifications/read
 * بدنه: { ids?: string[] } یا { all?: boolean } — همیشه محدود به کاربر جاری
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth, parseBody } from '@/lib/api-utils'

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<{ ids?: unknown; all?: unknown }>(req)

    if (body.all === true || body.all === 'true') {
      await db.notification.updateMany({
        where: { userId: user.id, read: false },
        data: { read: true },
      })
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.filter((v): v is string => typeof v === 'string')
      if (ids.length > 0) {
        await db.notification.updateMany({
          where: { userId: user.id, id: { in: ids } },
          data: { read: true },
        })
      }
    }

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
