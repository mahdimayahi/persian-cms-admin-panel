/**
 * بررسی آمادگی بسته انتشار
 *
 * نتایج بررسی روی خود بسته (readinessState + readinessJson) ذخیره می‌شود و برای
 * تصمیم «تأیید بسته» ملاک است: هر خطا → BLOCKED و تأیید ممکن نیست؛ فقط هشدار → READY_WARNINGS
 * و تأیید با ثبت هشدار در سابقه انجام می‌شود.
 *
 * بررسی‌ها:
 * a) فیلدهای ضروری و جای‌نگهدارها (عنوان/آدرس کوتاه/متن + جای‌نگهدارهای الگو روی نسخه متصل‌شده)
 * b) نسخه و وضعیت مقاله (اتصال نسخه، تأیید بودن مقاله، به‌روز بودن نسخه نسبت به آخرین نسخه)
 * c) کارهای باز مرتبط (هشدار غیرمسدودکننده)
 * d) یکتایی و تداخل آدرس کوتاه (داخل بسته، مقالات منتشرشده دیگر و صفحه‌ها)
 * e) رسانه‌ها (تصویر شاخص و ارجاع‌های /api/media/<id> داخل محتوای نسخه متصل‌شده)
 * f) واژه‌نامه برند (موارد الزام‌آور → خطا؛ هشدار → هشدار) با احترام به استثناهای ثبت‌شده مقاله
 */
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api-utils'
import {
  checkFieldsWithRules,
  type GlossaryRuleInput,
  type GlossaryFieldType,
  GLOSSARY_FIELD_LABELS,
} from '@/lib/glossary-check'
import { findPlaceholders, PLACEHOLDER_FIELD_LABELS, type PlaceholderFieldType } from '@/lib/template-placeholders'
import { listArticleVersionsAsc, versionNumberMap } from '@/lib/bundle-runner'

export type ReadinessLevel = 'ERROR' | 'WARNING' | 'OK'

export interface ReadinessCheck {
  key: string
  label: string
  level: ReadinessLevel
  detail: string
  /** شناسه اقلام مرتبط با این یافته (برای هایلایت در رابط کاربری) */
  itemIds?: string[]
}

export type ReadinessState = 'READY' | 'READY_WARNINGS' | 'BLOCKED' | 'UNKNOWN'

export interface ReadinessResult {
  state: ReadinessState
  checks: ReadinessCheck[]
}

/** برچسب فارسی وضعیت مقاله */
function articleStatusFa(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس'
    case 'IN_REVIEW':
      return 'در بررسی'
    case 'NEEDS_REVISION':
      return 'نیازمند اصلاح'
    case 'APPROVED':
      return 'تأییدشده'
    case 'PUBLISHED':
      return 'منتشرشده'
    case 'ARCHIVED':
      return 'بایگانی‌شده'
    default:
      return status
  }
}

/** افزودن یک بررسی با سطح تعیین‌شده به فهرست */
function pushCheck(
  checks: ReadinessCheck[],
  key: string,
  label: string,
  problems: string[],
  itemIds: string[],
  warningOnly = false
) {
  const level: ReadinessLevel = problems.length === 0 ? 'OK' : warningOnly ? 'WARNING' : 'ERROR'
  checks.push({
    key,
    label,
    level,
    detail:
      problems.length === 0
        ? 'موردی یافت نشد.'
        : problems.join('\n'),
    ...(itemIds.length > 0 ? { itemIds: Array.from(new Set(itemIds)) } : {}),
  })
}

/** قواعد فعال واژه‌نامه برند به ورودی موتور بررسی */
async function loadGlossaryRules(): Promise<GlossaryRuleInput[]> {
  const terms = await db.glossaryTerm.findMany({ where: { isActive: true } })
  return terms.map((g) => ({
    id: g.id,
    term: g.term,
    forms: JSON.parse(g.forms || '[]') as string[],
    preferred: g.preferred,
    type: g.type,
    severity: g.severity,
    scope: g.scope,
    language: g.language,
    explanation: g.explanation,
    example: g.example,
    isActive: g.isActive,
  }))
}

