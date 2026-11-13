/**
 * کتابخانه سنجش نتیجه محتوا (مرحله ۴)
 * - قرارداد رویدادهای محدود و مشخص (بدون دادهٔ شخصی و بدون متن فرم)
 * - پالایش منبع ورود و پارامترها
 * - تشخیص ربات شناخته‌شده و ترافیک داخلی
 * - ضد شمارش تکراری با شناسهٔ یکتای رویداد
 * - محاسبهٔ قیف، نرخ تبدیل با تعریف ثابت صورت/مخرج و منطقهٔ زمانی Asia/Tehran
 * - آمار: بازهٔ عدم‌قطعیت ویلسون، اختلاف دو نرخ و آزمون SRM
 */

import type { PrismaClient } from '@prisma/client'

// ─── قرارداد رویدادها ─────────────────────────────────────────────

export const EVENT_TYPES = [
  'PAGE_VIEW',
  'CTA_CLICK',
  'FORM_START',
  'FORM_SUCCESS',
  'FORM_INVALID',
  'SIGNUP',
  'PURCHASE',
] as const
export type AnalyticsEventType = (typeof EVENT_TYPES)[number]

export const EVENT_TYPE_LABELS: Record<AnalyticsEventType, string> = {
  PAGE_VIEW: 'مشاهده محتوا',
  CTA_CLICK: 'کلیک روی فراخوان اقدام',
  FORM_START: 'شروع فرم',
  FORM_SUCCESS: 'ثبت موفق فرم',
  FORM_INVALID: 'ثبت نامعتبر فرم (خطا)',
  SIGNUP: 'ثبت‌نام موفق',
  PURCHASE: 'خرید موفق',
}

/** رویدادهای موفقیت مجاز برای هدف محتوا */
export const SUCCESS_EVENTS: AnalyticsEventType[] = ['FORM_SUCCESS', 'SIGNUP', 'PURCHASE']

export const EVENT_FILTER = {
  SUCCESS: 'FORM_SUCCESS',
  SIGNUP: 'SIGNUP',
  PURCHASE: 'PURCHASE',
} as const

// ─── پالایش ورودی ─────────────────────────────────────────────────

/** پالایش منبع ورود: فقط طرح + میزبان + مسیر؛ پارامترها و بخش حذف می‌شوند */
export function sanitizeReferrer(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    const clean = `${u.protocol}//${u.host}${u.pathname}`.slice(0, 200)
    return clean
  } catch {
    // منبع داخلی ساده مثل «direct»
    if (/^[a-z0-9\u0600-\u06FF\s-]{1,40}$/i.test(s)) return s.slice(0, 40)
    return ''
  }
}

/** الگوهای ربات شناخته‌شده */
const BOT_PATTERNS = [
  'bot',
  'crawler',
  'spider',
  'slurp',
  'mediapartners',
  'facebookexternalhit',
  'bingpreview',
  'yandex',
  'duckduck',
  'baidu',
  'semrush',
  'ahrefs',
  'mj12',
  'python-requests',
  'curl/',
  'wget',
  'headless',
  'lighthouse',
  'pagespeed',
  'pingdom',
  'uptime',
]

export function detectBot(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string' || !userAgent) return false
  const ua = userAgent.toLowerCase()
  return BOT_PATTERNS.some((p) => ua.includes(p))
}

/** ترافیک داخلی: پیش‌نمایش مدیر یا عامل پنل — هرگز وارد تحلیل نتیجه نمی‌شود */
export function detectInternal(userAgent: unknown, clientHint: unknown): boolean {
  if (typeof clientHint === 'string' && clientHint === 'admin-preview') return true
  if (typeof userAgent === 'string' && userAgent.toLowerCase().includes('cms-admin')) return true
  return false
}

const ID_SAFE = /^[A-Za-z0-9_\-.:]{6,80}$/

export type IncomingEvent = {
  eventId: string
  eventType: AnalyticsEventType
  occurredAt: Date
  contentId: string | null
  contentVersionId: string | null
  visitorId: string
  sessionId: string | null
  referrer: string
  experimentId: string | null
  clientHint: string
  simulated: boolean
  consent: boolean
  userAgent: string
}

export type NormalizedEvent = IncomingEvent & {
  isBot: boolean
  isInternal: boolean
}

