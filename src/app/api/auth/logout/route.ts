/**
 * خروج کاربر از سامانه
 * POST /api/auth/logout
 */
import { destroyCurrentSession } from '@/lib/auth'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function POST() {
  try {
    const user = await requireAuth()
    await destroyCurrentSession()
    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'LOGOUT',
      entityType: 'SESSION',
      entityId: user.id,
    })
    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
