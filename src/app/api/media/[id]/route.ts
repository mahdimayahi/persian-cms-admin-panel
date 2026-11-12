/**
 * API فایل رسانه مشخص
 * PUT    /api/media/[id] — ویرایش متن جایگزین (فقط بارگذارِ فایل یا نقش دارای media.delete.any)
 * DELETE /api/media/[id] — حذف فایل (بدون مسیر bypass؛ اگر تصویر شاخص مقالات است با ۴۰۹ و گزارش اثر مسدود می‌شود)
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'
import { computeImpact } from '@/lib/impact'

/** فیلدهای عمومی رسانه؛ فیلد data (base64) هرگز در پاسخ برنمی‌گردد */
const mediaSelect = {
  id: true,
  filename: true,
  originalName: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  altText: true,
  uploadedById: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.MediaSelect

/** فایل متعلق به کاربر است یا نقش وی اجازه مدیریت همه فایل‌ها را دارد */
function canManage(userRole: string, userId: string, uploadedById: string): boolean {
  return roleHasPermission(userRole, 'media.delete.any') || uploadedById === userId
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()

    const media = await db.media.findUnique({ where: { id }, select: { id: true, originalName: true, uploadedById: true } })
    if (!media) throw new ApiError(404, 'فایل یافت نشد.')

    if (!canManage(user.role, user.id, media.uploadedById)) {
      throw new ApiError(403, 'شما مجوز ویرایش این فایل را ندارید.')
    }

    const body = await parseBody<{ altText?: unknown }>(req)
    if (body.altText === undefined) throw new ApiError(400, 'متن جایگزین ارسال نشده است.')
    const altText = vString(body.altText, 'متن جایگزین', { max: 300 })

    const updated = await db.media.update({ where: { id }, data: { altText }, select: mediaSelect })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'MEDIA',
      entityId: id,
      entityTitle: media.originalName,
      details: 'ویرایش اطلاعات فایل',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()

    const media = await db.media.findUnique({ where: { id }, select: { id: true, originalName: true, uploadedById: true } })
    if (!media) throw new ApiError(404, 'فایل یافت نشد.')

    if (!canManage(user.role, user.id, media.uploadedById)) {
      throw new ApiError(403, 'شما مجوز حذف این فایل را ندارید.')
    }

    // بررسی استفاده‌شده بودن فایل به‌عنوان تصویر شاخص — حذف مستقیم مجاز نیست؛ ابتدا ارجاع‌ها جایگزین شود
    const coverCount = await db.article.count({ where: { coverImageId: id } })
    if (coverCount > 0) {
      throw new ApiError(409, 'این فایل در حال استفاده است و حذف مستقیم آن مجاز نیست.', {
        blocking: true,
        impact: await computeImpact('media', id, { id: user.id, role: user.role }),
      })
    }

    await db.media.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'MEDIA',
      entityId: id,
      entityTitle: media.originalName,
      details: 'حذف فایل رسانه',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
