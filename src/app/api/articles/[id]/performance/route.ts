/**
 * API عملکرد یک مقاله
 * GET /api/articles/[id]/performance — خلاصهٔ نتیجهٔ هدف‌های تعریف‌شده برای این محتوا (analytics.view)
 * برای بخش «عملکرد» در صفحهٔ جزئیات محتوا
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handleApiError, ok, requirePermission } from '@/lib/api-utils'
import { computeGoalReport } from '@/lib/analytics'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('analytics.view')
    const { id } = await params
    const article = await db.article.findUnique({ where: { id }, select: { id: true, title: true } })
    if (!article) return ok({ error: 'مقاله یافت نشد.' }, { status: 404 })

    const goals = await db.contentGoal.findMany({
      where: { contentId: id, status: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: { createdAt: 'desc' },
    })

    const days = 7
    const from = new Date(Date.now() - (days + 1) * 24 * 3600 * 1000)
    const events = await db.analyticsEvent.findMany({
      where: { contentId: id, occurredAt: { gte: from } },
      select: { eventType: true, occurredAt: true, visitorId: true, sessionId: true, isInternal: true, isBot: true, isConsented: true },
      take: 20000,
    })

    const performances = goals.map((goal) => {
      const report = computeGoalReport(
        { successEvent: goal.successEvent, attributionRule: goal.attributionRule, attributionHours: goal.attributionHours },
        events,
        days
      )
      return {
        goal: { id: goal.id, title: goal.title, metricLabel: goal.metricLabel, status: goal.status },
        views: report.access.views,
        measurableVisitors: report.access.measurableVisitors,
        conversions: report.outcome.conversionVisitors,
        conversionRate: report.outcome.conversionRate,
        hasSufficientData: report.quality.hasSufficientData,
        trend: report.trend.slice(-14),
        timezone: report.range.timezone,
      }
    })

    return ok({ article, performances, days })
  } catch (err) {
    return handleApiError(err)
  }
}
