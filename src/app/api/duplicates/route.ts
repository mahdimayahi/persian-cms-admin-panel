/**
 * تشخیص موارد تکراری (برچسب و دسته‌بندی) — فاز ۳
 * GET /api/duplicates?type=tag|category
 *
 * معیارهای تشخیص:
 *  - EXACT_NORMALIZED (قوی): برابری کامل نام پس از یکسان‌سازی «ی/ي» و «ک/ك»، حذف اعراب/نیم‌فاصله/فاصله اضافه
 *  - SLUG_EQUAL (قوی): برابری شناسه (آدرس) پس از همان یکسان‌سازی
 *  - CONTAINS (ضعیف): شمول یکی در دیگری (هر دو حداقل ۳ نویسه) — فقط پیشنهاد بررسی
 * جفت‌های «غیرتکراری» علامت‌خورده (DuplicateDismissal) از خروجی حذف می‌شوند.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission } from '@/lib/api-utils'

/** یکسان‌سازی متن فارسی برای مقایسه (ی←ي، ک←ك، حذف اعراب ۰۶۴B-۰۶۵F، ط/تطویل ۰۶۴۰، نیم‌فاصله، فاصله‌ها، حروف کوچک) */
export function normalizeName(value: string): string {
  return value
    .replace(/\u064A/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u200c\u064B-\u065F]/g, '')
    .replace(/[\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

type DupType = 'tag' | 'category'
type Strength = 'strong' | 'weak'

/** یک سمتِ جفت تکراری */
interface DuplicateSide {
  id: string
  name: string
  slug: string
  description: string | null
  count: number // تعداد مقالات متصل
  createdAt: string // ISO — برچسب createdAt ندارد → رشتهٔ خالی
  parentName?: string | null // فقط دسته‌بندی
  childrenCount?: number // فقط دسته‌بندی
  sharedCount: number // تعداد مقاله‌های مشترک بین دو سمت (فقط برچسب؛ دسته‌بندی: ۰)
}

interface DuplicatePair {
  key: string // `${a.id}|${b.id}`
  reason: string
  strength: Strength
  a: DuplicateSide
  b: DuplicateSide
}

const REASON_EXACT = (label: string) =>
  `این دو ${label} پس از یکسان‌سازی «ی» و «ي» (و فاصله‌ها) نام یکسانی دارند.`
const REASON_SLUG = 'شناسه (آدرس) یکسانی دارند.'
const REASON_CONTAINS = 'شباهت نام، دلیل کافی برای ادغام نیست؛ فقط برای بررسی پیشنهاد شده است.'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('articles.view')
    const { searchParams } = new URL(req.url)
    const type = (searchParams.get('type') ?? 'category') as DupType

    if (type !== 'category' && type !== 'tag') {
      throw new ApiError(400, 'نوع پشتیبانی‌شده: category یا tag')
    }

    const entityType = type === 'tag' ? 'TAG' : 'CATEGORY'

    // جفت‌هایی که کاربر قبلاً «غیرتکراری» علامت داده — در همین نوع موجودیت
    const dismissals = await db.duplicateDismissal.findMany({
      where: { entityType },
      select: { idA: true, idB: true },
    })
    const dismissedKeys = new Set(dismissals.map((d) => (d.idA < d.idB ? `${d.idA}|${d.idB}` : `${d.idB}|${d.idA}`)))

    // شمارش مقاله‌های مشترک برای برچسب‌ها: هر مقاله به مجموعهٔ برچسب‌هایش نگاشت می‌شود
    const sharedByArticle = new Map<string, Set<string>>()
    if (type === 'tag') {
      const tags = await db.tag.findMany({ where: { mergedIntoId: null }, select: { id: true } })
      if (tags.length > 0) {
        const links = await db.articleTag.findMany({
          where: { tagId: { in: tags.map((t) => t.id) } },
          select: { articleId: true, tagId: true },
        })
        for (const link of links) {
          let set = sharedByArticle.get(link.articleId)
          if (!set) {
            set = new Set<string>()
            sharedByArticle.set(link.articleId, set)
          }
          set.add(link.tagId)
        }
      }
    }
    const sharedCountOf = (idA: string, idB: string): number => {
      let total = 0
      for (const set of sharedByArticle.values()) {
        if (set.has(idA) && set.has(idB)) total++
      }
      return total
    }

    let pairs: DuplicatePair[] = []

    if (type === 'category') {
      const items = await db.category.findMany({
        where: { mergedIntoId: null },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          createdAt: true,
          parent: { select: { name: true } },
          _count: { select: { articles: true, children: true } },
        },
        orderBy: { createdAt: 'asc' },
      })

      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const na = normalizeName(items[i].name)
          const nb = normalizeName(items[j].name)
          if (!na || !nb) continue

          const reasons: string[] = []
          let strong = false
          if (na === nb) {
            reasons.push(REASON_EXACT('دسته‌بندی'))
            strong = true
          }
          const sa = normalizeName(items[i].slug)
          const sb = normalizeName(items[j].slug)
          if (sa && sa === sb) {
            reasons.push(REASON_SLUG)
            strong = true
          }
          // شمول فقط وقتی معنا دارد که برابری کامل نباشد
          if (!strong && na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) {
            reasons.push(REASON_CONTAINS)
          }
          if (reasons.length === 0) continue

          // اول رکورد قدیمی‌تر (orderBy createdAt) → a
          const [x, y] = items[i].createdAt <= items[j].createdAt ? [items[i], items[j]] : [items[j], items[i]]
          const key = `${x.id}|${y.id}`
          if (dismissedKeys.has(key) || dismissedKeys.has(`${y.id}|${x.id}`)) continue

          pairs.push({
            key,
            reason: reasons.join(' '),
            strength: strong ? 'strong' : 'weak',
            a: {
              id: x.id,
              name: x.name,
              slug: x.slug,
              description: x.description,
              count: x._count.articles,
              createdAt: x.createdAt.toISOString(),
              parentName: x.parent?.name ?? null,
              childrenCount: x._count.children,
              sharedCount: 0,
            },
            b: {
              id: y.id,
              name: y.name,
              slug: y.slug,
              description: y.description,
              count: y._count.articles,
              createdAt: y.createdAt.toISOString(),
              parentName: y.parent?.name ?? null,
              childrenCount: y._count.children,
              sharedCount: 0,
            },
          })
        }
      }
    } else {
      const items = await db.tag.findMany({
        where: { mergedIntoId: null },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { articles: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })

      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const na = normalizeName(items[i].name)
          const nb = normalizeName(items[j].name)
          if (!na || !nb) continue

          const reasons: string[] = []
          let strong = false
          if (na === nb) {
            reasons.push(REASON_EXACT('برچسب'))
            strong = true
          }
          const sa = normalizeName(items[i].slug)
          const sb = normalizeName(items[j].slug)
          if (sa && sa === sb) {
            reasons.push(REASON_SLUG)
            strong = true
          }
          if (!strong && na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) {
            reasons.push(REASON_CONTAINS)
          }
          if (reasons.length === 0) continue

          // برچسب createdAt ندارد → ترتیب الفبایی نام سپس id (همان ترتیب واکشی)
          const x = items[i]
          const y = items[j]
          const key = `${x.id}|${y.id}`
          if (dismissedKeys.has(key) || dismissedKeys.has(`${y.id}|${x.id}`)) continue

          pairs.push({
            key,
            reason: reasons.join(' '),
            strength: strong ? 'strong' : 'weak',
            a: {
              id: x.id,
              name: x.name,
              slug: x.slug,
              description: null,
              count: x._count.articles,
              createdAt: '',
              sharedCount: sharedCountOf(x.id, y.id),
            },
            b: {
              id: y.id,
              name: y.name,
              slug: y.slug,
              description: null,
              count: y._count.articles,
              createdAt: '',
              sharedCount: sharedCountOf(x.id, y.id),
            },
          })
        }
      }
    }

    // مرتب‌سازی: ابتدا قوی‌ها، سپس بر اساس مجموع تعداد مقالات (نزولی)
    pairs = pairs.sort((p1, p2) => {
      if (p1.strength !== p2.strength) return p1.strength === 'strong' ? -1 : 1
      return p2.a.count + p2.b.count - (p1.a.count + p1.b.count)
    })

    return ok({ type, pairs })
  } catch (err) {
    return handleApiError(err)
  }
}
