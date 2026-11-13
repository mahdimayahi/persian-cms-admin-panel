/**
 * API رویدادهای تحلیلی
 * POST /api/analytics/events — پذیرش رویدادها (تکی یا دسته‌ای) با قرارداد محدود و مشخص
 *   - شناسهٔ یکتای رویداد: ارسال مجدد همان شناسه شمارش تکراری ایجاد نمی‌کند
 *   - منبع ورود پالایش می‌شود؛ ربات شناخته‌شده و ترافیک داخلی نشانه‌گذاری و از نتیجه کنار می‌روند
 * GET /api/analytics/events — فهرست رویدادهای اخیر (مجوز analytics.view) برای شفافیت
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, requirePermission, checkRateLimit } from '@/lib/api-utils'
import { normalizeEvent, attributeExperimentConversion, EVENT_TYPES } from '@/lib/analytics'

const MAX_BATCH = 200

export async function POST(req: NextRequest) {
  try {
    // محدودیت نرخ: ضد تلاش ورود انبوه
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (!checkRateLimit(`analytics-ingest:${ip}`, 600, 60_000)) {
      throw new ApiError(429, 'حجم درخواست رویداد بیش از حد مجاز است.')
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ApiError(400, 'بدنهٔ درخواست نامعتبر است.')
    }

    // بدنه میتواند آبجکت تکی یا {events:[…]} باشد؛ null/رشته/عدد به‌جای خطای ۵۰۰ به‌عنوان رویداد نامعتبر پذیرش می‌شود
    const rawEvents = (body as { events?: unknown } | null)?.events
    const list: unknown[] = Array.isArray(rawEvents)
      ? rawEvents
      : Array.isArray(body)
        ? (body as unknown[])
        : [body]
    if (list.length === 0 || list.length > MAX_BATCH) {
      throw new ApiError(400, `تعداد رویدادها باید بین ۱ تا ${MAX_BATCH} باشد.`)
    }

    const results: { eventId: string; status: string; reason?: string; group?: string | null }[] = []

    for (const raw of list) {
      // اعضای غیرآبجکتی (null، عدد، رشته، آرایه) رویداد نامعتبر‌اند — خطای سرور ایجاد نمی‌کنند
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        await db.eventIngestLog.create({ data: { eventId: '(بدون شناسه)', status: 'INVALID', reason: 'اعضای دسته باید آبجکت باشند.' } })
        results.push({ eventId: '(بدون شناسه)', status: 'INVALID', reason: 'اعضای دسته باید آبجکت باشند.' })
        continue
      }
      const rec = raw as Record<string, unknown>
      const eventId = typeof rec.eventId === 'string' ? rec.eventId : '(بدون شناسه)'
      const normalized = normalizeEvent(rec)
      if (!normalized.ok) {
        await db.eventIngestLog.create({ data: { eventId: eventId.slice(0, 100), status: 'INVALID', reason: normalized.reason } })
        results.push({ eventId, status: 'INVALID', reason: normalized.reason })
        continue
      }
      const ev = normalized.event

      let group: string | null = null
      let converted = false

      try {
        await db.analyticsEvent.create({
          data: {
            eventId: ev.eventId,
            eventType: ev.eventType,
            occurredAt: ev.occurredAt,
            contentId: ev.contentId,
            contentVersionId: ev.contentVersionId,
            visitorId: ev.visitorId,
            sessionId: ev.sessionId,
            referrer: ev.referrer,
            experimentId: ev.experimentId,
            // گروه نسخه از تخصیص سمت سرور تعیین می‌شود، نه از ادعای کلاینت
            variantGroup: null,
            isInternal: ev.isInternal,
            isBot: ev.isBot,
            isConsented: ev.consent,
            isSimulated: ev.simulated,
          },
        })
        await db.eventIngestLog.create({ data: { eventId: ev.eventId, status: 'ACCEPTED', reason: '' } })
      } catch (err) {
        // نقض یکتایی شناسهٔ رویداد → ارسال مجدد؛ شمارش تکراری ایجاد نمی‌شود اما ثبت می‌گردد
        const code = (err as { code?: string }).code
        if (code === 'P2002') {
          // ارسال مجدد رویداد ثبت‌شده → تکرار شمرده نمیشود؛ اما اگر ثبت قبلی پیش از
          // تخصیص گروه آزمایش نیمه‌کاره مانده باشد (خرابی بین ثبت رویداد و انتساب)،
          // اینجا بر اساس دادهٔ ثبت‌شده در پایگاه داده recovery انجام می‌شود.
          const existing = await db.analyticsEvent.findUnique({
            where: { eventId: ev.eventId },
            select: { experimentId: true, visitorId: true, eventType: true, occurredAt: true, variantGroup: true },
          })
          let dupGroup: string | null = null
          let dupConverted = false
          if (existing && existing.experimentId && existing.variantGroup === null) {
            const attr = await attributeExperimentConversion(db, {
              experimentId: existing.experimentId,
              visitorId: existing.visitorId,
              eventType: existing.eventType,
              occurredAt: existing.occurredAt,
            })
            if (attr.group) {
              dupGroup = attr.group
              dupConverted = attr.converted
              await db.analyticsEvent.update({ where: { eventId: ev.eventId }, data: { variantGroup: attr.group } })
            }
          } else if (existing) {
            dupGroup = existing.variantGroup
          }
          await db.eventIngestLog.create({ data: { eventId: ev.eventId, status: 'DUPLICATE', reason: 'رویداد با همین شناسه قبلاً ثبت شده است.' } })
          const dupEntry: { eventId: string; status: string; reason?: string; group?: string | null } = {
            eventId: ev.eventId,
            status: dupConverted ? 'CONVERTED' : 'DUPLICATE',
            reason: 'رویداد با همین شناسه قبلاً ثبت شده است.',
          }
          if (dupGroup) dupEntry.group = dupGroup
          results.push(dupEntry)
          continue
        }
        throw err
      }

      // اتصال رویدادهای آزمایش به مواجههٔ ثبت‌شده (تعیین گروه سمت سرور + ضد دوباره‌شماری تبدیل)
      if (ev.experimentId) {
        const attr = await attributeExperimentConversion(db, {
          experimentId: ev.experimentId,
          visitorId: ev.visitorId,
          eventType: ev.eventType,
          occurredAt: ev.occurredAt,
        })
        if (attr.group) {
          group = attr.group
          converted = attr.converted
          await db.analyticsEvent.update({ where: { eventId: ev.eventId }, data: { variantGroup: attr.group } })
        }
      }

      const entry: { eventId: string; status: string; reason?: string; group?: string | null } = { eventId: ev.eventId, status: 'ACCEPTED' }
      if (group) entry.group = group
      if (converted) entry.status = 'CONVERTED'
      results.push(entry)
    }

    return ok({ ok: true, results })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('analytics.view')
    const sp = req.nextUrl.searchParams
    const take = Math.min(100, Math.max(1, Number(sp.get('take')) || 40))
    const eventType = sp.get('eventType')
    const contentId = sp.get('contentId')

    const where: Record<string, unknown> = {}
    if (eventType && EVENT_TYPES.includes(eventType as never)) where.eventType = eventType
    if (contentId) where.contentId = contentId

    const items = await db.analyticsEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take,
      select: {
        eventId: true,
        eventType: true,
        occurredAt: true,
        contentId: true,
        visitorId: true,
        referrer: true,
        variantGroup: true,
        isInternal: true,
        isBot: true,
        isConsented: true,
        isSimulated: true,
      },
    })
    return ok({ items })
  } catch (err) {
    return handleApiError(err)
  }
}