/**
 * اعتبارسنجی و نرمال‌سازی یک رویداد ورودی
 * در صورت نامعتبربودن، دلیل مشخص برمی‌گردد (شفافیت کیفیت داده)
 */
export function normalizeEvent(raw: Record<string, unknown>): { ok: true; event: NormalizedEvent } | { ok: false; reason: string } {
  const eventId = typeof raw.eventId === 'string' ? raw.eventId.trim() : ''
  if (!ID_SAFE.test(eventId)) return { ok: false, reason: 'شناسهٔ رویداد نامعتبر است.' }

  const eventType = raw.eventType as AnalyticsEventType
  if (!EVENT_TYPES.includes(eventType)) return { ok: false, reason: 'نوع رویداد مجاز نیست.' }

  const occurredAtRaw = new Date(String(raw.occurredAt ?? ''))
  if (Number.isNaN(occurredAtRaw.getTime())) return { ok: false, reason: 'زمان وقوع نامعتبر است.' }
  const now = Date.now()
  if (occurredAtRaw.getTime() > now + 5 * 60 * 1000) return { ok: false, reason: 'زمان وقوع در آینده است.' }
  if (occurredAtRaw.getTime() < now - 180 * 24 * 3600 * 1000) return { ok: false, reason: 'رویداد بسیار قدیمی است.' }

  const visitorId = typeof raw.visitorId === 'string' ? raw.visitorId.trim() : ''
  if (!ID_SAFE.test(visitorId)) return { ok: false, reason: 'شناسهٔ بازدیدکننده نامعتبر است.' }
  if (visitorId.includes('@')) return { ok: false, reason: 'شناسهٔ بازدیدکننده نباید دادهٔ شخصی باشد.' }

  const contentId = typeof raw.contentId === 'string' ? raw.contentId.trim() : ''
  if (!contentId) return { ok: false, reason: 'شناسهٔ پایدار محتوا الزامی است.' }

  const sessionId = typeof raw.sessionId === 'string' && ID_SAFE.test(raw.sessionId.trim()) ? raw.sessionId.trim() : null
  const contentVersionId = typeof raw.contentVersionId === 'string' ? raw.contentVersionId.trim().slice(0, 80) : null

  // بدون رضایت، رویداد فقط برای سنجش پوشش ذخیره می‌شود و وارد محاسبهٔ نتیجه نمی‌شود
  const consent = raw.consent === undefined ? true : raw.consent === true || raw.consent === 'true'
  const simulated = raw.simulated === true || raw.simulated === 'true'
  const userAgent = typeof raw.userAgent === 'string' ? raw.userAgent.slice(0, 200) : ''
  const clientHint = typeof raw.clientHint === 'string' ? raw.clientHint.slice(0, 30) : 'public-site'

  const experimentId = typeof raw.experimentId === 'string' ? raw.experimentId.trim().slice(0, 40) : null

  return {
    ok: true,
    event: {
      eventId,
      eventType,
      occurredAt: occurredAtRaw,
      contentId,
      contentVersionId,
      visitorId,
      sessionId,
      referrer: sanitizeReferrer(raw.referrer),
      experimentId,
      clientHint,
      simulated,
      consent,
      userAgent,
      isBot: detectBot(userAgent),
      isInternal: detectInternal(userAgent, clientHint),
    },
  }
}

// ─── منطقهٔ زمانی و بازهٔ گزارش ────────────────────────────────────

export const REPORT_TIMEZONE = 'Asia/Tehran'

const tehranDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** برچسب روز تقویمی در منطقهٔ زمانی تهران (yyyy-MM-dd) */
export function tehranDay(date: Date): string {
  return tehranDayFmt.format(date)
}

// ─── آمار ─────────────────────────────────────────────────────────

/** تقریب تابع خطا (Abramowitz–Stegun) */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

/** p-value آزمون مربع کای (درجه آزادی ۱) — برای بررسی عدم تطابق نسبت نمونه (SRM) */
export function chiSquarePValueDf1(chi2: number): number {
  if (!Number.isFinite(chi2) || chi2 < 0) return 1
  return Math.max(0, Math.min(1, 1 - erf(Math.sqrt(chi2 / 2))))
}

