/**
 * کتابخانه آزمایش A/B (مرحله ۴)
 * - تخصیص تصادفی پایدار بر پایهٔ هش ثابت (واحد تخصیص: بازدیدکننده)
 * - بررسی فنی پیش از شروع (نسخهٔ ثابت و تأییدشده، یک آزمایش فعال برای هر محل، A/A اعتبارسنجی)
 * - محاسبهٔ نتایج با بازهٔ عدم‌قطعیت، هشدار کیفیت داده و شاخص‌های محافظ
 * - تصمیم‌گیری همیشه انسانی است؛ «نامشخص» نتیجهٔ معتبر است
 */

import { createHash } from 'crypto'
import { diffCI, srmCheck, wilsonCI } from '@/lib/analytics'

// ─── وضعیت‌ها و انواع ─────────────────────────────────────────────

export const EXPERIMENT_STATUSES = ['DRAFT', 'REVIEW', 'RUNNING', 'PAUSED', 'ENDED', 'INVALID'] as const
export const CHANGE_TYPES = ['TITLE', 'CTA_TEXT', 'HERO_IMAGE', 'BLOCK'] as const
export type ChangeType = (typeof CHANGE_TYPES)[number]

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  TITLE: 'عنوان',
  CTA_TEXT: 'متن فراخوان اقدام',
  HERO_IMAGE: 'تصویر اصلی',
  BLOCK: 'یک بلوک مشخص',
}

export const EXPERIMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  REVIEW: 'در بررسی فنی',
  RUNNING: 'در حال اجرا',
  PAUSED: 'متوقف‌شده',
  ENDED: 'پایان‌یافته',
  INVALID: 'نامعتبر',
}

export const DECISION_OPTIONS = ['WIN_VARIANT', 'WIN_CONTROL', 'INCONCLUSIVE', 'INVALID_DATA'] as const
export type ExperimentDecision = (typeof DECISION_OPTIONS)[number]

export const DECISION_LABELS: Record<ExperimentDecision, string> = {
  WIN_VARIANT: 'شواهد کافی به نفع نسخهٔ جایگزین',
  WIN_CONTROL: 'شواهد کافی به نفع نسخهٔ کنترل',
  INCONCLUSIVE: 'شواهد ناکافی برای تصمیم',
  INVALID_DATA: 'نتیجهٔ نامعتبر به‌دلیل مشکل داده یا اجرا',
}

export const GUARDRAIL_KEYS = ['FORM_ERROR_RATE', 'LOW_QUALITY_LEADS'] as const
export type GuardrailKey = (typeof GUARDRAIL_KEYS)[number]

export const GUARDRAIL_LABELS: Record<GuardrailKey, string> = {
  FORM_ERROR_RATE: 'نرخ خطای فرم',
  LOW_QUALITY_LEADS: 'درخواست‌های بی‌کیفیت',
}

/** شاخص محافظ پیش‌فرض: نرخ خطای فرم نباید بیش از ۱ واحد درصد بدتر شود */
export const DEFAULT_GUARDRAILS = JSON.stringify([
  { key: 'FORM_ERROR_RATE', label: GUARDRAIL_LABELS.FORM_ERROR_RATE, maxLiftPp: 1 },
])

// ─── تخصیص پایدار ────────────────────────────────────────────────

/**
 * گروه نسخهٔ یک بازدیدکننده — تابعی قطعی از (شناسهٔ آزمایش، شناسهٔ بازدیدکننده)
 * وابسته به سلیقهٔ کاربر یا زمان ورود نیست؛ همان واحد در مراجعه‌های بعدی نسخهٔ ثابت می‌بیند
 */
export function stableAssignGroup(experimentId: string, visitorId: string, variantSharePercent: number): 'CONTROL' | 'VARIANT' {
  const hash = createHash('sha256').update(`${experimentId}:${visitorId}`).digest('hex')
  const bucket = parseInt(hash.slice(0, 8), 16) % 100
  const share = Math.min(95, Math.max(5, variantSharePercent))
  return bucket < share ? 'VARIANT' : 'CONTROL'
}

