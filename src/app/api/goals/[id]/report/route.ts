/**
 * API گزارش عملکرد هدف
 * GET /api/goals/[id]/report?days=7 — دسترسی، تعامل، نتیجه، قیف، روند، کیفیت داده و سابقهٔ انتشار
 * همهٔ شاخص‌ها با تعریف ثابت صورت/مخرج و منطقهٔ زمانی Asia/Tehran محاسبه می‌شوند
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handleApiError, ok, requirePermission } from '@/lib/api-utils'
import { computeGoalReport } from '@/lib/analytics'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('analytics.view')
    const { id } = await params
    const goal = await db.contentGoal.findUnique({ where: { id }, include: { article: { select: { id: true, title: true, slug: true, status: true, publishedAt: true } } } })
    if (!goal) return ok({ error: 'هدف یافت نشد.' }, { status: 404 })

    const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 7))
    const from = new Date(Date.now() - (days + 1) * 24 * 3600 * 1000)

    // رویدادهای محتوای هدف — بدون متن فرم و بدون دادهٔ شخصی (قرارداد رویداد)
    const events = await db.analyticsEvent.findMany({
      where: { contentId: goal.contentId, occurredAt: { gte: from } },
      select: { eventType: true, occurredAt: true, visitorId: true, sessionId: true, isInternal: true, isBot: true, isConsented: true },
      // برای مقیاس دمو کافی است؛ در مقیاس بزرگ‌تر از تجمیع از پیش محاسبه‌شده استفاده می‌شود
      take: 50000,
    })

    const report = computeGoalReport(
      { successEvent: goal.successEvent, attributionRule: goal.attributionRule, attributionHours: goal.attributionHours },
      events,
      days
    )

    // سابقهٔ انتشار: نسخه‌های ثبت‌شدهٔ محتوا + اجرای بسته‌های انتشار مرتبط
    const versions = await db.articleVersion.findMany({
      where: { articleId: goal.contentId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, title: true, editorName: true, note: true, createdAt: true },
    })
    const bundleItems = await db.bundleItem.findMany({
      where: { articleId: goal.contentId },
      include: { bundle: { select: { id: true, title: true, status: true, publishedAt: true, timezone: true } } },
      orderBy: { addedAt: 'desc' },
      take: 10,
    })
    const publishHistory = [
      ...versions.map((v) => ({
        kind: 'VERSION' as const,
        label: `نسخهٔ محتوا ثبت شد${v.note ? ` — ${v.note}` : ''}`,
        at: v.createdAt.toISOString(),
        by: v.editorName,
      })),
      ...bundleItems
        .filter((bi) => bi.bundle.publishedAt)
        .map((bi) => ({
          kind: 'PUBLISH' as const,
          label: `انتشار از بستهٔ «${bi.bundle.title}»`,
          at: (bi.bundle.publishedAt as Date).toISOString(),
          by: null as string | null,
        })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1))

    // آزمایش‌های مرتبط با این محتوا
    const experiments = await db.experiment.findMany({
      where: { targetContentId: goal.contentId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, decision: true, changeType: true },
    })

    return ok({ goal, report, publishHistory, experiments })
  } catch (err) {
    return handleApiError(err)
  }
}
