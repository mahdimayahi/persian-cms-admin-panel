/**
 * گزارش‌های سامانه
 * GET /api/reports — (مجوز reports.view)
 * شامل: توزیع وضعیت مقالات، مقالات به تفکیک دسته‌بندی، روند انتشار ۳۰ روز اخیر،
 * پربازدیدترین مقالات، وضعیت دیدگاه‌ها و فرم‌ها، حجم رسانه و توزیع نقش کاربران
 */
import { db } from '@/lib/db'
import { ok, handleApiError, requirePermission } from '@/lib/api-utils'
import { ARTICLE_STATUSES, COMMENT_STATUSES, FORM_STATUSES } from '@/lib/constants'
import { ROLES, ROLE_LABELS } from '@/lib/permissions'

const DAY_MS = 24 * 60 * 60 * 1000

/** کلید روز به‌صورت YYYY-MM-DD (UTC) */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET() {
  try {
    await requirePermission('reports.view')
    const now = Date.now()

    // بازه ۳۰ روز اخیر (با شروع از ابتدای روز بیست‌ونهم پیش تا امروز)
    const trendStart = new Date(now - 29 * DAY_MS)
    trendStart.setUTCHours(0, 0, 0, 0)

    const [
      articleStatusGroups,
      articleCategoryGroups,
      categories,
      publishedRows,
      topArticles,
      commentGroups,
      formGroups,
      mediaAgg,
      mediaCount,
      userRoleGroups,
    ] = await Promise.all([
      db.article.groupBy({ by: ['status'], _count: { _all: true } }),
      db.article.groupBy({ by: ['categoryId'], _count: { _all: true } }),
      db.category.findMany({ select: { id: true, name: true, color: true } }),
      db.article.findMany({
        where: { status: 'PUBLISHED', publishedAt: { gte: trendStart } },
        select: { publishedAt: true },
      }),
      db.article.findMany({
        orderBy: { views: 'desc' },
        take: 5,
        select: { id: true, title: true, views: true, status: true },
      }),
      db.comment.groupBy({ by: ['status'], _count: { _all: true } }),
      db.formSubmission.groupBy({ by: ['status'], _count: { _all: true } }),
      db.media.aggregate({ _sum: { size: true } }),
      db.media.count(),
      db.user.groupBy({ by: ['role'], _count: { _all: true } }),
    ])

    // ─── توزیع وضعیت مقالات (پر کردن همه وضعیت‌ها حتی با صفر) ──────
    const articlesByStatus = ARTICLE_STATUSES.map((s) => ({
      status: s.value,
      count: articleStatusGroups.find((g) => g.status === s.value)?._count._all ?? 0,
    }))

    // ─── مقالات به تفکیک دسته‌بندی (شامل «بدون دسته‌بندی») ─────────
    const articlesByCategory = articleCategoryGroups.map((g) => {
      if (!g.categoryId) {
        return { name: 'بدون دسته‌بندی', color: '#94a3b8', count: g._count._all }
      }
      const cat = categories.find((c) => c.id === g.categoryId)
      return {
        name: cat?.name ?? 'بدون دسته‌بندی',
        color: cat?.color ?? '#94a3b8',
        count: g._count._all,
      }
    })

    // ─── روند انتشار ۳۰ روز اخیر (پر کردن روزهای بدون انتشار) ─────
    const countsByDay = new Map<string, number>()
    for (const row of publishedRows) {
      if (!row.publishedAt) continue
      const key = dayKey(row.publishedAt)
      countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1)
    }
    const publishTrend: { date: string; count: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const key = dayKey(new Date(now - i * DAY_MS))
      publishTrend.push({ date: key, count: countsByDay.get(key) ?? 0 })
    }

    // ─── وضعیت دیدگاه‌ها و فرم‌ها (پر کردن همه وضعیت‌ها) ───────────
    const commentsByStatus = COMMENT_STATUSES.map((s) => ({
      status: s.value,
      count: commentGroups.find((g) => g.status === s.value)?._count._all ?? 0,
    }))
    const formsByStatus = FORM_STATUSES.map((s) => ({
      status: s.value,
      count: formGroups.find((g) => g.status === s.value)?._count._all ?? 0,
    }))

    // ─── توزیع نقش کاربران (همه نقش‌ها حتی با صفر) ─────────────────
    const usersByRole = ROLES.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      count: userRoleGroups.find((g) => g.role === role)?._count._all ?? 0,
    }))

    return ok({
      articlesByStatus,
      articlesByCategory,
      publishTrend,
      topArticles,
      commentsByStatus,
      formsByStatus,
      storageUsed: mediaAgg._sum.size ?? 0,
      mediaCount,
      usersByRole,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
