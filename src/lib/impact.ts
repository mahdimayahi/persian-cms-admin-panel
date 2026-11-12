/**
 * موتور «بررسی اثر تغییر» (Change Impact)
 * پیش از حذف یا تغییر حساس موجودیت‌ها، وابستگی‌های ساختاریافته را گروه‌بندی و شدت‌گذاری می‌کند.
 *
 * قواعد افشا: عنوان/لینک آیتم‌ها فقط اگر بیننده مجوز مشاهدهٔ آن نوع را دارد
 * (articles.view برای مقاله، pages.view برای صفحه)؛ در غیر این صورت items خالی و فقط count + detail عمومی.
 */
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api-utils'
import { roleHasPermission } from '@/lib/permissions'

export type ImpactSeverity = 'INFO' | 'WARNING' | 'BLOCKING'

export type ImpactItem = {
  id: string
  title: string
  status?: string | null // وضعیت محتوا (DRAFT | PUBLISHED | ...) یا null
  published: boolean // خلاصه برای چیپ وضعیت
  link?: string | null // مسیر داخلی مثل '#/articles/x/edit' — فقط با مجوز مشاهده، وگرنه null
}

export type ImpactGroup = {
  key: string // 'cover' | 'articles' | 'menu' | 'bundle' | ...
  label: string // عنوان فارسی گروه
  detail: string // اثر حذف (فارسی، ارقام لاتین — کلاینت فا می‌کند)
  dependencyType: string // 'COVER_OF_ARTICLE' | 'CATEGORY_OF_ARTICLE' | ...
  count: number
  severity: ImpactSeverity
  items: ImpactItem[] // حداکثر ۵ نمونه
}

export type ImpactReport = {
  type: 'article' | 'category' | 'tag' | 'media' | 'user' | 'page'
  id: string
  name: string
  severity: ImpactSeverity // بدترین شدت گروه‌ها
  canDelete: boolean // severity === 'BLOCKING' → false
  total: number // مجموع count گروه‌ها
  groups: ImpactGroup[]
}

type Viewer = { id: string; role: string }

/** حداکثر تعداد نمونه در هر گروه */
const SAMPLE_SIZE = 5

/** وزن شدت برای یافتن بدترین حالت */
const SEVERITY_WEIGHT: Record<ImpactSeverity, number> = { INFO: 0, WARNING: 1, BLOCKING: 2 }

function worstSeverity(groups: ImpactGroup[]): ImpactSeverity {
  return groups.reduce<ImpactSeverity>(
    (acc, g) => (SEVERITY_WEIGHT[g.severity] > SEVERITY_WEIGHT[acc] ? g.severity : acc),
    'INFO'
  )
}

/** نتیجهٔ نهایی: شدت گزارش = بدترین شدت گروه‌ها؛ canDelete فقط بدون BLOCKING */
function finalize(type: ImpactReport['type'], id: string, name: string, groups: ImpactGroup[]): ImpactReport {
  const severity = worstSeverity(groups)
  return {
    type,
    id,
    name,
    severity,
    canDelete: severity !== 'BLOCKING',
    total: groups.reduce((s, g) => s + g.count, 0),
    groups,
  }
}

/**
 * آیتم‌های مقاله با رعایت قواعد افشا:
 * بدون مجوز articles.view فهرست نمونه‌ها کاملاً خالی می‌شود (فقط count و detail عمومی).
 */
function articleItems(
  rows: { id: string; title: string; status: string }[],
  viewer: Viewer
): ImpactItem[] {
  if (!roleHasPermission(viewer.role, 'articles.view')) return []
  return rows.slice(0, SAMPLE_SIZE).map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    published: a.status === 'PUBLISHED',
    link: `#/articles/${a.id}/edit`,
  }))
}

// ─── مقاله ────────────────────────────────────────────────────────