/** بازهٔ عدم‌قطعیت ویلسون ۹۵٪ برای یک نسبت */
export function wilsonCI(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0]
  const p = k / n
  const denom = 1 + (z * z) / n
  const center = p + (z * z) / (2 * n)
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (center - spread) / denom), Math.min(1, (center + spread) / denom)]
}

/** بازهٔ عدم‌قطعیت ۹۵٪ برای اختلاف دو نرخ (p2 − p1) — تقریب نرمال */
export function diffCI(
  k1: number,
  n1: number,
  k2: number,
  n2: number,
  z = 1.96
): { diff: number; ci: [number, number] } {
  const p1 = n1 > 0 ? k1 / n1 : 0
  const p2 = n2 > 0 ? k2 / n2 : 0
  const diff = p2 - p1
  const se = Math.sqrt((p1 * (1 - p1)) / Math.max(1, n1) + (p2 * (1 - p2)) / Math.max(1, n2))
  return { diff, ci: [diff - z * se, diff + z * se] }
}

/**
 * بررسی عدم تطابق نسبت نمونه (SRM): مقایسهٔ تعداد مواجه‌شدهٔ هر گروه با نسبت برنامه‌ریزی‌شده
 * p < 0.001 یعنی به‌احتمال زیاد مشکل تخصیص یا ثبت داده — ابتدا کیفیت داده بررسی می‌شود نه اعلام برنده
 */
export function srmCheck(
  countControl: number,
  countVariant: number,
  plannedVariantShare: number
): { chi2: number; pValue: number; expectedControl: number; expectedVariant: number; severity: 'OK' | 'WARN' | 'FAIL' } {
  const total = countControl + countVariant
  const share = Math.min(0.95, Math.max(0.05, plannedVariantShare))
  const expectedVariant = total * share
  const expectedControl = total * (1 - share)
  if (total === 0 || expectedControl < 1 || expectedVariant < 1) {
    return { chi2: 0, pValue: 1, expectedControl, expectedVariant, severity: 'OK' }
  }
  const chi2 =
    Math.pow(countControl - expectedControl, 2) / expectedControl +
    Math.pow(countVariant - expectedVariant, 2) / expectedVariant
  const pValue = chiSquarePValueDf1(chi2)
  const severity = pValue < 0.001 ? 'FAIL' : pValue < 0.01 ? 'WARN' : 'OK'
  return { chi2, pValue, expectedControl, expectedVariant, severity }
}

// ─── محاسبهٔ گزارش هدف ────────────────────────────────────────────

export type GoalEventRow = {
  eventType: string
  occurredAt: Date
  visitorId: string
  sessionId: string | null
  isInternal: boolean
  isBot: boolean
  isConsented: boolean
}

export type GoalReport = {
  range: { days: number; fromDay: string; toDay: string; timezone: string }
  access: { views: number; measurableVisitors: number; totalVisitors: number }
  engagement: { ctaVisitors: number; formStartVisitors: number }
  outcome: { conversions: number; conversionVisitors: number; conversionRate: number | null; rateCi: [number, number] | null; previousRate: number | null }
  funnel: { key: string; label: string; visitors: number; shareOfFirst: number; dropFromPrevPct: number | null }[]
  trend: { day: string; views: number; conversions: number }[]
  quality: {
    hasSufficientData: boolean
    coveragePercent: number | null
    excludedInternalViews: number
    excludedBotViews: number
    noConsentVisitors: number
    lastEventAt: string | null
    notes: string[]
  }
}

export type FunnelStepDef = { key: string; label: string }

/** گام‌های قیف بر اساس رویداد موفقیت هدف */
export function funnelSteps(successEvent: string): FunnelStepDef[] {
  const steps: FunnelStepDef[] = [
    { key: 'PAGE_VIEW', label: 'مشاهدهٔ صفحه' },
    { key: 'CTA_CLICK', label: 'کلیک روی درخواست مشاوره' },
  ]
  if (successEvent === 'FORM_SUCCESS') {
    steps.push({ key: 'FORM_START', label: 'شروع فرم' })
    steps.push({ key: 'FORM_SUCCESS', label: 'ثبت موفق درخواست' })
  } else {
    steps.push({ key: successEvent, label: EVENT_TYPE_LABELS[successEvent as AnalyticsEventType] ?? successEvent })
  }
  return steps
}

type VisitorTimeline = { firstViewAt: number | null; firstViewSession: string | null; steps: Map<string, number> }

