/**
 * ادغام امن موارد مشابه (با تأیید انسان)
 * POST /api/duplicates/merge — بدنه: { type: 'category'|'tag', primaryId, secondaryId }
 * روابط به رکورد اصلی منتقل و رکورد دوم حذف می‌شود؛ کل عملیات در تاریخچه ثبت می‌گردد.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vEnum, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

interface MergeBody {
  type?: unknown
  primaryId?: unknown
  secondaryId?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.view')
    const body = await parseBody<MergeBody>(req)
    const type = vEnum<'category' | 'tag'>(body.type, ['category', 'tag'] as const, 'نوع')
    const primaryId = vString(body.primaryId, 'رکورد اصلی', { required: true })
    const secondaryId = vString(body.secondaryId, 'رکورد دوم', { required: true })

    if (primaryId === secondaryId) throw new ApiError(400, 'رکورد اصلی و دوم نباید یکی باشند.')

    if (type === 'category') {
      if (!roleHasPermission(user.role, 'categories.manage')) {
        throw new ApiError(403, 'شما مجوز ادغام دسته‌بندی‌ها را ندارید.')
      }
      const primary = await db.category.findUnique({ where: { id: primaryId } })
      const secondary = await db.category.findUnique({ where: { id: secondaryId } })
      if (!primary || !secondary) throw new ApiError(404, 'یکی از دسته‌بندی‌ها یافت نشد.')

      const moved = await db.article.updateMany({
        where: { categoryId: secondaryId },
        data: { categoryId: primaryId },
      })

      await db.category.delete({ where: { id: secondaryId } })

      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'UPDATE',
        entityType: 'CATEGORY',
        entityId: primaryId,
        entityTitle: primary.name,
        details: `ادغام «${secondary.name}» در «${primary.name}» — ${moved.count} مقاله منتقل شد.`,
      })

      return ok({ ok: true, movedCount: moved.count })
    }

    // tag
    if (!roleHasPermission(user.role, 'tags.manage')) {
      throw new ApiError(403, 'شما مجوز ادغام برچسب‌ها را ندارید.')
    }
    const primary = await db.tag.findUnique({ where: { id: primaryId } })
    const secondary = await db.tag.findUnique({ where: { id: secondaryId } })
    if (!primary || !secondary) throw new ApiError(404, 'یکی از برچسب‌ها یافت نشد.')

    // انتقال روابط بدون ایجاد جفت تکراری
    const secondaryLinks = await db.articleTag.findMany({
      where: { tagId: secondaryId },
      select: { articleId: true },
    })
    const existingPrimary = await db.articleTag.findMany({
      where: { tagId: primaryId },
      select: { articleId: true },
    })
    const existingSet = new Set(existingPrimary.map((l) => l.articleId))
    const toCreate = secondaryLinks.filter((l) => !existingSet.has(l.articleId))

    const moved = await db.$transaction(async (tx) => {
      await tx.articleTag.deleteMany({ where: { tagId: secondaryId } })
      if (toCreate.length > 0) {
        await tx.articleTag.createMany({
          data: toCreate.map((l) => ({ tagId: primaryId, articleId: l.articleId })),
        })
      }
      await tx.tag.delete({ where: { id: secondaryId } })
      return toCreate.length
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'TAG',
      entityId: primaryId,
      entityTitle: primary.name,
      details: `ادغام «${secondary.name}» در «${primary.name}» — روابط ${moved} مقاله منتقل شد.`,
    })

    return ok({ ok: true, movedCount: moved })
  } catch (err) {
    return handleApiError(err)
  }
}