async function impactArticle(id: string, viewer: Viewer): Promise<ImpactReport> {
  const article = await db.article.findUnique({
    where: { id },
    select: { id: true, title: true, slug: true, status: true },
  })
  if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

  const groups: ImpactGroup[] = []

  // محتوای منتشرشده — هشدار: برداشته‌شدن از دید بازدیدکنندگان
  if (article.status === 'PUBLISHED') {
    groups.push({
      key: 'published-content',
      label: 'محتوای منتشرشده',
      detail: 'حذف محتوای منتشرشده از دید بازدیدکنندگان برداشته می‌شود.',
      dependencyType: 'PUBLISHED_ARTICLE',
      count: 1,
      severity: 'WARNING',
      items: articleItems([article], viewer),
    })
  }

  // اجزای بسته‌های انتشار — حذف خودکار جزء از بسته‌ها
  const bundleRows = await db.bundleItem.findMany({
    where: { articleId: id },
    select: { bundle: { select: { id: true, title: true, status: true } } },
  })
  if (bundleRows.length > 0) {
    const canView = roleHasPermission(viewer.role, 'articles.view')
    groups.push({
      key: 'bundle',
      label: 'اجزای بسته‌های انتشار',
      detail: `از ${bundleRows.length} بسته انتشار حذف می‌شود.`,
      dependencyType: 'BUNDLE_ITEM',
      count: bundleRows.length,
      severity: 'WARNING',
      items: canView
        ? bundleRows.slice(0, SAMPLE_SIZE).map((row) => ({
            id: row.bundle.id,
            title: row.bundle.title,
            status: row.bundle.status,
            published: row.bundle.status === 'PUBLISHED',
            link: '#/bundles',
          }))
        : [],
    })
  }

  // آیتم‌های منویی که به آدرس این مقاله اشاره می‌کنند — حذف خودکار
  const menuPattern = `/articles/${article.slug}`
  const [menuCount, menuSamples] = await Promise.all([
    db.menuItem.count({ where: { url: menuPattern } }),
    db.menuItem.findMany({
      where: { url: menuPattern },
      select: { id: true, label: true },
      take: SAMPLE_SIZE,
      orderBy: { order: 'asc' },
    }),
  ])
  if (menuCount > 0) {
    groups.push({
      key: 'menu',
      label: 'آیتم‌های منو',
      detail: `${menuCount} آیتم منو به این محتوا اشاره می‌کند و حذف می‌شود.`,
      dependencyType: 'MENU_ITEM',
      count: menuCount,
      severity: 'WARNING',
      items: menuSamples.map((m) => ({ id: m.id, title: m.label, status: null, published: false, link: null })),
    })
  }

  // کارهای باز مرتبط — بستن خودکار (CANCELLED)
  const [taskCount, taskSamples] = await Promise.all([
    db.task.count({ where: { relatedType: 'ARTICLE', relatedId: id, status: 'OPEN' } }),
    db.task.findMany({
      where: { relatedType: 'ARTICLE', relatedId: id, status: 'OPEN' },
      select: { id: true, title: true, status: true },
      take: SAMPLE_SIZE,
      orderBy: { createdAt: 'desc' },
    }),
  ])
  if (taskCount > 0) {
    groups.push({
      key: 'tasks',
      label: 'کارهای باز مرتبط',
      detail: `${taskCount} کار باز مرتبط با این محتوا به‌طور خودکار لغو می‌شود.`,
      dependencyType: 'OPEN_TASK',
      count: taskCount,
      severity: 'INFO',
      items: taskSamples.map((t) => ({ id: t.id, title: t.title, status: t.status, published: false, link: null })),
    })
  }

  // ریدایرکت‌های ثبت‌شده برای این محتوا — حذف خودکار
  const [redirectCount, redirectSamples] = await Promise.all([
    db.redirect.count({ where: { entityType: 'ARTICLE', entityId: id } }),
    db.redirect.findMany({
      where: { entityType: 'ARTICLE', entityId: id },
      select: { id: true, fromPath: true, toPath: true },
      take: SAMPLE_SIZE,
      orderBy: { createdAt: 'desc' },
    }),
  ])
  if (redirectCount > 0) {
    groups.push({
      key: 'redirects',
      label: 'ریدایرکت‌های ثبت‌شده',
      detail: `${redirectCount} ریدایرکت مرتبط با این محتوا حذف می‌شود.`,
      dependencyType: 'REDIRECT_TARGET',
      count: redirectCount,
      severity: 'INFO',
      items: redirectSamples.map((r) => ({
        id: r.id,
        title: `${r.fromPath} → ${r.toPath}`,
        status: null,
        published: false,
        link: null,
      })),
    })
  }

  // گفتگوهای درون‌محتوایی — حذف خودکار همراه محتوا
  const [commentCount, commentSamples] = await Promise.all([
    db.contentComment.count({ where: { entityType: 'ARTICLE', entityId: id } }),
    db.contentComment.findMany({
      where: { entityType: 'ARTICLE', entityId: id },
      select: { id: true, body: true, status: true, authorName: true },
      take: SAMPLE_SIZE,
      orderBy: { createdAt: 'desc' },
    }),
  ])
  if (commentCount > 0) {
    groups.push({
      key: 'comments',
      label: 'گفتگوهای درون‌محتوایی',
      detail: 'گفتگوهای آن حذف می‌شود.',
      dependencyType: 'CONTENT_COMMENT',
      count: commentCount,
      severity: 'INFO',
      items: commentSamples.map((c) => ({
        id: c.id,
        title: c.body.length > 60 ? `${c.body.slice(0, 60)}…` : c.body || c.authorName,
        status: c.status,
        published: false,
        link: null,
      })),
    })
  }

  return finalize('article', id, article.title, groups)
}