/**
 * گزارش هدف: دسترسی، تعامل، نتیجه، روند و کیفیت داده
 * اصل: «داده نداریم» هرگز به شکل «نتیجهٔ صفر» نمایش داده نمی‌شود — hasSufficientData
 */
export function computeGoalReport(
  goal: { successEvent: string; attributionRule: string; attributionHours: number },
  events: GoalEventRow[],
  rangeDays: number
): GoalReport {
  const now = Date.now()
  const fromMs = now - rangeDays * 24 * 3600 * 1000
  const windowMs = goal.attributionHours * 3600 * 1000
  const successKey = goal.successEvent

  // تفکیک در دسترس و خارج‌شده
  const inRange = events.filter((e) => e.occurredAt.getTime() >= fromMs && e.occurredAt.getTime() <= now)
  const internalViews = inRange.filter((e) => e.isInternal && e.eventType === 'PAGE_VIEW').length
  const botViews = inRange.filter((e) => e.isBot && !e.isInternal && e.eventType === 'PAGE_VIEW').length
  const consentedEvents = inRange.filter((e) => e.isConsented && !e.isInternal && !e.isBot)
  const noConsentVisitors = new Set(inRange.filter((e) => !e.isConsented && !e.isInternal && !e.isBot).map((e) => e.visitorId)).size

  const views = consentedEvents.filter((e) => e.eventType === 'PAGE_VIEW')
  const measurableVisitors = new Set(views.map((e) => e.visitorId))

  // خط زمانی هر بازدیدکننده واجد شرایط
  const byVisitor = new Map<string, VisitorTimeline>()
  for (const e of consentedEvents) {
    let tl = byVisitor.get(e.visitorId)
    if (!tl) {
      tl = { firstViewAt: null, firstViewSession: null, steps: new Map() }
      byVisitor.set(e.visitorId, tl)
    }
    if (e.eventType === 'PAGE_VIEW') {
      const t = e.occurredAt.getTime()
      if (tl.firstViewAt === null || t < tl.firstViewAt) {
        tl.firstViewAt = t
        tl.firstViewSession = e.sessionId
      }
    }
    if (!tl.steps.has(e.eventType) || tl.steps.get(e.eventType)! > e.occurredAt.getTime()) {
      tl.steps.set(e.eventType, e.occurredAt.getTime())
    }
  }

  // قیف ترتیبی: هر گام پس از گام قبلی و در پنجرهٔ انتساب از اولین مشاهده
  const stepDefs = funnelSteps(successKey)
  const stepVisitors: number[] = []
  let prevTime = new Map<string, number>()
  for (let i = 0; i < stepDefs.length; i++) {
    const key = stepDefs[i].key
    const reached = new Map<string, number>()
    for (const [visitorId, tl] of byVisitor) {
      if (tl.firstViewAt === null) continue
      if (i === 0) {
        // گام نخست: خود مشاهده
        reached.set(visitorId, tl.firstViewAt)
        continue
      }
      const t = tl.steps.get(key)
      if (t === undefined) continue
      const prevT = prevTime.get(visitorId)
      if (prevT === undefined || t < prevT) continue
      if (t - tl.firstViewAt > windowMs) continue
      if (goal.attributionRule === 'SAME_SESSION' && tl.firstViewSession && !hasSessionEvent(consentedEvents, visitorId, key, tl.firstViewSession)) continue
      reached.set(visitorId, t)
    }
    stepVisitors.push(reached.size)
    prevTime = reached
  }

  const firstCount = stepVisitors[0] ?? 0
  const funnel = stepDefs.map((s, i) => ({
    key: s.key,
    label: s.label,
    visitors: stepVisitors[i],
    shareOfFirst: firstCount > 0 ? stepVisitors[i] / firstCount : 0,
    dropFromPrevPct: i > 0 && stepVisitors[i - 1] > 0 ? 1 - stepVisitors[i] / stepVisitors[i - 1] : null,
  }))

  // تبدیل: بازدیدکننده‌ای که رویداد موفقیت را پس از مشاهده و در پنجره ثبت کرده است
  let conversionVisitors = 0
  let conversions = 0
  for (const [visitorId, tl] of byVisitor) {
    if (tl.firstViewAt === null) continue
    const t = tl.steps.get(successKey)
    if (t === undefined) continue
    if (t < tl.firstViewAt) continue
    if (t - tl.firstViewAt > windowMs) continue
    if (goal.attributionRule === 'SAME_SESSION' && tl.firstViewSession && !hasSessionEvent(consentedEvents, visitorId, successKey, tl.firstViewSession)) continue
    conversionVisitors++
    conversions++
  }

  const measurable = measurableVisitors.size
  const rate = measurable > 0 ? conversionVisitors / measurable : null
  const rateCi = measurable > 0 ? wilsonCI(conversionVisitors, measurable) : null

  // نرخ بازهٔ قبلی (مقایسهٔ توصیفی؛ اثبات اثر فقط با آزمایش)
  const prevFrom = fromMs - rangeDays * 24 * 3600 * 1000
  const prevEvents = events.filter((e) => e.occurredAt.getTime() >= prevFrom && e.occurredAt.getTime() < fromMs)
  const prevConsented = prevEvents.filter((e) => e.isConsented && !e.isInternal && !e.isBot)
  const prevByVisitor = new Map<string, VisitorTimeline>()
  for (const e of prevConsented) {
    let tl = prevByVisitor.get(e.visitorId)
    if (!tl) {
      tl = { firstViewAt: null, firstViewSession: null, steps: new Map() }
      prevByVisitor.set(e.visitorId, tl)
    }
    if (e.eventType === 'PAGE_VIEW') {
      const t = e.occurredAt.getTime()
      if (tl.firstViewAt === null || t < tl.firstViewAt) tl.firstViewAt = t
    }
    if (!tl.steps.has(e.eventType) || tl.steps.get(e.eventType)! > e.occurredAt.getTime()) {
      tl.steps.set(e.eventType, e.occurredAt.getTime())
    }
  }
  let prevMeasurable = 0
  let prevConverted = 0
  for (const [, tl] of prevByVisitor) {
    if (tl.firstViewAt === null) continue
    prevMeasurable++
    const t = tl.steps.get(successKey)
    if (t !== undefined && t >= tl.firstViewAt && t - tl.firstViewAt <= windowMs) prevConverted++
  }
  const previousRate = prevMeasurable > 0 ? prevConverted / prevMeasurable : null

  // روند روزانه (منطقهٔ زمانی تهران)
  const trendMap = new Map<string, { views: number; conversions: number }>()
  const convertedVisitorsSet = new Set<string>()
  for (const [visitorId, tl] of byVisitor) {
    if (tl.firstViewAt === null) continue
    const t = tl.steps.get(successKey)
    if (t !== undefined && t >= tl.firstViewAt && t - tl.firstViewAt <= windowMs) convertedVisitorsSet.add(visitorId)
  }
  for (const e of consentedEvents) {
    const day = tehranDay(e.occurredAt)
    let row = trendMap.get(day)
    if (!row) {
      row = { views: 0, conversions: 0 }
      trendMap.set(day, row)
    }
    if (e.eventType === 'PAGE_VIEW') row.views++
  }
  // تبدیل روی روز وقوع رویداد موفقیتِ منتسب
  const successVisitorDay = new Map<string, string>()
  for (const e of consentedEvents) {
    if (e.eventType !== successKey) continue
    if (!convertedVisitorsSet.has(e.visitorId)) continue
    const day = tehranDay(e.occurredAt)
    const seen = successVisitorDay.get(e.visitorId)
    if (!seen || day < seen) successVisitorDay.set(e.visitorId, day)
  }
  for (const day of successVisitorDay.values()) {
    const row = trendMap.get(day)
    if (row) row.conversions++
  }
  const trend = [...trendMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-60).map(([day, v]) => ({ day, ...v }))

  // کیفیت داده
  const lastEvent = inRange.length > 0 ? inRange.reduce((m, e) => Math.max(m, e.occurredAt.getTime()), 0) : null
  const allViewEvents = inRange.filter((e) => e.eventType === 'PAGE_VIEW')
  const consentedViews = allViewEvents.filter((e) => e.isConsented && !e.isInternal && !e.isBot).length
  const coveragePercent = allViewEvents.length > 0 ? (consentedViews / allViewEvents.length) * 100 : null
  const notes: string[] = []
  let hasSufficientData = true
  if (measurable === 0) {
    hasSufficientData = false
    notes.push('در این بازه مخاطبِ قابل‌اندازه‌گیری ثبت نشده است؛ نباید «نتیجهٔ صفر» تفسیر شود.')
  }
  if (coveragePercent !== null && coveragePercent < 70) {
    notes.push('پوشش داده پایین است (عدم رضایت ردیابی یا مسدودکننده‌ها)؛ نتایج ممکن است نمایندهٔ کل مخاطب نباشد.')
  }
  if (lastEvent !== null && now - lastEvent > 6 * 3600 * 1000) {
    notes.push('آخرین رویداد بیش از ۶ ساعت پیش ثبت شده؛ به‌روزرسانی داده با تأخیر همراه است.')
  }

  return {
    range: { days: rangeDays, fromDay: tehranDay(new Date(fromMs)), toDay: tehranDay(new Date(now)), timezone: REPORT_TIMEZONE },
    access: { views: views.length, measurableVisitors: measurable, totalVisitors: new Set(consentedEvents.map((e) => e.visitorId)).size },
    engagement: {
      ctaVisitors: funnel.find((f) => f.key === 'CTA_CLICK')?.visitors ?? 0,
      formStartVisitors: funnel.find((f) => f.key === 'FORM_START')?.visitors ?? 0,
    },
    outcome: { conversions, conversionVisitors, conversionRate: rate, rateCi, previousRate },
    funnel,
    trend,
    quality: {
      hasSufficientData,
      coveragePercent,
      excludedInternalViews: internalViews,
      excludedBotViews: botViews,
      noConsentVisitors,
      lastEventAt: lastEvent ? new Date(lastEvent).toISOString() : null,
      notes,
    },
  }
}

