/**
 * علاقه‌مندی‌های کاربر (سنجاق‌کردن صفحه‌ها و رکوردها برای دسترسی سریع)
 * GET    /api/favorites — فهرست علاقه‌مندی‌های من
 * POST   /api/favorites — افزودن/به‌روزرسانی { itemType, itemId, title, path }
 * DELETE /api/favorites?itemType=PAGE&itemId=/articles — حذف
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vString, vEnum } from '@/lib/api-utils'

const FAVORITE_TYPES = ['PAGE', 'ARTICLE', 'MEDIA', 'USER'] as const

export async function GET() {
  try {
    const user = await requireAuth()
    const items = await db.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    })
    return ok({ items })
  } catch (err) {
    return handleApiError(err)
  }
}

interface FavoriteBody {
  itemType?: unknown
  itemId?: unknown
  title?: unknown
  path?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<FavoriteBody>(req)

    const itemType = vEnum<(typeof FAVORITE_TYPES)[number]>(body.itemType, FAVORITE_TYPES, 'نوع مورد')
    const itemId = vString(body.itemId, 'شناسه مورد', { required: true, max: 200 })
    const title = vString(body.title, 'عنوان', { required: true, max: 200 })
    const path = vString(body.path, 'مسیر', { required: true, max: 300 })

    if (!path.startsWith('/')) throw new ApiError(400, 'مسیر علاقه‌مندی باید داخلی باشد.')

    const favorite = await db.favorite.upsert({
      where: { userId_itemType_itemId: { userId: user.id, itemType, itemId } },
      create: { userId: user.id, itemType, itemId, title, path },
      update: { title, path },
    })

    return ok(favorite, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const itemType = searchParams.get('itemType') ?? ''
    const itemId = searchParams.get('itemId') ?? ''
    if (!itemType || !itemId) throw new ApiError(400, 'پارامترهای حذف ناقص است.')

    await db.favorite.deleteMany({
      where: { userId: user.id, itemType, itemId },
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