// ─── دسته‌بندی ────────────────────────────────────────────────────

async function impactCategory(id: string, viewer: Viewer): Promise<ImpactReport> {
  const category = await db.category.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!category) throw new ApiError(404, 'دسته‌بندی یافت نشد.')

  const groups: ImpactGroup[] = []
  const [count, rows] = await Promise.all([
    db.article.count({ where: { categoryId: id } }),
    db.article.findMany({
      where: { categoryId: id },
      select: { id: true, title: true, status: true },
      take: SAMPLE_SIZE,
      orderBy: { updatedAt: 'desc' },
    }),
  ])
  if (count > 0) {
    groups.push({
      key: 'articles',
      label: 'مقالات این دسته',
      detail: `${count} مقاله بدون دسته‌بندی می‌شوند؛ ابتدا منتقل کنید یا از دسته خارج کنید.`,
      dependencyType: 'CATEGORY_OF_ARTICLE',
      count,
      severity: 'BLOCKING',
      items: articleItems(rows, viewer),
    })
  }

  return finalize('category', id, category.name, groups)
}

// ─── برچسب ────────────────────────────────────────────────────────

async function impactTag(id: string, viewer: Viewer): Promise<ImpactReport> {
  const tag = await db.tag.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!tag) throw new ApiError(404, 'برچسب یافت نشد.')

  const groups: ImpactGroup[] = []
  const [count, rows] = await Promise.all([
    db.articleTag.count({ where: { tagId: id } }),
    db.articleTag.findMany({
      where: { tagId: id },
      select: { article: { select: { id: true, title: true, status: true } } },
      take: SAMPLE_SIZE,
    }),
  ])
  if (count > 0) {
    groups.push({
      key: 'articles',
      label: 'مقالات دارای این برچسب',
      detail: `برچسب از ${count} مقاله جداسازی می‌شود.`,
      dependencyType: 'ARTICLE_TAG',
      count,
      severity: 'INFO',
      items: articleItems(rows.map((r) => r.article), viewer),
    })
  }

  return finalize('tag', id, tag.name, groups)
}

// ─── رسانه ────────────────────────────────────────────────────────

async function impactMedia(id: string, viewer: Viewer): Promise<ImpactReport> {
  const media = await db.media.findUnique({ where: { id }, select: { id: true, originalName: true } })
  if (!media) throw new ApiError(404, 'فایل یافت نشد.')

  const groups: ImpactGroup[] = []
  const [count, rows] = await Promise.all([
    db.article.count({ where: { coverImageId: id } }),
    db.article.findMany({
      where: { coverImageId: id },
      select: { id: true, title: true, status: true },
      take: SAMPLE_SIZE,
      orderBy: { updatedAt: 'desc' },
    }),
  ])
  if (count > 0) {
    groups.push({
      key: 'cover',
      label: 'تصویر شاخص مقالات',
      detail: `تصویر شاخص ${count} مقاله است؛ جایگزین کنید یا ارجاع را بردارید.`,
      dependencyType: 'COVER_OF_ARTICLE',
      count,
      severity: 'BLOCKING',
      items: articleItems(rows, viewer),
    })
  }

  return finalize('media', id, media.originalName, groups)
}

// ─── صفحه ─────────────────────────────────────────────────────────

