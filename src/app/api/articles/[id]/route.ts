/**
 * API جزئیات مقاله
 * GET    /api/articles/[id] — مشاهده کامل مقاله (به‌همراه ۵ نسخه آخر و تعداد دیدگاه‌ها)
 * PUT    /api/articles/[id] — ویرایش مقاله (منطق مالکیت + قفل خوش‌بینانه + نسخه‌برداری خودکار)
 * DELETE /api/articles/[id] — حذف مقاله (حذف آبشاری نسخه‌ها، دیدگاه‌ها و برچسب‌ها)
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
  vBoolean,
  slugify,
} from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

/** include مشترک برای پاسخ جزئیات مقاله */
const detailInclude = {
  author: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, color: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  versions: {
    take: 5,
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, editorName: true, createdAt: true, note: true },
  },
  _count: { select: { comments: true } },
} satisfies Prisma.ArticleInclude

/** اعتبارسنجی شناسه‌های برچسب دریافتی از کلاینت */
async function validateTagIds(raw: unknown): Promise<string[]> {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ApiError(400, 'فهرست برچسب‌ها نامعتبر است.')
  const ids = Array.from(new Set(raw.filter((t): t is string => typeof t === 'string' && t.trim() !== '')))
  if (ids.length === 0) return []
  const found = await db.tag.findMany({ where: { id: { in: ids } }, select: { id: true } })
  if (found.length !== ids.length) throw new ApiError(400, 'یکی از برچسب‌های انتخاب‌شده معتبر نیست.')
  return ids
}

interface ArticleUpdateBody {
  title?: unknown
  slug?: unknown
  excerpt?: unknown
  content?: unknown
  categoryId?: unknown
  tagIds?: unknown
  coverImageId?: unknown
  seoTitle?: unknown
  seoDescription?: unknown
  noindex?: unknown
  baseUpdatedAt?: unknown
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('articles.view')
    const { id } = await params
    const article = await db.article.findUnique({ where: { id }, include: detailInclude })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')
    return ok(article)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.view')
    const article = await db.article.findUnique({ where: { id } })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    // منطق مالکیت: کاربران بدون مجوز «ویرایش هر مقاله» فقط مقاله خودشان را ویرایش می‌کنند
    const canEditAny = roleHasPermission(user.role, 'articles.edit.any')
    if (!canEditAny) {
      if (!roleHasPermission(user.role, 'articles.edit.own') || article.authorId !== user.id) {
        throw new ApiError(403, 'شما فقط مجاز به ویرایش مقالات خودتان هستید.')
      }
      if (article.status === 'PUBLISHED' || article.status === 'ARCHIVED') {
        throw new ApiError(403, 'برای ویرایش مقاله منتشرشده باید از مدیر محتوا درخواست کنید.')
      }
    }

    const body = await parseBody<ArticleUpdateBody>(req)

    // قفل خوش‌بینانه: اگر مقاله پس از باز شدن ویرایشگر، توسط دیگری تغییر کرده باشد
    if (typeof body.baseUpdatedAt === 'string' && body.baseUpdatedAt.trim() !== '') {
      const base = new Date(body.baseUpdatedAt)
      if (!Number.isNaN(base.getTime()) && base.getTime() < article.updatedAt.getTime() - 1000) {
        throw new ApiError(409, 'این مقاله پس از باز شدن شما توسط شخص دیگری ویرایش شده است.', {
          conflict: true,
          serverUpdatedAt: article.updatedAt,
        })
      }
    }

    const data: Prisma.ArticleUncheckedUpdateInput = {}
    let newTitle = article.title

    let titleChanged = false
    if (body.title !== undefined && body.title !== null) {
      if (typeof body.title !== 'string' || body.title.trim().length < 3) {
        throw new ApiError(400, 'عنوان مقاله باید حداقل ۳ نویسه باشد.')
      }
      const title = body.title.trim()
      data.title = title
      newTitle = title
      titleChanged = title !== article.title
    }

