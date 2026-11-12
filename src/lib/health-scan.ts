/**
 * موتور پویش سلامت و کیفیت محتوا
 * هر مشکل یک «کلید پایدار» دارد تا بتواند با دلیل نادیده گرفته شود.
 * شدت‌ها: HIGH (فوری)، MEDIUM (هفته جاری)، LOW (فرصت مناسب)
 */
import { db } from '@/lib/db'

export type HealthSeverity = 'HIGH' | 'MEDIUM' | 'LOW'

export type HealthIssue = {
  /** کلید پایدار مشکل — برای نادیده‌گرفتن */
  key: string
  type: string
  severity: HealthSeverity
  title: string
  detail: string
  /** پیشنهاد اصلاح */
  fix: string
  link: string | null
  entityLabel: string
}

export const SEVERITY_LABELS: Record<HealthSeverity, string> = {
  HIGH: 'بحرانی',
  MEDIUM: 'متوسط',
  LOW: 'کم‌اهمیت',
}

export async function scanHealthIssues(): Promise<HealthIssue[]> {
  const now = Date.now()
  const DAY = 86_400_000
  const YEAR = 365 * DAY

  const [
    altlessMedia,
    overdueReviews,
    staleArticles,
    ownerless,
    categoryless,
    coverless,
    publishedSeo,
    oldPendingComments,
    stuckRevision,
    stuckReview,
  ] = await Promise.all([
    db.media.findMany({
      where: { altText: '' },
      select: { id: true, originalName: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    }),
    db.article.findMany({
      where: { reviewAt: { lt: new Date(now) }, status: { notIn: ['ARCHIVED'] } },
      select: { id: true, title: true, reviewAt: true },
      take: 50,
      orderBy: { reviewAt: 'asc' },
    }),
    db.article.findMany({
      where: { status: 'PUBLISHED', reviewAt: null, updatedAt: { lt: new Date(now - YEAR) } },
      select: { id: true, title: true, updatedAt: true },
      take: 50,
      orderBy: { updatedAt: 'asc' },
    }),
    db.article.findMany({
      where: { status: 'PUBLISHED', ownerId: null },
      select: { id: true, title: true },
      take: 50,
      orderBy: { publishedAt: 'asc' },
    }),
    db.article.findMany({
      where: { status: 'PUBLISHED', categoryId: null },
      select: { id: true, title: true },
      take: 50,
      orderBy: { publishedAt: 'asc' },
    }),
    db.article.findMany({
      where: { status: 'PUBLISHED', coverImageId: null },
      select: { id: true, title: true },
      take: 50,
      orderBy: { publishedAt: 'asc' },
    }),
    db.article.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, title: true, seoTitle: true, seoDescription: true },
      take: 500,
      orderBy: { publishedAt: 'asc' },
    }),
    db.comment.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(now - 3 * DAY) } },
      select: { id: true, article: { select: { title: true } }, createdAt: true },
      take: 50,
      orderBy: { createdAt: 'asc' },
    }),
    db.article.findMany({
      where: { status: 'NEEDS_REVISION', updatedAt: { lt: new Date(now - 7 * DAY) } },
      select: { id: true, title: true, updatedAt: true },
      take: 50,
      orderBy: { updatedAt: 'asc' },
    }),
    db.article.findMany({
      where: { status: 'IN_REVIEW', updatedAt: { lt: new Date(now - 3 * DAY) } },
      select: { id: true, title: true, updatedAt: true },
      take: 50,
      orderBy: { updatedAt: 'asc' },
    }),
  ])

  const issues: HealthIssue[] = []

  // ۱) رسانه بدون متن جایگزین
  for (const m of altlessMedia) {
    issues.push({
      key: `media-alt:${m.id}`,
      type: 'MEDIA_ALT',
      severity: 'MEDIUM',
      title: 'تصویر بدون متن جایگزین (alt)',
      detail: `فایل «${m.originalName}» متن جایگزین ندارد؛ دسترس‌پذیری و سئو را ضعیف می‌کند.`,
      fix: 'در کتابخانه رسانه، متن جایگزین گویا برای تصویر بنویسید.',
      link: '#/media',
      entityLabel: 'رسانه',
    })
  }

  // ۲) بازبینی محتوا از موعد گذشته
  for (const a of overdueReviews) {
    issues.push({
      key: `article-review:${a.id}`,
      type: 'REVIEW_OVERDUE',
      severity: 'HIGH',
      title: 'بازبینی محتوا از موعد گذشته',
      detail: `«${a.title}» موعد بازبینی‌اش گذشته است؛ ممکن است اطلاعات آن قدیمی باشد.`,
      fix: 'محتوا را مرور و صحت اطلاعات را تأیید کنید یا موعد جدید تعیین کنید.',
      link: `#/articles/${a.id}/edit`,
      entityLabel: 'مقاله',
    })
  }

  // ۳) محتوای قدیمی و بازبینی‌نشده
  for (const a of staleArticles) {
    issues.push({
      key: `article-stale:${a.id}`,
      type: 'STALE_CONTENT',
      severity: 'MEDIUM',
      title: 'محتوای قدیمی نیازمند بازبینی',
      detail: `«${a.title}» بیش از یک سال است بازبینی نشده و بدون موعد بازبینی است.`,
      fix: 'محتوا را بازبینی و موعد بازبینی بعدی را تعیین کنید.',
      link: `#/articles/${a.id}/edit`,
      entityLabel: 'مقاله',
    })
  }

  // ۴) محتوای بدون مالک مسئول
  for (const a of ownerless) {
    issues.push({
      key: `article-owner:${a.id}`,
      type: 'NO_OWNER',
      severity: 'LOW',
      title: 'محتوای بدون مالک مسئول',
      detail: `برای «${a.title}» هیچ‌کس مسئول صحت اطلاعات شناخته نشده است.`,
      fix: 'یک مالک مسئول تعیین کنید تا پاسخ‌گویی اطلاعات مشخص باشد.',
      link: `#/articles/${a.id}/edit`,
      entityLabel: 'مقاله',
    })
  }

  // ۵) مقاله منتشرشده بدون دسته‌بندی
  for (const a of categoryless) {
    issues.push({
      key: `article-category:${a.id}`,
      type: 'NO_CATEGORY',
      severity: 'MEDIUM',
      title: 'مقاله منتشرشده بدون دسته‌بندی',
      detail: `«${a.title}» منتشر شده اما دسته‌بندی ندارد؛ یافتن آن برای مخاطب سخت می‌شود.`,
      fix: 'دسته‌بندی مناسب را در ویرایشگر مقاله انتخاب کنید.',
      link: `#/articles/${a.id}/edit`,
      entityLabel: 'مقاله',
    })
  }

  // ۶) مقاله منتشرشده بدون تصویر شاخص
  for (const a of coverless) {
    issues.push({
      key: `article-cover:${a.id}`,
      type: 'NO_COVER',
      severity: 'LOW',
      title: 'مقاله منتشرشده بدون تصویر شاخص',
      detail: `«${a.title}» تصویر شاخص ندارد؛ در فهرست‌ها و اشتراک‌گذاری، جلوه کمتری دارد.`,
      fix: 'از کتابخانه رسانه یک تصویر شاخص انتخاب کنید.',
      link: `#/articles/${a.id}/edit`,
      entityLabel: 'مقاله',
    })
  }

  // ۷) عنوان/توضیح متای تکراری
  const seenTitle = new Map<string, { id: string; title: string }[]>()
  const seenDesc = new Map<string, { id: string; title: string }[]>()
  for (const a of publishedSeo) {
    const t = a.seoTitle?.trim()
    const d = a.seoDescription?.trim()
    if (t) {
      const arr = seenTitle.get(t) ?? []
      arr.push({ id: a.id, title: a.title })
      seenTitle.set(t, arr)
    }
    if (d) {
      const arr = seenDesc.get(d) ?? []
      arr.push({ id: a.id, title: a.title })
      seenDesc.set(d, arr)
    }
  }
  let dupCount = 0
  for (const [value, group] of seenTitle) {
    if (group.length > 1 && dupCount < 10) {
      dupCount++
      issues.push({
        key: `dup-seo-title:${Buffer.from(value).toString('base64url').slice(0, 40)}`,
        type: 'DUP_SEO',
        severity: 'LOW',
        title: 'عنوان سئوی تکراری',
        detail: `${group.length} مقاله عنوان سئوی یکسانی دارند (نمونه: «${group[0].title}» و «${group[1].title}»).`,
        fix: 'برای هر صفحه، عنوان متای یکتا بنویسید تا در نتایج جست‌وجو رقیب هم نشوند.',
        link: `#/articles/${group[1].id}/edit`,
        entityLabel: 'مقاله',
      })
    }
  }
  for (const [value, group] of seenDesc) {
    if (group.length > 1 && dupCount < 10) {
      dupCount++
      issues.push({
        key: `dup-seo-desc:${Buffer.from(value).toString('base64url').slice(0, 40)}`,
        type: 'DUP_SEO',
        severity: 'LOW',
        title: 'توضیح متای تکراری',
        detail: `${group.length} مقاله توضیح متای یکسانی دارند (نمونه: «${group[0].title}»).`,
        fix: 'توضیح متای هر مقاله را به‌صورت یکتا بازنویسی کنید.',
        link: `#/articles/${group[1].id}/edit`,
        entityLabel: 'مقاله',
      })
    }
  }

  // ۸) دیدگاه در انتظار بررسی بیش از ۳ روز
  for (const c of oldPendingComments) {
    issues.push({
      key: `comment-pending:${c.id}`,
      type: 'PENDING_COMMENT',
      severity: 'LOW',
      title: 'دیدگاه معطل مانده',
      detail: `دیدگاهی روی «${c.article.title}» بیش از ۳ روز در انتظار بررسی است.`,
      fix: 'در بخش دیدگاه‌ها آن را تأیید یا رد کنید.',
      link: '#/comments',
      entityLabel: 'دیدگاه',
    })
  }

  // ۹) توقف طولانی در «نیازمند اصلاح»
  for (const a of stuckRevision) {
    issues.push({
      key: `article-stuck-revision:${a.id}`,
      type: 'STUCK_WORKFLOW',
      severity: 'MEDIUM',
      title: 'محتوای متوقف‌شده در گردش کار',
      detail: `«${a.title}» بیش از ۷ روز در وضعیت «نیازمند اصلاح» مانده است.`,
      fix: 'اصلاحات را انجام و مقاله را دوباره برای بررسی ارسال کنید.',
      link: `#/articles/${a.id}/edit`,
      entityLabel: 'مقاله',
    })
  }

  // ۱۰) توقف طولانی در صف بررسی
  for (const a of stuckReview) {
    issues.push({
      key: `article-stuck-review:${a.id}`,
      type: 'STUCK_WORKFLOW',
      severity: 'MEDIUM',
      title: 'در صف بررسی معطل مانده',
      detail: `«${a.title}» بیش از ۳ روز در انتظار بازبینی است.`,
      fix: 'صف بازبینی را بررسی و نتیجه را اعلام کنید.',
      link: `#/articles/${a.id}/edit`,
      entityLabel: 'مقاله',
    })
  }

  return issues
}

/** تعداد مشکلات فعال (بدون احتساب موارد نادیده‌گرفته‌شده) */
export async function countHealthIssues(): Promise<number> {
  const [scan, ignored] = await Promise.all([
    scanHealthIssues(),
    db.healthIgnore.findMany({ select: { issueKey: true } }),
  ])
  const ignoredKeys = new Set(ignored.map((i) => i.issueKey))
  return scan.filter((i) => !ignoredKeys.has(i.key)).length
}
