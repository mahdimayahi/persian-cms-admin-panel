/**
 * API صفحه مشخص
 * GET    /api/pages/[id] — مشاهده صفحه
 * PUT    /api/pages/[id] — ویرایش صفحه (قفل خوش‌بینانه baseUpdatedAt + گارد تغییر آدرس منتشرشده)
 * DELETE /api/pages/[id] — حذف صفحه
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ApiError,
  ok,
  handleApiError,
  requirePermission,
  parseBody,
  vString,
  vEnum,
  vBoolean,
  vInt,
  slugify,
} from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('pages.view')
    const { id } = await params
    const page = await db.page.findUnique({ where: { id } })
    if (!page) throw new ApiError(404, 'صفحه یافت نشد.')
    return ok(page)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('pages.manage')

    const page = await db.page.findUnique({ where: { id } })
    if (!page) throw new ApiError(404, 'صفحه یافت نشد.')

    const body = await parseBody<{
      title?: unknown
      slug?: unknown
      content?: unknown
      status?: unknown
      showInNav?: unknown
      order?: unknown
      baseUpdatedAt?: unknown
      confirmSlugChange?: unknown // تأیید تغییر آدرس صفحهٔ منتشرشده
      registerRedirect?: unknown // ثبت ریدایرکت از آدرس قبلی
    }>(req)

    // قفل خوش‌بینانه: اگر صفحه پس از باز شدن ویرایشگر، توسط دیگری تغییر کرده باشد
    if (typeof body.baseUpdatedAt === 'string' && body.baseUpdatedAt.trim() !== '') {
      const base = new Date(body.baseUpdatedAt)
      if (!Number.isNaN(base.getTime()) && base.getTime() < page.updatedAt.getTime() - 1000) {
        throw new ApiError(409, 'این صفحه پس از باز شدن شما توسط شخص دیگری ویرایش شده است.', {
          conflict: true,
          serverUpdatedAt: page.updatedAt,
        })
      }
    }

    const data: Prisma.PageUncheckedUpdateInput = {}

    // متغیرهای تغییر آدرس؛ oldSlug پیش از بازنویسی ثبت می‌شود
    const oldSlug = page.slug
    let slugChanged = false
    let newSlug = ''

    if (body.title !== undefined && body.title !== null) {
      data.title = vString(body.title, 'عنوان صفحه', { required: true, max: 200 })
    }

    if (typeof body.slug === 'string' && body.slug.trim() !== '') {
      const slug = slugify(body.slug)
      const taken = await db.page.findUnique({ where: { slug }, select: { id: true } })
      if (taken && taken.id !== id) throw new ApiError(409, 'صفحه‌ای با این آدرس کوتاه وجود دارد.')
      slugChanged = slug !== page.slug
      newSlug = slug

      // گارد تغییر آدرس صفحهٔ منتشرشده: بدون تأیید صریح مجاز نیست
      if (slugChanged && page.status === 'PUBLISHED' && !(body.confirmSlugChange === true || body.confirmSlugChange === 'true')) {
        throw new ApiError(409, 'تغییر آدرس محتوای منتشرشده نیاز به تأیید دارد.', {
          slugChange: true,
          oldSlug,
          newSlug: slug,
        })
      }

      data.slug = slug
    }

    if (typeof body.content === 'string') data.content = body.content

    if (body.status !== undefined && body.status !== null && body.status !== '') {
      data.status = vEnum(body.status, ['DRAFT', 'PUBLISHED'] as const, 'وضعیت صفحه')
    }

    if (body.showInNav !== undefined && body.showInNav !== null) {
      data.showInNav = vBoolean(body.showInNav)
    }

    if (body.order !== undefined && body.order !== null && body.order !== '') {
      data.order = vInt(body.order, 'ترتیب نمایش', { min: 0 }) ?? 0
    }

    // ثبت ریدایرکت: فقط برای صفحهٔ منتشرشده با تغییر آدرس تأییدشده و درخواست صریح
    const registerRedirect = slugChanged && page.status === 'PUBLISHED' && (body.registerRedirect === true || body.registerRedirect === 'true')

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.page.update({ where: { id }, data })
      if (registerRedirect) {
        // ساخت/به‌روزرسانی ریدایرکت از آدرس قبلی به آدرس جدید
        await tx.redirect.upsert({
          where: { fromPath: `/${oldSlug}` },
          create: {
            fromPath: `/${oldSlug}`,
            toPath: `/${newSlug}`,
            kind: 'SLUG_CHANGE',
            entityType: 'PAGE',
            entityId: id,
            createdById: user.id,
            createdByName: user.name,
          },
          update: {
            toPath: `/${newSlug}`,
            entityId: id,
            entityType: 'PAGE',
          },
        })
      }
      return u
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'PAGE',
      entityId: id,
      entityTitle: updated.title,
      details: 'ویرایش صفحه',
    })

    // ثبت جداگانهٔ تغییر آدرس منتشرشده در سابقهٔ فعالیت
    if (registerRedirect) {
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'SLUG_CHANGE',
        entityType: 'PAGE',
        entityId: id,
        entityTitle: updated.title,
        details: `تغییر آدرس منتشرشده از /${oldSlug} به /${newSlug} و ثبت ریدایرکت`,
      })
    }

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('pages.manage')

    const page = await db.page.findUnique({ where: { id } })
    if (!page) throw new ApiError(404, 'صفحه یافت نشد.')

    await db.page.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'PAGE',
      entityId: id,
      entityTitle: page.title,
      details: 'حذف صفحه',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