    if (typeof body.slug === 'string' && body.slug.trim() !== '') {
      const slug = slugify(body.slug)
      const taken = await db.article.findUnique({ where: { slug }, select: { id: true } })
      if (taken && taken.id !== id) {
        throw new ApiError(409, 'این آدرس کوتاه قبلاً استفاده شده است. آدرس دیگری انتخاب کنید.')
      }
      data.slug = slug
    }

    let excerptChanged = false
    if (body.excerpt !== undefined && body.excerpt !== null) {
      const excerpt = vString(body.excerpt, 'چکیده', { max: 500 })
      data.excerpt = excerpt
      excerptChanged = excerpt !== article.excerpt
    }

    let contentChanged = false
    if (body.content !== undefined && body.content !== null) {
      if (typeof body.content !== 'string') throw new ApiError(400, '«محتوای مقاله» باید متن باشد.')
      data.content = body.content
      contentChanged = body.content !== article.content
    }

    if (body.categoryId !== undefined) {
      if (body.categoryId === null || body.categoryId === '') {
        data.categoryId = null
      } else {
        const category = await db.category.findUnique({ where: { id: String(body.categoryId) }, select: { id: true } })
        if (!category) throw new ApiError(400, 'دسته‌بندی انتخاب‌شده معتبر نیست.')
        data.categoryId = category.id
      }
    }

    if (body.coverImageId !== undefined) {
      if (body.coverImageId === null || body.coverImageId === '') {
        data.coverImageId = null
      } else {
        const media = await db.media.findUnique({ where: { id: String(body.coverImageId) }, select: { id: true } })
        if (!media) throw new ApiError(400, 'تصویر شاخص معتبر نیست.')
        data.coverImageId = media.id
      }
    }

    if (body.seoTitle !== undefined) {
      data.seoTitle = body.seoTitle === null ? null : vString(body.seoTitle, 'عنوان سئو', { max: 200 })
    }
    if (body.seoDescription !== undefined) {
      data.seoDescription =
        body.seoDescription === null ? null : vString(body.seoDescription, 'توضیح سئو', { max: 500 })
    }
    if (body.noindex !== undefined) {
      data.noindex = vBoolean(body.noindex)
    }

    const replaceTags = body.tagIds !== undefined && body.tagIds !== null
    const tagIds = replaceTags ? await validateTagIds(body.tagIds) : []

    // نسخه‌برداری خودکار: پیش از تغییر نسخه منتشرشده/تأییدشده، از وضعیت فعلی نسخه ثبت می‌شود
    const contentfulChange = titleChanged || excerptChanged || contentChanged
    const needsSnapshot =
      (article.status === 'PUBLISHED' || article.status === 'APPROVED') && contentfulChange

    const updated = await db.$transaction(async (tx) => {
      if (needsSnapshot) {
        await tx.articleVersion.create({
          data: {
            articleId: article.id,
            title: article.title,
            content: article.content,
            excerpt: article.excerpt,
            editorId: user.id,
            editorName: user.name,
            note: 'ثبت خودکار هنگام ویرایش نسخه منتشرشده',
          },
        })
      }
      await tx.article.update({ where: { id }, data })
      if (replaceTags) {
        await tx.articleTag.deleteMany({ where: { articleId: id } })
        if (tagIds.length > 0) {
          await tx.articleTag.createMany({ data: tagIds.map((tagId) => ({ articleId: id, tagId })) })
        }
      }
      return tx.article.findUnique({ where: { id }, include: detailInclude })
    })

    if (!updated) throw new ApiError(404, 'مقاله یافت نشد.')

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'ARTICLE',
      entityId: id,
      entityTitle: newTitle,
      details: 'ویرایش مقاله',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.view')
    const article = await db.article.findUnique({ where: { id }, select: { id: true, title: true, authorId: true } })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    // منطق مالکیت حذف
    const canDeleteAny = roleHasPermission(user.role, 'articles.delete.any')
    if (!canDeleteAny && (!roleHasPermission(user.role, 'articles.delete.own') || article.authorId !== user.id)) {
      throw new ApiError(403, 'شما مجوز حذف این مقاله را ندارید.')
    }

    await db.article.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'ARTICLE',
      entityId: id,
      entityTitle: article.title,
      details: 'حذف مقاله',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
