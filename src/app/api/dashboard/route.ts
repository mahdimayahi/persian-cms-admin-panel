/**
 * داده‌های داشبورد مدیریتی
 * GET /api/dashboard — برای همه کاربران احراز هویت‌شده
 * شامل آمار کلی، روند انتشار ۱۴ روز اخیر، آخرین فعالیت‌ها،
 * مقالات در انتظار بازبینی (در صورت داشتن مجوز) و پیش‌نویس‌های کاربر جاری
 */
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'
import { roleHasPermission } from '@/lib/permissions'

const DAY_MS = 24 * 60 * 60 * 1000

/** کلید روز به‌صورت YYYY-MM-DD (UTC) */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET() {
  try {
    const user = await requireAuth()
    const now = Date.now()

    const canReview = roleHasPermission(user.role, 'articles.review')

    // بازه ۱۴ روز اخیر (با شروع از ابتدای روز سیزدهم پیش تا امروز)
    const trendStart = new Date(now - 13 * DAY_MS)
    trendStart.setUTCHours(0, 0, 0, 0)

    const [
      totalArticles,
      published,
      drafts,
      inReview,
      pendingComments,
      totalUsers,
      mediaCount,
      newForms,
      viewsAgg,
      publishedRows,
      recentActivity,
      pendingReview,
      myDrafts,
    ] = await Promise.all([
      db.article.count(),
      db.article.count({ where: { status: 'PUBLISHED' } }),
      db.article.count({ where: { status: 'DRAFT' } }),
      db.article.count({ where: { status: 'IN_REVIEW' } }),
      db.comment.count({ where: { status: 'PENDING' } }),
      db.user.count({ where: { status: { in: ['ACTIVE', 'INVITED'] } } }),
      db.media.count(),
      db.formSubmission.count({ where: { status: 'NEW' } }),
      db.article.aggregate({ _sum: { views: true } }),
      db.article.findMany({
        where: { status: 'PUBLISHED', publishedAt: { gte: trendStart } },
        select: { publishedAt: true },
      }),
      db.activityLog.findMany({ take: 6, orderBy: { createdAt: 'desc' } }),
      canReview
        ? db.article.findMany({
            where: { status: 'IN_REVIEW' },
            take: 5,
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              title: true,
              updatedAt: true,
              author: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      db.article.findMany({
        where: { authorId: user.id, status: { in: ['DRAFT', 'NEEDS_REVISION'] } },
        take: 4,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, updatedAt: true, status: true },
      }),
    ])

    // تجمیع روند انتشار در ۱۴ روز اخیر (پر کردن روزهای بدون انتشار با صفر)
    const countsByDay = new Map<string, number>()
    for (const row of publishedRows) {
      if (!row.publishedAt) continue
      const key = dayKey(row.publishedAt)
      countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1)
    }
    const trend: { date: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const key = dayKey(new Date(now - i * DAY_MS))
      trend.push({ date: key, count: countsByDay.get(key) ?? 0 })
    }

    return ok({
      stats: {
        totalArticles,
        published,
        drafts,
        inReview,
        pendingComments,
        totalUsers,
        mediaCount,
        newForms,
        totalViews: viewsAgg._sum.views ?? 0,
      },
      trend,
      recentActivity,
      pendingReview,
      myDrafts,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