// ─── بررسی فنی پیش از شروع ───────────────────────────────────────

export type PreflightCheck = { key: string; label: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }

export type ExperimentForPreflight = {
  id: string
  title: string
  targetContentId: string
  changeType: string
  controlVersionId: string | null
  variantVersionId: string | null
  variantPayloadTitle: string
  primaryMetricEvent: string
  guardrailsJson: string
  plannedSamplePerGroup: number
  plannedDurationDays: number
  isAaTest: boolean
}

export type PreflightContext = {
  article: { id: string; title: string; status: string } | null
  versionsBelongToArticle: boolean
  activeSlotConflict: { id: string; title: string } | null
  aaValidationDone: { id: string; title: string } | null
  guardrailCount: number
}

/** بررسی‌های فنی پیش از شروع تخصیص ترافیک */
export function runPreflight(exp: ExperimentForPreflight, ctx: PreflightContext): PreflightCheck[] {
  const checks: PreflightCheck[] = []

  // ۱) اتصال نسخهٔ کنترل و جایگزین به شناسهٔ نسخهٔ مشخص (یا نقشهٔ ثابتِ نسخهٔ جایگزین)
  if (exp.controlVersionId && (exp.variantVersionId || exp.variantPayloadTitle)) {
    if (ctx.versionsBelongToArticle) {
      checks.push({
        key: 'VERSIONS_BOUND',
        label: 'نسخهٔ کنترل و جایگزین قابل رهگیری و ثابت‌اند',
        status: 'PASS',
        detail: exp.variantVersionId
          ? 'هر دو گروه به شناسهٔ نسخهٔ مشخص متصل‌اند و در حین اجرا ثابت می‌مانند.'
          : 'نسخهٔ کنترل به شناسهٔ نسخه متصل است و محتوای نسخهٔ جایگزین در لحظهٔ شروع به‌صورت ثابت ثبت می‌شود؛ تغییر آن در حین اجرا مجاز نیست.',
      })
    } else {
      checks.push({ key: 'VERSIONS_BOUND', label: 'نسخهٔ کنترل و جایگزین قابل رهگیری و ثابت‌اند', status: 'FAIL', detail: 'نسخهٔ کنترل انتخاب‌شده متعلق به محتوای هدف نیست.' })
    }
  } else {
    checks.push({ key: 'VERSIONS_BOUND', label: 'نسخهٔ کنترل و جایگزین قابل رهگیری و ثابت‌اند', status: 'FAIL', detail: 'نسخهٔ کنترل و محتوای نسخهٔ جایگزین باید پیش از شروع مشخص و ثبت شوند؛ تغییر در حین اجرا آزاد نمی‌شود.' })
  }

  // ۲) تأییدشده‌بودن محتوای هدف (گردش تأیید مرحلهٔ ۲)
  if (!ctx.article) {
    checks.push({ key: 'CONTENT_APPROVED', label: 'محتوای هدف وجود دارد و تأییدشده است', status: 'FAIL', detail: 'محتوای هدف یافت نشد.' })
  } else if (['APPROVED', 'PUBLISHED'].includes(ctx.article.status)) {
    checks.push({ key: 'CONTENT_APPROVED', label: 'محتوای هدف وجود دارد و تأییدشده است', status: 'PASS', detail: 'هر دو نسخه پیش از شروع از گردش تأیید گذشته‌اند.' })
  } else {
    checks.push({ key: 'CONTENT_APPROVED', label: 'محتوای هدف وجود دارد و تأییدشده است', status: 'FAIL', detail: 'محتوای هدف باید ابتدا تأیید شود (گردش تأیید مرحلهٔ ۲).' })
  }

  // ۳) یک آزمایش فعال برای هر محل
  if (ctx.activeSlotConflict) {
    checks.push({
      key: 'SLOT_UNIQUE',
      label: 'برای این محل فقط یک آزمایش فعال وجود دارد',
      status: 'FAIL',
      detail: `آزمایش «${ctx.activeSlotConflict.title}» هم‌اکنون برای همین محل فعال است.`,
    })
  } else {
    checks.push({ key: 'SLOT_UNIQUE', label: 'برای این محل فقط یک آزمایش فعال وجود دارد', status: 'PASS', detail: 'هیچ آزمایش فعال دیگری روی همین محتوا و همین نوع تغییر وجود ندارد.' })
  }

  // ۴) شاخص اصلی و محافظ تعریف شده‌اند
  const guardrailCount = ctx.guardrailCount
  const metricLabel =
    exp.primaryMetricEvent === 'FORM_SUCCESS' ? 'ثبت موفق فرم' : exp.primaryMetricEvent === 'SIGNUP' ? 'ثبت‌نام موفق' : exp.primaryMetricEvent === 'PURCHASE' ? 'خرید موفق' : exp.primaryMetricEvent
  if (exp.primaryMetricEvent && guardrailCount > 0) {
    checks.push({ key: 'METRICS_DEFINED', label: 'شاخص اصلی و شاخص‌های محافظ تعریف شده‌اند', status: 'PASS', detail: `شاخص اصلی: ${metricLabel}؛ تعداد شاخص محافظ: ${guardrailCount}.` })
  } else {
    checks.push({
      key: 'METRICS_DEFINED',
      label: 'شاخص اصلی و شاخص‌های محافظ تعریف شده‌اند',
      status: 'FAIL',
      detail: guardrailCount === 0 ? 'حداقل یک شاخص محافظ (مثل نرخ خطای فرم) لازم است؛ «کلیک بیشتر» به‌تنهایی موفقیت نیست.' : 'شاخص اصلی تعریف نشده است.',
    })
  }

  // ۵) برنامهٔ حجم نمونه و مدت اجرا
  if (exp.plannedSamplePerGroup > 0 && exp.plannedDurationDays > 0) {
    checks.push({ key: 'SAMPLE_PLAN', label: 'برنامهٔ حجم نمونه و مدت اجرا مشخص است', status: 'PASS', detail: `حداقل ${exp.plannedSamplePerGroup} مواجه‌شده در هر گروه طی ${exp.plannedDurationDays} روز؛ پایان طبق برنامه، نه به‌محض مثبت‌شدن نتیجه.` })
  } else {
    checks.push({ key: 'SAMPLE_PLAN', label: 'برنامهٔ حجم نمونه و مدت اجرا مشخص است', status: 'FAIL', detail: 'حجم نمونه و مدت اجرا باید پیش از شروع مشخص شود تا چرخه‌های معمول ترافیک پوشش داده شوند.' })
  }

  // ۶) اعتبارسنجی اندازه‌گیری با A/A — پیش‌نیاز نخستین آزمایش واقعی
  if (exp.isAaTest) {
    checks.push({ key: 'AA_VALIDATION', label: 'اعتبارسنجی اندازه‌گیری (A/A)', status: 'PASS', detail: 'این آزمایش خود A/A است: دو نسخه یکسان‌اند؛ انتظار می‌رود نتیجه «شواهد ناکافی» باشد.' })
  } else if (ctx.aaValidationDone) {
    checks.push({ key: 'AA_VALIDATION', label: 'اعتبارسنجی اندازه‌گیری (A/A)', status: 'PASS', detail: `اعتبارسنجی با آزمایش A/A «${ctx.aaValidationDone.title}» انجام شده است.` })
  } else {
    checks.push({ key: 'AA_VALIDATION', label: 'اعتبارسنجی اندازه‌گیری (A/A)', status: 'FAIL', detail: 'پیش از نخستین آزمایش واقعی، صحت تخصیص و رویدادها باید با اجرای آزمایشی A/A بررسی شود.' })
  }

  // ۷) هشدار ترافیک کم (توصیفی — مسدودکننده نیست)
  checks.push({
    key: 'TRAFFIC_ADEQUACY',
    label: 'کفایت ترافیک برای نتیجهٔ قابل اتکا',
    status: 'WARN',
    detail: 'با ترافیک کم، آزمایش ممکن است در زمان معقول به نتیجهٔ قابل اتکا نرسد؛ در این حالت «شواهد ناکافی» نتیجهٔ معتبر است و نباید برندهٔ ساختگی اعلام کرد.',
  })

  return checks
}

