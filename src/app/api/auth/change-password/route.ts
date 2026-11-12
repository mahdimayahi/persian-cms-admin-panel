/**
 * تغییر رمز عبور توسط کاربر جاری
 * POST /api/auth/change-password
 * - پس از تغییر، همه نشست‌های دیگر کاربر خروج داده می‌شوند (نشست جاری حفظ می‌شود)
 */
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { hashPassword, verifyPassword, SESSION_COOKIE } from '@/lib/auth'
import { ApiError, ok, handleApiError, requireAuth, parseBody } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<{ currentPassword?: unknown; newPassword?: unknown }>(req)
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, 'رمز عبور فعلی و رمز عبور جدید الزامی است.')
    }
    if (newPassword.length < 8) {
      throw new ApiError(400, 'رمز عبور جدید باید حداقل ۸ نویسه باشد.')
    }

    const record = await db.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, passwordHash: true },
    })
    if (!record || !verifyPassword(currentPassword, record.passwordHash)) {
      throw new ApiError(400, 'رمز عبور فعلی نادرست است.')
    }

    const store = await cookies()
    const currentToken = store.get(SESSION_COOKIE)?.value

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
    })

    // خروج همه نشست‌های دیگر؛ نشست جاری حفظ می‌شود
    await db.session.deleteMany({
      where: {
        userId: user.id,
        ...(currentToken ? { token: { not: currentToken } } : {}),
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CHANGE_PASSWORD',
      entityType: 'USER',
      entityId: user.id,
      entityTitle: user.name,
    })

    return ok({ ok: true, message: 'رمز عبور با موفقیت تغییر کرد.' })
  } catch (err) {
    return handleApiError(err)
  }
}
