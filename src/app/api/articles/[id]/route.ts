/**
 * API جزئیات مقاله
 * GET    /api/articles/[id] — مشاهده کامل مقاله (به‌همراه ۵ نسخه آخر و تعداد دیدگاه‌ها)
 * PUT    /api/articles/[id] — ویرایش مقاله (مالکیت + قفل خوش‌بینانه + نسخه‌برداری خودکار + گارد تغییر آدرس منتشرشده)
 * DELETE /api/articles/[id] — حذف مقاله با پاک‌سازی وابستگی‌ها در یک تراکنش (بسته‌ها، منو، کارها، گفتگوها، علاقه‌مندی‌ها، ریدایرکت‌ها)
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
import { isTransientDbContention } from '@/lib/db-errors'

/** include مشترک برای پاسخ جزئیات مقاله */
const detailInclude = {
  author: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
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
  ownerId?: unknown
  reviewAt?: unknown
  baseUpdatedAt?: unknown
  confirmSlugChange?: unknown // تأیید تغییر آدرس محتوای منتشرشده
  registerRedirect?: unknown // ثبت ریدایرکت از آدرس قبلی
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

    // قفل خوش‌بینانه — اعتبارسنجی نسخهٔ پایه:
    //  • نسخهٔ پایهٔ نامعتبر → 400 (به‌جای عبور بی‌صدا از چک)
    //  • ویرایش محتوایی بدون نسخهٔ پایه → 400 (جلوگیری از بازنویسی بی‌صدای تغییر دیگران)
    //  • نسخهٔ پایهٔ قدیمی‌تر از وضعیت فعلی → 409 (بررسی سریع؛ داوری نهایی CAS اتمی داخل تراکنش)
    const CONTENTFUL_FIELDS = [
      'title', 'slug', 'excerpt', 'content', 'categoryId',
      'tagIds', 'coverImageId', 'seoTitle', 'seoDescription', 'noindex',
    ] as const
    const touchesContent = CONTENTFUL_FIELDS.some((k) => body[k] !== undefined)

    let baseTime: number | null = null
    if (
      body.baseUpdatedAt !== undefined &&
      body.baseUpdatedAt !== null &&
      String(body.baseUpdatedAt).trim() !== ''
    ) {
      const parsed = new Date(String(body.baseUpdatedAt))
      if (Number.isNaN(parsed.getTime())) {
        throw new ApiError(400, 'نسخهٔ پایهٔ ویرایش (baseUpdatedAt) نامعتبر است؛ ویرایشگر را ببندید و دوباره باز کنید.')
      }
      baseTime = parsed.getTime()
      if (baseTime < article.updatedAt.getTime()) {
        throw new ApiError(409, 'این مقاله پس از باز شدن شما توسط شخص دیگری ویرایش شده است.', {
          conflict: true,
          serverUpdatedAt: article.updatedAt,
        })
      }
    } else if (touchesContent) {
      throw new ApiError(400, 'ویرایش محتوایی بدون نسخهٔ پایه مجاز نیست؛ فیلد baseUpdatedAt (زمان آخرین دریافت مقاله) لازم است.')
    }

    const data: Prisma.ArticleUncheckedUpdateInput = {}
    let newTitle = article.title

    // متغیرهای تغییر آدرس؛ oldSlug پیش از بازنویسی ثبت می‌شود
    const oldSlug = article.slug
    let slugChanged = false
    let newSlug = ''

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
      slugChanged = slug !== article.slug
      newSlug = slug

      // گارد تغییر آدرس محتوای منتشرشده: بدون تأیید صریح مجاز نیست
      if (slugChanged && article.status === 'PUBLISHED' && !(body.confirmSlugChange === true || body.confirmSlugChange === 'true')) {
        throw new ApiError(409, 'تغییر آدرس محتوای منتشرشده نیاز به تأیید دارد.', {
          slugChange: true,
          oldSlug,
          newSlug: slug,
        })
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

    // مالک مسئول صحت اطلاعات
    if (body.ownerId !== undefined) {
      if (body.ownerId === null || body.ownerId === '') {
        data.ownerId = null
      } else {
        const owner = await db.user.findUnique({ where: { id: String(body.ownerId) }, select: { id: true, status: true } })
        if (!owner) throw new ApiError(400, 'مالک انتخاب‌شده معتبر نیست.')
        if (owner.status !== 'ACTIVE') throw new ApiError(400, 'مالک محتوا باید کاربر فعالی باشد.')
        data.ownerId = owner.id
      }
    }

    // موعد بازبینی بعدی
    if (body.reviewAt !== undefined) {
      if (body.reviewAt === null || body.reviewAt === '') {
        data.reviewAt = null
      } else {
        const d = new Date(String(body.reviewAt))
        if (Number.isNaN(d.getTime())) throw new ApiError(400, 'تاریخ بازبینی نامعتبر است.')
        data.reviewAt = d
      }
    }

    const replaceTags = body.tagIds !== undefined && body.tagIds !== null
    const tagIds = replaceTags ? await validateTagIds(body.tagIds) : []

    // ثبت ریدایرکت: فقط برای مقالهٔ منتشرشده با تغییر آدرس تأییدشده و درخواست صریح
    const registerRedirect = slugChanged && article.status === 'PUBLISHED' && (body.registerRedirect === true || body.registerRedirect === 'true')

    // نسخه‌برداری خودکار: پیش از تغییر نسخه منتشرشده/تأییدشده، از وضعیت فعلی نسخه ثبت می‌شود
    const contentfulChange = titleChanged || excerptChanged || contentChanged
    const needsSnapshot =
      (article.status === 'PUBLISHED' || article.status === 'APPROVED') && contentfulChange

    // هماهنگی قرارداد نسخه: محتوای تأییدشده تغییرناپذیر است — ویرایش محتوایی مقالهٔ APPROVED
    // تأیید را باطل می‌کند و مقاله برای بازبینی و تأیید مجدد به «در بررسی» برمی‌گردد.
    // (هم‌راستا با گارد نسخهٔ بسته‌ها: نسخهٔ جدید هرگز با تأیید قبلی منتشر نمی‌شود؛
    // این‌جا ابطال در لحظهٔ ویرایش رخ می‌دهد تا مسیرهای انتشار گروهی/تک نیز پوشش داده شود.)
    if (contentfulChange && article.status === 'APPROVED') {
      data.status = 'IN_REVIEW'
      data.reviewNote = 'ویرایش محتوا پس از تأیید؛ برای انتشار باید دوباره تأیید شود.'
    }

    // timeout صریح: زیر رقابت هم‌زمان (صف‌شدن نویسنده‌های SQLite) تراکنش پیش‌فرض ۵ ثانیه‌ای ممکن است تمام شود
    await db
      .$transaction(
        async (tx) => {
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
      // CAS اتمی روی نسخهٔ پایه: اگر بین خواندن اولیه و نوشتن، ویرایشگر دیگری مقاله را
      // تغییر داده باشد (updatedAt عوض شده)، شمارش صفر و خطای تعارض برمی‌گردد —
      // دو ویرایش هم‌زمان با نسخهٔ پایهٔ یکسان هرگز هر دو موفق نمی‌شوند.
      if (Object.keys(data).length > 0) {
        const cas =
          baseTime !== null
            ? await tx.article.updateMany({ where: { id, updatedAt: new Date(baseTime) }, data })
            : await tx.article.updateMany({ where: { id }, data })
        if (cas.count === 0) {
          const fresh = await tx.article.findUnique({ where: { id }, select: { updatedAt: true } })
          throw new ApiError(409, 'این مقاله پس از باز شدن شما توسط شخص دیگری ویرایش شده است.', {
            conflict: true,
            serverUpdatedAt: fresh?.updatedAt ?? article.updatedAt,
          })
        }
      }
      if (replaceTags) {
        await tx.articleTag.deleteMany({ where: { articleId: id } })
        if (tagIds.length > 0) {
          await tx.articleTag.createMany({ data: tagIds.map((tagId) => ({ articleId: id, tagId })) })
        }
      }
      if (registerRedirect) {
        // ساخت/به‌روزرسانی ریدایرکت از آدرس قبلی به آدرس جدید
        await tx.redirect.upsert({
          where: { fromPath: `/articles/${oldSlug}` },
          create: {
            fromPath: `/articles/${oldSlug}`,
            toPath: `/articles/${newSlug}`,
            kind: 'SLUG_CHANGE',
            entityType: 'ARTICLE',
            entityId: id,
            createdById: user.id,
            createdByName: user.name,
          },
          update: {
            toPath: `/articles/${newSlug}`,
            entityId: id,
            entityType: 'ARTICLE',
          },
        })
      }
        },
        { timeout: 15_000, maxWait: 10_000 }
      )
      .catch((err: unknown) => {
        if (err instanceof ApiError) throw err
        // اشغال گذرای SQLite زیر رقابت هم‌زمان: علت در این نقطه معلوم است — نویسندهٔ دیگر روی
        // همین سطر؛ بازنده با ۴۰۹ تعارض و serverUpdatedAt تازه روبه‌رو می‌شود (نه ۵۰۰/۵۰۳)
        if (isTransientDbContention(err)) {
          console.error('[API] article write contention (transient) → 409', err)
          throw new ApiError(409, 'این مقاله هم‌زمان توسط دیگری ویرایش شد؛ نسخهٔ تازه بگیرید و دوباره تلاش کنید.', {
            conflict: true,
            transient: true,
          })
        }
        throw err
      })

    // خواندن جزئیات پس از کامیت (بیرون از تراکنش) — سبک‌تر و امن‌تر زیر بار هم‌زمان
    const updated = await db.article.findUnique({ where: { id }, include: detailInclude })

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

    // ثبت جداگانهٔ تغییر آدرس منتشرشده در سابقهٔ فعالیت
    if (registerRedirect) {
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'SLUG_CHANGE',
        entityType: 'ARTICLE',
        entityId: id,
        entityTitle: newTitle,
        details: `تغییر آدرس منتشرشده از /articles/${oldSlug} به /articles/${newSlug} و ثبت ریدایرکت`,
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
    const user = await requirePermission('articles.view')
    const article = await db.article.findUnique({
      where: { id },
      select: { id: true, title: true, slug: true, authorId: true, status: true },
    })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    // منطق مالکیت حذف
    const canDeleteAny = roleHasPermission(user.role, 'articles.delete.any')
    if (!canDeleteAny && (!roleHasPermission(user.role, 'articles.delete.own') || article.authorId !== user.id)) {
      throw new ApiError(403, 'شما مجوز حذف این مقاله را ندارید.')
    }

    // پاک‌سازی وابستگی‌ها و حذف مقاله در یک تراکنش — بدون مسدودکننده و بدون دادهٔ یتیم
    const [bundles, menuItems, tasks, comments, favorites, redirects] = await db.$transaction([
      db.bundleItem.deleteMany({ where: { articleId: id } }),
      db.menuItem.deleteMany({ where: { url: `/articles/${article.slug}` } }),
      db.task.updateMany({
        where: { relatedType: 'ARTICLE', relatedId: id, status: 'OPEN' },
        data: { status: 'CANCELLED' },
      }),
      db.contentComment.deleteMany({ where: { entityType: 'ARTICLE', entityId: id } }),
      db.favorite.deleteMany({ where: { itemType: 'ARTICLE', itemId: id } }),
      db.redirect.deleteMany({ where: { entityType: 'ARTICLE', entityId: id } }),
      db.article.delete({ where: { id } }),
    ])

    const cleanupSummary = [
      `${bundles.count} جزء بسته انتشار`,
      `${menuItems.count} آیتم منو`,
      `${tasks.count} کار لغو شد`,
      `${comments.count} گفتگو`,
      `${favorites.count} علاقه‌مندی`,
      `${redirects.count} ریدایرکت`,
    ].join('، ')

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'ARTICLE',
      entityId: id,
      entityTitle: article.title,
      details: `حذف مقاله — پاک‌سازی خودکار: ${cleanupSummary}`,
    })

    return ok({
      ok: true,
      cleanup: {
        bundles: bundles.count,
        menuItems: menuItems.count,
        tasks: tasks.count,
        comments: comments.count,
        favorites: favorites.count,
        redirects: redirects.count,
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