export function preflightHasFail(checks: PreflightCheck[]): boolean {
  return checks.some((c) => c.status === 'FAIL')
}

// ─── نتایج آزمایش ────────────────────────────────────────────────

export type AssignmentRow = {
  visitorId: string
  assignedGroup: string
  firstExposedAt: Date | null
  convertedAt: Date | null
  assignedAt: Date
}

export type ExperimentGuardrail = { key: string; label: string; maxLiftPp: number }

export type ExperimentResults = {
  groups: {
    key: 'CONTROL' | 'VARIANT'
    label: string
    assigned: number
    exposed: number
    conversions: number
    conversionRate: number | null
    rateCi: [number, number] | null
  }[]
  comparison: {
    absoluteLiftPp: number | null
    relativeLiftPct: number | null
    diffCi: [number, number] | null
  }
  srm: ReturnType<typeof srmCheck> & { label: string }
  guardrails: {
    key: string
    label: string
    controlRate: number | null
    variantRate: number | null
    liftPp: number | null
    maxLiftPp: number
    status: 'OK' | 'VIOLATED' | 'NO_DATA'
    detail: string
  }[]
  progress: {
    exposedPerGroup: number
    plannedSamplePerGroup: number
    sampleProgressPct: number
    daysElapsed: number | null
    plannedDurationDays: number
    plannedEndAt: string | null
  }
  readiness: { key: string; label: string; met: boolean }[]
  qualityWarnings: { key: string; label: string; detail: string }[]
  dataCaveats: string[]
}

