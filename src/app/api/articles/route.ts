/**
 * API مدیریت مقالات
 * GET  /api/articles — فهرست مقالات با جست‌وجو، فیلتر، مرتب‌سازی و صفحه‌بندی
 * POST /api/articles — ایجاد مقاله جدید (همیشه با وضعیت «پیش‌نویس»)
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
  slugify,
  getPaginationParams,
} from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { ARTICLE_STATUSES } from '@/lib/constants'

/** فیلدهای فهرست؛ «content» برای سبک ماندن پاسخ بارگذاری نمی‌شود (چکیده حفظ می‌شود) */
const articleListSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  status: true,
  coverImageId: true,
  authorId: true,
  categoryId: true,
  seoTitle: true,
  seoDescription: true,
  noindex: true,
  publishedAt: true,
  views: true,
  reviewNote: true,
  sourceTemplateName: true, // الگوی مبدأ محتوا (برای نمایش نشان در فهرست)
  sourceTemplateVersion: true, // نسخه الگو در لحظه ساخت
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, color: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  _count: { select: { comments: true } },
} satisfies Prisma.ArticleSelect

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

interface ArticleCreateBody {
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
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('articles.view')
    const sp = req.nextUrl.searchParams
    const { page, pageSize, skip, take } = getPaginationParams(sp)

    const q = sp.get('q')?.trim() ?? ''
    const statusParam = sp.get('status') ?? ''
    const categoryId = sp.get('categoryId') ?? ''
    const authorId = sp.get('authorId') ?? ''
    const tagSlug = sp.get('tag')?.trim() ?? ''

    const status = statusParam ? vEnum(statusParam, ARTICLE_STATUSES.map((s) => s.value), 'وضعیت') : undefined

    const sortParam = sp.get('sort') ?? 'createdAt'
    const sortKey = ['createdAt', 'publishedAt', 'views', 'title'].includes(sortParam) ? sortParam : 'createdAt'
    const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc'
    const orderBy = { [sortKey]: dir } as Prisma.ArticleOrderByWithRelationInput

    const where: Prisma.ArticleWhereInput = {}
    if (q) where.title = { contains: q }
    if (status) where.status = status
    if (categoryId) where.categoryId = categoryId
    if (authorId) where.authorId = authorId
    if (tagSlug) where.tags = { some: { tag: { slug: tagSlug } } }

    const [items, total] = await Promise.all([
      db.article.findMany({ where, orderBy, skip, take, select: articleListSelect }),
      db.article.count({ where }),
    ])

    return ok({ items, total, page, pageSize })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.create')
    const body = await parseBody<ArticleCreateBody>(req)

    if (typeof body.title !== 'string' || body.title.trim().length < 3) {
      throw new ApiError(400, 'عنوان مقاله باید حداقل ۳ نویسه باشد.')
    }
    const title = body.title.trim()

    const slug = slugify(typeof body.slug === 'string' && body.slug.trim() !== '' ? body.slug : title)
    const slugTaken = await db.article.findUnique({ where: { slug }, select: { id: true } })
    if (slugTaken) throw new ApiError(409, 'این آدرس کوتاه قبلاً استفاده شده است. آدرس دیگری انتخاب کنید.')

    let categoryId: string | null = null
    if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== '') {
      const category = await db.category.findUnique({ where: { id: String(body.categoryId) }, select: { id: true } })
      if (!category) throw new ApiError(400, 'دسته‌بندی انتخاب‌شده معتبر نیست.')
      categoryId = category.id
    }

    const tagIds = await validateTagIds(body.tagIds)

    let coverImageId: string | null = null
    if (body.coverImageId !== undefined && body.coverImageId !== null && body.coverImageId !== '') {
      const media = await db.media.findUnique({ where: { id: String(body.coverImageId) }, select: { id: true } })
      if (!media) throw new ApiError(400, 'تصویر شاخص معتبر نیست.')
      coverImageId = media.id
    }

    const created = await db.article.create({
      data: {
        title,
        slug,
        excerpt: vString(body.excerpt, 'چکیده', { max: 500 }),
        content: typeof body.content === 'string' ? body.content : '',
        status: 'DRAFT', // هر مقاله تازه همیشه با پیش‌نویس شروع می‌شود
        categoryId,
        coverImageId,
        seoTitle:
          body.seoTitle === undefined || body.seoTitle === null ? null : vString(body.seoTitle, 'عنوان سئو', { max: 200 }),
        seoDescription:
          body.seoDescription === undefined || body.seoDescription === null
            ? null
            : vString(body.seoDescription, 'توضیح سئو', { max: 500 }),
        noindex: body.noindex === undefined ? false : vBoolean(body.noindex),
        authorId: user.id,
      },
      select: { id: true },
    })

    if (tagIds.length > 0) {
      await db.articleTag.createMany({ data: tagIds.map((tagId) => ({ articleId: created.id, tagId })) })
    }

    const article = await db.article.findUnique({
      where: { id: created.id },
      include: {
        author: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true } },
        tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'ARTICLE',
      entityId: created.id,
      entityTitle: title,
      details: 'ایجاد مقاله جدید',
    })

    return ok(article)
  } catch (err) {
    return handleApiError(err)
  }
}
