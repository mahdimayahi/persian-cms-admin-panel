/**
 * مدیریت نشست‌های کاربر جاری
 * GET    /api/auth/sessions — فهرست نشست‌های فعال (نشست جاری با isCurrent مشخص می‌شود)
 * DELETE /api/auth/sessions — خروج دادن همه نشست‌های دیگر
 */
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { SESSION_COOKIE } from '@/lib/auth'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET() {
  try {
    const user = await requireAuth()
    const store = await cookies()
    const currentToken = store.get(SESSION_COOKIE)?.value

    const sessions = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        token: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    })

    return ok({
      items: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        isCurrent: currentToken !== undefined && s.token === currentToken,
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE() {
  try {
    const user = await requireAuth()
    const store = await cookies()
    const currentToken = store.get(SESSION_COOKIE)?.value

    await db.session.deleteMany({
      where: {
        userId: user.id,
        ...(currentToken ? { token: { not: currentToken } } : {}),
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'REVOKE_SESSIONS',
      entityType: 'SESSION',
      entityId: user.id,
    })

    return ok({ ok: true, message: 'همه نشست‌های دیگر با موفقیت خروج داده شدند.' })
  } catch (err) {
    return handleApiError(err)
  }
}
