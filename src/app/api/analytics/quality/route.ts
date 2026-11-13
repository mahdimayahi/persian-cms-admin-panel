/**
 * API کیفیت دادهٔ رویدادها
 * GET /api/analytics/quality — پوشش، خارج‌شده‌ها، رویدادهای ردشده و تأخیر به‌روزرسانی
 * اصل: «داده نداریم» نباید به شکل «نتیجهٔ صفر» نمایش داده شود
 */
import { handleApiError, ok, requirePermission } from '@/lib/api-utils'
import { db } from '@/lib/db'
import { REPORT_TIMEZONE, tehranDay } from '@/lib/analytics'

export async function GET() {
  try {
    await requirePermission('analytics.view')
    const now = Date.now()
    const dayAgo = new Date(now - 24 * 3600 * 1000)

    const [totalEvents, viewEvents, internalCount, botCount, noConsentCount, dupLast24, invalidLast24, lastEvent, todayAccepted, todayDup] =
      await Promise.all([
        db.analyticsEvent.count(),
        db.analyticsEvent.count({ where: { eventType: 'PAGE_VIEW' } }),
        db.analyticsEvent.count({ where: { isInternal: true } }),
        db.analyticsEvent.count({ where: { isBot: true } }),
        db.analyticsEvent.count({ where: { isConsented: false } }),
        db.eventIngestLog.count({ where: { status: 'DUPLICATE', createdAt: { gte: dayAgo } } }),
        db.eventIngestLog.count({ where: { status: 'INVALID', createdAt: { gte: dayAgo } } }),
        db.analyticsEvent.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
        db.eventIngestLog.count({ where: { status: 'ACCEPTED', createdAt: { gte: dayAgo } } }),
        db.eventIngestLog.count({ where: { status: 'DUPLICATE', createdAt: { gte: dayAgo } } }),
      ])

    // پوشش تخمینی: سهم رویدادهای دارای رضایت از کل رویدادهای عمومی مشاهده
    const publicViews = await db.analyticsEvent.count({ where: { eventType: 'PAGE_VIEW', isInternal: false, isBot: false } })
    const consentedViews = await db.analyticsEvent.count({ where: { eventType: 'PAGE_VIEW', isConsented: true, isInternal: false, isBot: false } })
    const coveragePercent = publicViews > 0 ? (consentedViews / publicViews) * 100 : null

    const updateDelayMinutes = lastEvent ? Math.floor((now - lastEvent.occurredAt.getTime()) / 60_000) : null

    return ok({
      timezone: REPORT_TIMEZONE,
      today: tehranDay(new Date(now)),
      totals: { events: totalEvents, views: viewEvents },
      excluded: { internal: internalCount, bots: botCount, noConsent: noConsentCount },
      coveragePercent,
      ingest: { accepted24h: todayAccepted, duplicates24h: dupLast24, invalid24h: invalidLast24, duplicatesTotal: await db.eventIngestLog.count({ where: { status: 'DUPLICATE' } }) },
      updateDelayMinutes,
      lastEventAt: lastEvent?.occurredAt.toISOString() ?? null,
      notes: [
        'عدم رضایت ردیابی، مسدودکننده‌ها و ربات‌ها پوشش را کاهش می‌دهند؛ پوشش تخمینی است.',
        'رویدادهای تکراری و نامعتبر شمرده نمی‌شوند اما در دفتر پذیرش ثبت می‌گردند.',
        'به‌روزرسانی گزارش‌ها با تأخیر جمع‌آوری همراه است.',
      ],
    })
  } catch (err) {
    return handleApiError(err)
  }
}
