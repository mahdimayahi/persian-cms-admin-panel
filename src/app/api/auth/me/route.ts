/**
 * اطلاعات کاربر جاری و مجوزهای نقش او
 * GET /api/auth/me
 */
import { getCurrentUser } from '@/lib/auth'
import { ApiError, ok, handleApiError } from '@/lib/api-utils'
import { ROLE_PERMISSIONS, type Role } from '@/lib/permissions'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      throw new ApiError(401, 'نشست شما منقضی شده است.')
    }
    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
      permissions: ROLE_PERMISSIONS[user.role as Role] ?? [],
    })
  } catch (err) {
    return handleApiError(err)
  }
}