function hasSessionEvent(events: GoalEventRow[], visitorId: string, eventType: string, sessionId: string): boolean {
  return events.some((e) => e.visitorId === visitorId && e.eventType === eventType && e.sessionId === sessionId)
}

// ─── ثبت تبدیل آزمایش (ضد دوباره‌شماری) ───────────────────────────

/**
 * تلاش برای اتصال رویداد تبدیل به آزمایش — فقط نخستین تبدیل معتبر هر بازدیدکننده ثبت می‌شود
 * گروه نسخه از تخصیص سمت سرور تعیین می‌شود، نه از ادعای کلاینت
 *
 * اتمیک بودن: به‌جای «خواندن convertedAt و سپس نوشتن» (check-then-act که دو فراخوانی موازی
 * می‌توانستند هر دو pass شوند)، نوشتن با یک دستور UPDATE شرطی انجام می‌شود:
 *   UPDATE … WHERE id = … AND convertedAt IS NULL
 * در SQLite هر دستور نوشتن سری‌سازی می‌شود؛ دقیقاً یکی از دو تبدیل موازی count=۱ می‌گیرد و
 * مقدار convertedAt فقط و فقط یک بار و برابر occurredAt برنده ثبت می‌شود — بازخوانی شمارش
 * ردیف کافی نیست، خود مقدار ثابت می‌ماند و پاسخ بازنده نیز converted:false می‌گیرد.
 */