/** شناسه رسانه‌های ارجاع‌شده داخل محتوا به شکل /api/media/<id> */
function extractMediaIds(content: string): string[] {
  const ids: string[] = []
  const re = /\/api\/media\/([a-zA-Z0-9_-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    if (!ids.includes(m[1])) ids.push(m[1])
    if (m[0].length === 0) re.lastIndex++
  }
  return ids
}

/**
 * اجرای بررسی آمادگی؛ نتیجه روی بسته ذخیره و بازگردانده می‌شود.
 * مجوز موردنیاز (articles.view) در لایه مسیر کنترل می‌شود.
 */
export async function runBundleReadiness(
  bundleId: string,
  actor?: { id?: string; name?: string }
): Promise<ReadinessResult> {
  const bundle = await db.publishBundle.findUnique({
    where: { id: bundleId },
    include: {
      items: {
        orderBy: { addedAt: 'asc' as const },
        include: {
          article: {
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              excerpt: true,
              content: true,
              seoTitle: true,
              seoDescription: true,
              coverImageId: true,
            },
          },
        },
      },
    },
  })
  if (!bundle) throw new ApiError(404, 'بسته یافت نشد.')

  const checks: ReadinessCheck[] = []
  const items = bundle.items

  // ── اقلام بسته: حداقل یک قلم ──
  const itemsProblems: string[] = []
  if (items.length === 0) {
    itemsProblems.push('بسته هیچ قلمی ندارد؛ حداقل یک مقاله به بسته افزوده شود.')
  }
  pushCheck(checks, 'items', 'اقلام بسته', itemsProblems, [])

  // نسخه‌های همه مقالات (ترتیب صعودی) برای شماره‌گذاری و تشخیص آخرین نسخه
  const articleIds = Array.from(new Set(items.map((it) => it.articleId)))
  const versionsByArticle = new Map<string, Awaited<ReturnType<typeof listArticleVersionsAsc>>>()
  for (const id of articleIds) {
    versionsByArticle.set(id, await listArticleVersionsAsc(id))
  }

  // قواعد واژه‌نامه و استثناهای ثبت‌شده مقالات (یک پرس‌وجو)
  const rules = await loadGlossaryRules()
  const exceptions = articleIds.length
    ? await db.glossaryException.findMany({ where: { entityType: 'ARTICLE', entityId: { in: articleIds } } })
    : []
  const exceptionsByArticle = new Map<string, { termId: string; field: string }[]>()
  for (const ex of exceptions) {
    const list = exceptionsByArticle.get(ex.entityId) ?? []
    list.push({ termId: ex.termId, field: ex.field })
    exceptionsByArticle.set(ex.entityId, list)
  }

  // خطوط یافته‌ها بر اساس دسته
  const fieldProblems: string[] = []
  const fieldItemIds: string[] = []
  const versionProblems: string[] = []
  const versionItemIds: string[] = []
  const blockerProblems: string[] = []
  const blockerItemIds: string[] = []
  const slugProblems: string[] = []
  const mediaProblems: string[] = []
  const mediaItemIds: string[] = []
  const glossaryErrorProblems: string[] = []
  const glossaryWarnProblems: string[] = []
  let glossarySuggestions = 0

  const slugOwners = new Map<string, string[]>() // آدرس کوتاه → اقلام داخل بسته
  const coverIds = Array.from(new Set(items.map((it) => it.article.coverImageId).filter((v): v is string => !!v)))
  const coverSet = new Set(
    coverIds.length
      ? (await db.media.findMany({ where: { id: { in: coverIds } }, select: { id: true } })).map((m) => m.id)
      : []
  )

  for (const item of items) {
    const article = item.article
    const versions = versionsByArticle.get(article.id) ?? []
    const vNums = versionNumberMap(versions)
    const bound = item.versionId ? versions.find((v) => v.id === item.versionId) ?? null : null
    const latest = versions[versions.length - 1] ?? null

    // فیلدهای ملاک بررسی: نسخه متصل‌شده (و در نبودش وضعیت زندهٔ مقاله) + سئو و آدرس از خود مقاله
    const fields: Record<GlossaryFieldType | PlaceholderFieldType, string> = {
      TITLE: bound ? bound.title : article.title,
      EXCERPT: bound ? bound.excerpt : article.excerpt,
      CONTENT: bound ? bound.content : article.content,
      SEO_TITLE: article.seoTitle ?? '',
      SEO_DESCRIPTION: article.seoDescription ?? '',
    }

    // ── a) فیلدهای ضروری و جای‌نگهدارها ──
    const itemFieldProblems: string[] = []
    if (!fields.TITLE.trim()) itemFieldProblems.push('عنوان خالی است.')
    if (!article.slug.trim()) itemFieldProblems.push('آدرس کوتاه خالی است.')
    if (!fields.CONTENT.trim()) itemFieldProblems.push('متن اصلی خالی است.')
    const placeholders = findPlaceholders(fields)
    if (placeholders.length > 0) {
      const labels = Array.from(new Set(placeholders.map((p) => `${PLACEHOLDER_FIELD_LABELS[p.field]} («${p.label}»)`)))
      itemFieldProblems.push(`جای‌نگهدار ناتمام در: ${labels.join('، ')}`)
    }
    if (itemFieldProblems.length > 0) {
      fieldProblems.push(`«${article.title}»: ${itemFieldProblems.join(' ')}`)
      fieldItemIds.push(item.id)
    }

    // ── b) نسخه و وضعیت مقاله ──
    if (!item.versionId) {
      versionProblems.push(`«${article.title}»: نسخه‌ای انتخاب نشده است؛ نسخه قلم را مشخص کنید.`)
      versionItemIds.push(item.id)
    } else if (!bound) {
      versionProblems.push(`«${article.title}»: نسخه پیوندشده یافت نشد؛ نسخه را دوباره انتخاب کنید.`)
      versionItemIds.push(item.id)
    } else if (article.status !== 'APPROVED' && article.status !== 'PUBLISHED') {
      versionProblems.push(
        `«${article.title}»: مقاله هنوز تأیید نشده است (وضعیت فعلی: ${articleStatusFa(article.status)})؛ ابتدا مقاله باید تأیید شود.`
      )
      versionItemIds.push(item.id)
    } else if (!latest || latest.id !== item.versionId) {
      const selectedNum = vNums.get(item.versionId) ?? 0
      versionProblems.push(
        `«${article.title}»: نسخه جدیدی پس از انتخاب ثبت شده است؛ نسخه را به‌روز کنید (انتخاب‌شده: نسخه ${selectedNum}، نسخه فعلی: نسخه ${versions.length}).`
      )
      versionItemIds.push(item.id)
    }

    // ── c) کارهای باز مرتبط (هشدار) ──
    const openTasks = await db.task.count({
      where: { relatedType: 'ARTICLE', relatedId: article.id, type: { in: ['REVIEW', 'REVISION'] }, status: 'OPEN' },
    })
    if (openTasks > 0) {
      blockerProblems.push(`«${article.title}»: ${openTasks} کار باز مرتبط وجود دارد؛ پیش از انتشار بررسی شود.`)
      blockerItemIds.push(item.id)
    }

    // ── d) آدرس‌های کوتاه (جمع‌آوری برای بررسی تداخل) ──
    if (article.slug) {
      const owners = slugOwners.get(article.slug) ?? []
      owners.push(article.title)
      slugOwners.set(article.slug, owners)
    }

    // ── e) رسانه‌ها ──
    const itemMediaProblems: string[] = []
    if (article.coverImageId && !coverSet.has(article.coverImageId)) {
      itemMediaProblems.push('تصویر شاخص در کتابخانه رسانه یافت نشد.')
    }
    const refIds = extractMediaIds(fields.CONTENT)
    if (refIds.length > 0) {
      const found = await db.media.findMany({ where: { id: { in: refIds } }, select: { id: true } })
      const foundSet = new Set(found.map((f) => f.id))
      const missing = refIds.filter((id) => !foundSet.has(id))
      if (missing.length > 0) {
        itemMediaProblems.push(`${missing.length} ارجاع رسانه در متن یافت نشد (/api/media).`)
      }
    }
    if (itemMediaProblems.length > 0) {
      mediaProblems.push(`«${article.title}»: ${itemMediaProblems.join(' ')}`)
      mediaItemIds.push(item.id)
    }

    // ── f) واژه‌نامه برند ──
    if (rules.length > 0) {
      const findings = checkFieldsWithRules(fields, rules, exceptionsByArticle.get(article.id) ?? [])
      const enforcing = findings.filter((f) => f.severity === 'ENFORCING')
      const warnings = findings.filter((f) => f.severity === 'WARNING')
      glossarySuggestions += findings.filter((f) => f.severity === 'SUGGESTION').length
      if (enforcing.length > 0) {
        const samples = enforcing.slice(0, 3).map((f) => `«${f.observed}» به‌جای «${f.preferred || '—'}» در ${GLOSSARY_FIELD_LABELS[f.field]}`)
        glossaryErrorProblems.push(
          `«${article.title}»: ${enforcing.length} مورد الزام‌آور واژه‌نامه؛ مانند ${samples.join('، ')}.`
        )
      }
      if (warnings.length > 0) {
        const samples = warnings.slice(0, 3).map((f) => `«${f.observed}» به‌جای «${f.preferred || '—'}» در ${GLOSSARY_FIELD_LABELS[f.field]}`)
        glossaryWarnProblems.push(
          `«${article.title}»: ${warnings.length} مورد هشدار واژه‌نامه؛ مانند ${samples.join('، ')}.`
        )
      }
    }
  }

  // ── d) تکمیل بررسی آدرس‌ها ──
  const allSlugs = Array.from(slugOwners.keys()).filter((s) => s.trim() !== '')
  const itemArticleIds = articleIds
  if (allSlugs.length > 0) {
    // تکراری داخل بسته
    for (const [slug, titles] of slugOwners) {
      if (titles.length > 1) {
        slugProblems.push(`آدرس کوتاه «${slug}» در بسته تکراری است (${titles.map((t) => `«${t}»`).join('، ')}).`)
      }
    }
    // تداخل با مقاله منتشرشده دیگر
    const conflictingArticles = await db.article.findMany({
      where: { slug: { in: allSlugs }, status: 'PUBLISHED', id: { notIn: itemArticleIds } },
      select: { title: true, slug: true },
    })
    for (const a of conflictingArticles) {
      slugProblems.push(`آدرس کوتاه «${a.slug}» با مقاله منتشرشدهٔ دیگری («${a.title}») تداخل دارد.`)
    }
    // تداخل با صفحه‌ها
    const conflictingPages = await db.page.findMany({ where: { slug: { in: allSlugs } }, select: { title: true, slug: true } })
    for (const p of conflictingPages) {
      slugProblems.push(`آدرس کوتاه «${p.slug}» با صفحه «${p.title}» تداخل دارد.`)
    }
  }

  // ── ترکیب بررسی‌ها ──
  pushCheck(checks, 'required-fields', 'فیلدهای ضروری و جای‌نگهدارها', fieldProblems, fieldItemIds)
  pushCheck(checks, 'versions', 'نسخه و وضعیت مقالات', versionProblems, versionItemIds)
  pushCheck(checks, 'blockers', 'کارهای باز مرتبط', blockerProblems, blockerItemIds, true)
  pushCheck(checks, 'slugs', 'آدرس‌های کوتاه', slugProblems, [])
  pushCheck(checks, 'media', 'رسانه‌ها', mediaProblems, mediaItemIds)
  pushCheck(checks, 'glossary', 'واژه‌نامه برند', glossaryErrorProblems, [], false)

  // هشدارهای واژه‌نامه فقط اگر خطای الزام‌آور در همان دسته نباشد
  if (glossaryErrorProblems.length === 0 && glossaryWarnProblems.length > 0) {
    checks.push({
      key: 'glossary-warnings',
      label: 'واژه‌نامه برند',
      level: 'WARNING',
      detail: glossaryWarnProblems.join('\n'),
    })
  } else if (glossaryErrorProblems.length === 0 && glossaryWarnProblems.length === 0 && glossarySuggestions > 0) {
    checks.push({
      key: 'glossary-warnings',
      label: 'واژه‌نامه برند',
      level: 'OK',
      detail: `مواردی یافت نشد. (${glossarySuggestions} پیشنهاد سبک نگارش در جزئیات ویرایشگر موجود است.)`,
    })
  }

  const hasError = checks.some((c) => c.level === 'ERROR')
  const hasWarning = checks.some((c) => c.level === 'WARNING')
  const state: ReadinessState = hasError ? 'BLOCKED' : hasWarning ? 'READY_WARNINGS' : 'READY'

  // ذخیره نتیجه روی بسته + ثبت در سابقه بسته
  await db.publishBundle.update({
    where: { id: bundleId },
    data: { readinessState: state, readinessJson: JSON.stringify(checks) },
  })
  await db.bundleHistory.create({
    data: {
      bundleId,
      kind: 'READINESS_RUN',
      message: `بررسی آمادگی اجرا شد؛ نتیجه: ${
        state === 'BLOCKED' ? 'مسدود' : state === 'READY_WARNINGS' ? 'آماده با هشدار' : 'آماده'
      }`,
      userId: actor?.id ?? null,
      userName: actor?.name ?? 'سیستم',
    },
  })

  return { state, checks }
}