async function impactPage(id: string, viewer: Viewer): Promise<ImpactReport> {
  const page = await db.page.findUnique({
    where: { id },
    select: { id: true, title: true, slug: true, status: true },
  })
  if (!page) throw new ApiError(404, 'صفحه یافت نشد.')

  const groups: ImpactGroup[] = []

  // صفحهٔ منتشرشده — هشدار: برداشته‌شدن از دید بازدیدکنندگان
  if (page.status === 'PUBLISHED') {
    const canView = roleHasPermission(viewer.role, 'pages.view')
    groups.push({
      key: 'published-content',
      label: 'محتوای منتشرشده',
      detail: 'حذف محتوای منتشرشده از دید بازدیدکنندگان برداشته می‌شود.',
      dependencyType: 'PUBLISHED_PAGE',
      count: 1,
      severity: 'WARNING',
      items: canView
        ? [{ id: page.id, title: page.title, status: page.status, published: true, link: '#/pages' }]
        : [],
    })
  }

  // آیتم‌های منویی که به آدرس این صفحه اشاره می‌کنند — حذف خودکار
  const menuPattern = `/${page.slug}`
  const [menuCount, menuSamples] = await Promise.all([
    db.menuItem.count({ where: { url: menuPattern } }),
    db.menuItem.findMany({
      where: { url: menuPattern },
      select: { id: true, label: true },
      take: SAMPLE_SIZE,
      orderBy: { order: 'asc' },
    }),
  ])
  if (menuCount > 0) {
    groups.push({
      key: 'menu',
      label: 'آیتم‌های منو',
      detail: `${menuCount} آیتم منو به این صفحه اشاره می‌کند و حذف می‌شود.`,
      dependencyType: 'MENU_ITEM',
      count: menuCount,
      severity: 'WARNING',
      items: menuSamples.map((m) => ({ id: m.id, title: m.label, status: null, published: false, link: null })),
    })
  }

  return finalize('page', id, page.title, groups)
}

// ─── کاربر ────────────────────────────────────────────────────────

async function impactUser(id: string, viewer: Viewer): Promise<ImpactReport> {
  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!target) throw new ApiError(404, 'کاربر یافت نشد.')

  const groups: ImpactGroup[] = []
  const [authoredCount, ownedCount, mediaCount, openTaskCount] = await Promise.all([
    db.article.count({ where: { authorId: id } }),
    db.article.count({ where: { ownerId: id } }),
    db.media.count({ where: { uploadedById: id } }),
    db.task.count({ where: { assignedToId: id, status: 'OPEN' } }),
  ])

  const [authored, owned] = await Promise.all([
    db.article.findMany({
      where: { authorId: id },
      select: { id: true, title: true, status: true },
      take: SAMPLE_SIZE,
    }),
    db.article.findMany({
      where: { ownerId: id },
      select: { id: true, title: true, status: true },
      take: SAMPLE_SIZE,
    }),
  ])

  if (authoredCount > 0) {
    groups.push({
      key: 'authored',
      label: 'مقالات نوشته‌شده توسط کاربر',
      detail: 'مالکیت محتوا بدون انتقال باقی می‌ماند؛ در صورت نیاز قبل از حذف، مالکیت را منتقل کنید.',
      dependencyType: 'AUTHORED_ARTICLE',
      count: authoredCount,
      severity: 'INFO',
      items: articleItems(authored, viewer),
    })
  }
  if (ownedCount > 0) {
    groups.push({
      key: 'owned',
      label: 'محتوایی که این کاربر مالک مسئول آن است',
      detail: 'این محتواها بدون مسئول صحت اطلاعات خواهند شد.',
      dependencyType: 'OWNED_ARTICLE',
      count: ownedCount,
      severity: 'INFO',
      items: articleItems(owned, viewer),
    })
  }
  if (mediaCount > 0) {
    groups.push({
      key: 'media',
      label: 'فایل‌های بارگذاری‌شده',
      detail: `${mediaCount} فایل به این کاربر منتسب است.`,
      dependencyType: 'UPLOADED_MEDIA',
      count: mediaCount,
      severity: 'INFO',
      items: [],
    })
  }
  if (openTaskCount > 0) {
    groups.push({
      key: 'tasks',
      label: 'کارهای باز واگذارشده به این کاربر',
      detail: `${openTaskCount} کار باز بدون مسئول می‌ماند.`,
      dependencyType: 'OPEN_TASK',
      count: openTaskCount,
      severity: 'INFO',
      items: [],
    })
  }

  return finalize('user', id, target.name, groups)
}

// ─── نقطهٔ ورود ───────────────────────────────────────────────────

export const IMPACT_TYPES = ['article', 'category', 'tag', 'media', 'user', 'page'] as const

export type ImpactType = (typeof IMPACT_TYPES)[number]

/** محاسبهٔ گزارش اثر حذف/تغییر برای هر نوع موجودیت؛ موجودیت ناموجود → ۴۰۴ */
export async function computeImpact(
  type: string,
  id: string,
  viewer: { id: string; role: string }
): Promise<ImpactReport> {
  switch (type) {
    case 'article':
      return impactArticle(id, viewer)
    case 'category':
      return impactCategory(id, viewer)
    case 'tag':
      return impactTag(id, viewer)
    case 'media':
      return impactMedia(id, viewer)
    case 'user':
      return impactUser(id, viewer)
    case 'page':
      return impactPage(id, viewer)
    default:
      throw new ApiError(400, 'نوع موجودیت پشتیبانی نمی‌شود.')
  }
}