type GuardrailEventRow = {
  eventType: string
  visitorId: string
  variantGroup: string | null
  occurredAt: Date
}

/**
 * نتایج آزمایش: توصیف شفاف با عدم‌قطعیت — بدون اعلام برنده
 * کیفیت داده مقدم بر نتیجه است؛ هشدارها پیش از هر تفسیر بررسی می‌شوند
 */
export function computeExperimentResults(
  exp: {
    id: string
    trafficSplitPercent: number
    plannedSamplePerGroup: number
    plannedDurationDays: number
    plannedEndAt: Date | null
    startedAt: Date | null
    guardrailsJson: string
    status: string
  },
  assignments: AssignmentRow[],
  events: GuardrailEventRow[]
): ExperimentResults {
  const groups = (['CONTROL', 'VARIANT'] as const).map((key) => {
    const rows = assignments.filter((a) => a.assignedGroup === key)
    const exposedRows = rows.filter((a) => a.firstExposedAt !== null)
    const converted = exposedRows.filter((a) => a.convertedAt !== null)
    const n = exposedRows.length
    const k = converted.length
    return {
      key,
      label: key === 'CONTROL' ? 'نسخهٔ کنترل (A)' : 'نسخهٔ جایگزین (B)',
      assigned: rows.length,
      exposed: n,
      conversions: k,
      conversionRate: n > 0 ? k / n : null,
      rateCi: n > 0 ? wilsonCI(k, n) : null,
    }
  })

  const control = groups[0]
  const variant = groups[1]

  // اختلاف مطلق و نسبی + بازهٔ عدم‌قطعیت اختلاف
  let comparison: ExperimentResults['comparison'] = { absoluteLiftPp: null, relativeLiftPct: null, diffCi: null }
  if (control.exposed > 0 && variant.exposed > 0) {
    const d = diffCI(control.conversions, control.exposed, variant.conversions, variant.exposed)
    const rel = d.diff !== 0 && control.conversionRate ? (d.diff / control.conversionRate) * 100 : d.diff === 0 ? 0 : null
    comparison = {
      absoluteLiftPp: d.diff * 100,
      relativeLiftPct: rel,
      diffCi: d.ci,
    }
  }

  // SRM روی مواجه‌شده‌ها (واحد واقعی اندازه‌گیری)
  const srm = srmCheck(control.exposed, variant.exposed, exp.trafficSplitPercent / 100)
  const srmWithLabel = {
    ...srm,
    label:
      srm.severity === 'FAIL'
        ? 'عدم تطابق غیرعادی نسبت گروه‌ها — ابتدا مشکل تخصیص یا ثبت داده بررسی شود؛ نباید مستقیم برنده اعلام کرد.'
        : srm.severity === 'WARN'
          ? 'نسبت گروه‌ها کمی از برنامه فاصله گرفته است؛ پایش کنید.'
          : 'نسبت مواجه‌شدهٔ گروه‌ها با برنامهٔ تخصیص سازگار است.',
  }

  // شاخص‌های محافظ بر پایهٔ رویدادها (مثلاً نرخ خطای فرم به‌ازای مواجه‌شده)
  let guardrails: ExperimentResults['guardrails'] = []
  try {
    const defs = JSON.parse(exp.guardrailsJson || '[]') as ExperimentGuardrail[]
    guardrails = defs.map((g) => {
      const guardEvent = g.key === 'FORM_ERROR_RATE' ? 'FORM_INVALID' : g.key === 'LOW_QUALITY_LEADS' ? 'FORM_INVALID' : g.key
      const perGroup = (group: 'CONTROL' | 'VARIANT') => {
        const exposedIds = new Set(assignments.filter((a) => a.assignedGroup === group && a.firstExposedAt).map((a) => a.visitorId))
        const hitVisitors = new Set(
          events
            .filter((e) => e.eventType === guardEvent && e.variantGroup === group && exposedIds.has(e.visitorId))
            .map((e) => e.visitorId)
        )
        return exposedIds.size > 0 ? hitVisitors.size / exposedIds.size : null
      }
      const c = perGroup('CONTROL')
      const v = perGroup('VARIANT')
      const lift = c !== null && v !== null ? (v - c) * 100 : null
      const status: 'OK' | 'VIOLATED' | 'NO_DATA' = lift === null ? 'NO_DATA' : lift > g.maxLiftPp ? 'VIOLATED' : 'OK'
      return {
        key: g.key,
        label: g.label,
        controlRate: c,
        variantRate: v,
        liftPp: lift,
        maxLiftPp: g.maxLiftPp,
        status,
        detail:
          status === 'VIOLATED'
            ? `شاخص محافظ از حد مجاز (${new Intl.NumberFormat('fa-IR').format(g.maxLiftPp)} واحد درصد) بدتر شده است؛ «بیشترشدن کلیک» به‌تنهایی موفقیت نیست.`
            : status === 'OK'
              ? `شاخص محافظ در حد مجاز است (حداکثر بدترشدن مجاز: ${new Intl.NumberFormat('fa-IR').format(g.maxLiftPp)} واحد درصد).`
              : 'دادهٔ کافی برای سنجش این شاخص محافظ هنوز ثبت نشده است.',
      }
    })
  } catch {
    guardrails = []
  }

  // پیشرفت نسبت به برنامه
  const exposedPerGroup = Math.min(control.exposed, variant.exposed)
  const sampleProgressPct = exp.plannedSamplePerGroup > 0 ? Math.min(100, (exposedPerGroup / exp.plannedSamplePerGroup) * 100) : 0
  let daysElapsed: number | null = null
  if (exp.startedAt) {
    const endRef = exp.plannedEndAt?.getTime() ?? Date.now()
    daysElapsed = Math.max(0, Math.min(exp.plannedDurationDays, Math.ceil((Math.min(endRef, Date.now()) - exp.startedAt.getTime()) / (24 * 3600 * 1000))))
  }

  // چک‌لیست آمادگی برای تصمیم — اطلاعاتی، نه اعلام برنده
  const ciExcludesZero = comparison.diffCi ? comparison.diffCi[0] > 0 || comparison.diffCi[1] < 0 : false
  const readiness = [
    { key: 'SAMPLE_REACHED', label: 'حجم نمونهٔ برنامه‌ریزی‌شده در هر گروه', met: exposedPerGroup >= exp.plannedSamplePerGroup },
    { key: 'DURATION_REACHED', label: 'مدت برنامه‌ریزی‌شدهٔ اجرا', met: daysElapsed !== null && daysElapsed >= exp.plannedDurationDays },
    { key: 'SRM_OK', label: 'نسبت تخصیص گروه‌ها با برنامه سازگار', met: srm.severity === 'OK' },
    { key: 'GUARDRAILS_OK', label: 'شاخص‌های محافظ در حد مجاز', met: guardrails.length > 0 && guardrails.every((g) => g.status !== 'VIOLATED') },
    { key: 'CI_EXCLUDES_ZERO', label: 'بازهٔ عدم‌قطعیت اختلاف صفر را کنار گذاشته', met: ciExcludesZero },
  ]

  // هشدارهای کیفیت داده
  const qualityWarnings: ExperimentResults['qualityWarnings'] = []
  if (srm.severity === 'FAIL') {
    qualityWarnings.push({ key: 'SRM_FAIL', label: 'عدم تطابق نسبت نمونه (SRM)', detail: srmWithLabel.label })
  } else if (srm.severity === 'WARN') {
    qualityWarnings.push({ key: 'SRM_WARN', label: 'انحراف نسبت گروه‌ها', detail: srmWithLabel.label })
  }
  const totalAssigned = control.assigned + variant.assigned
  const totalExposed = control.exposed + variant.exposed
  if (totalAssigned > 200 && totalExposed / Math.max(1, totalAssigned) < 0.8) {
    qualityWarnings.push({ key: 'EXPOSURE_GAP', label: 'افت پوشش مواجهه', detail: 'بخش قابل‌توجهی از تخصیص‌یافته‌ها مواجههٔ واقعی ثبت نکرده‌اند؛ تعریف فنی مواجهه بررسی شود.' })
  }
  if (exp.status === 'RUNNING' && events.length > 0) {
    const lastEvent = events.reduce((m, e) => Math.max(m, e.occurredAt.getTime()), 0)
    if (Date.now() - lastEvent > 12 * 3600 * 1000) {
      qualityWarnings.push({ key: 'EVENT_DELAY', label: 'اختلال احتمالی ثبت رویداد', detail: 'بیش از ۱۲ ساعت رویداد تازه‌ای ثبت نشده است؛ جمع‌آوری رویداد بررسی شود.' })
    }
  }

  const dataCaveats = [
    'در روش نمونهٔ ثابت، نگاه مکرر و توقف به‌محض مثبت‌شدن نتیجه می‌تواند نتیجه‌گیری را منحرف کند.',
    'نبود شواهد تفاوت، لزوماً به معنی یکسان‌بودن دو نسخه نیست.',
    'تحلیل بر واحد تخصیص (بازدیدکننده) است؛ هر مشاهدهٔ صفحه یک نمونهٔ مستقل نیست.',
    'محدودیت شناسایی میان دستگاه‌ها یا پس از پاک‌شدن کوکی می‌تواند پوشش را کاهش دهد.',
  ]

  return {
    groups,
    comparison,
    srm: srmWithLabel,
    guardrails,
    progress: {
      exposedPerGroup,
      plannedSamplePerGroup: exp.plannedSamplePerGroup,
      sampleProgressPct,
      daysElapsed,
      plannedDurationDays: exp.plannedDurationDays,
      plannedEndAt: exp.plannedEndAt?.toISOString() ?? null,
    },
    readiness,
    qualityWarnings,
    dataCaveats,
  }
}