export async function attributeExperimentConversion(
  db: PrismaClient,
  input: { experimentId: string; visitorId: string; eventType: string; occurredAt: Date }
): Promise<{ group: string | null; converted: boolean }> {
  const experiment = await db.experiment.findUnique({ where: { id: input.experimentId } })
  if (!experiment) return { group: null, converted: false }
  const assignment = await db.experimentAssignment.findUnique({
    where: { experimentId_visitorId: { experimentId: input.experimentId, visitorId: input.visitorId } },
  })
  if (!assignment) return { group: null, converted: false }
  const group = assignment.assignedGroup

  if (input.eventType === experiment.primaryMetricEvent) {
    const base = assignment.firstExposedAt?.getTime()
    if (base !== undefined) {
      const t = input.occurredAt.getTime()
      if (t >= base && t - base <= experiment.attributionHours * 3600 * 1000) {
        // claim اتمی: فقط نخستین نویسندهٔ موفق «نخستین تبدیل» را ثبت می‌کند
        const claimed = await db.experimentAssignment.updateMany({
          where: { id: assignment.id, convertedAt: null },
          data: { convertedAt: input.occurredAt },
        })
        if (claimed.count === 1) return { group, converted: true }
        return { group, converted: false }
      }
    }
  }
  return { group, converted: false }
}
