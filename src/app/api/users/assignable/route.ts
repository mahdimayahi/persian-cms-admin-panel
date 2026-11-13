/**
 * کاربران قابل انتخاب برای واگذاری کار / تعیین مالک محتوا
 * GET /api/users/assignable — فقط کاربران فعال (id، نام، نقش)
 * برای همه کاربران احراز هویت‌شده در دسترس است؛ حداقل داده برمی‌گردد.
 */
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'
import { ROLE_LABELS, type Role } from '@/lib/permissions'

export async function GET() {
  try {
    await requireAuth()
    const users = await db.user.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, role: true },
      take: 100,
    })
    return ok({
      items: users.map((u) => ({ ...u, roleLabel: ROLE_LABELS[u.role as Role] ?? u.role })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
