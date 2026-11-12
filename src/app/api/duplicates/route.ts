/**
 * تشخیص موارد تکراری (دسته‌بندی و برچسب)
 * GET /api/duplicates?type=category|tag
 * معیار تشابه (نسخه اولیه): یکسان‌سازی ی/ك، نیم‌فاصله، فاصله اضافه و حروف بزرگ؛
 * سپس برابری کامل یا شمول یکی در دیگری.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission } from '@/lib/api-utils'

/** یکسان‌سازی متن فارسی برای مقایسه */
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

type DuplicatePair = {
  reason: string
  a: { id: string; name: string; count: number; createdAt: string }
  b: { id: string; name: string; count: number; createdAt: string }
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('articles.view')
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') ?? 'category'

    if (type !== 'category' && type !== 'tag') {
      throw new ApiError(400, 'نوع پشتیبانی‌شده: category یا tag')
    }

    const pairs: DuplicatePair[] = []

    if (type === 'category') {
      const items = await db.category.findMany({
        select: { id: true, name: true, createdAt: true, _count: { select: { articles: true } } },
        orderBy: { createdAt: 'asc' },
      })
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const na = normalizeName(items[i].name)
          const nb = normalizeName(items[j].name)
          if (!na || !nb) continue
          let reason: string | null = null
          if (na === nb) reason = 'نام یکسان (با در نظر گرفتن تفاوت‌های نگارشی)'
          else if (na.includes(nb) || nb.includes(na)) reason = 'نام یکی شامل دیگری است'
          if (reason) {
            const [older, newer] = items[i].createdAt <= items[j].createdAt ? [items[i], items[j]] : [items[j], items[i]]
            pairs.push({
              reason,
              a: { id: older.id, name: older.name, count: older._count.articles, createdAt: older.createdAt.toISOString() },
              b: { id: newer.id, name: newer.name, count: newer._count.articles, createdAt: newer.createdAt.toISOString() },
            })
          }
        }
      }
    } else {
      const items = await db.tag.findMany({
        select: { id: true, name: true, _count: { select: { articles: true } } },
        orderBy: { name: 'asc' },
      })
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const na = normalizeName(items[i].name)
          const nb = normalizeName(items[j].name)
          if (!na || !nb) continue
          let reason: string | null = null
          if (na === nb) reason = 'نام یکسان (با در نظر گرفتن تفاوت‌های نگارشی)'
          else if (na.includes(nb) || nb.includes(na)) reason = 'نام یکی شامل دیگری است'
          if (reason) {
            pairs.push({
              reason,
              a: { id: items[i].id, name: items[i].name, count: items[i]._count.articles, createdAt: '' },
              b: { id: items[j].id, name: items[j].name, count: items[j]._count.articles, createdAt: '' },
            })
          }
        }
      }
    }

    return ok({ type, pairs })
  } catch (err) {
    return handleApiError(err)
  }
}
