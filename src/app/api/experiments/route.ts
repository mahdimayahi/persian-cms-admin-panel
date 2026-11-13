/**
 * API آزمایش‌های A/B
 * GET /api/experiments — فهرست آزمایش‌ها با پیشرفت نمونه (analytics.view)
 * POST /api/experiments — تعریف آزمایش با فرضیهٔ مشخص، نسخهٔ ثابت و برنامهٔ نمونه (analytics.manage)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, requirePermission, parseBody, vString, vInt, vEnum } from '@/lib/api-utils'
import { CHANGE_TYPES, DEFAULT_GUARDRAILS, GUARDRAIL_KEYS, GUARDRAIL_LABELS } from '@/lib/experiments'
import { SUCCESS_EVENTS } from '@/lib/analytics'

export async function GET() {
  try {
    await requirePermission('analytics.view')
    const experiments = await db.experiment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        article: { select: { id: true, title: true, slug: true, status: true } },
        _count: { select: { assignments: true } },
      },
    })
    const exposedCounts = await db.experimentAssignment.groupBy({
      by: ['experimentId'],
      where: { firstExposedAt: { not: null } },
      _count: { _all: true },
    })
    const exposedMap = new Map(exposedCounts.map((r) => [r.experimentId, r._count._all]))
    return ok({
      items: experiments.map((e) => ({ ...e, exposedCount: exposedMap.get(e.id) ?? 0 })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}

type GuardrailInput = { key?: string; label?: string; maxLiftPp?: number }

type CreateBody = {
  title?: string
  hypothesis?: string
  targetContentId?: string
  changeType?: string
  slotLabel?: string
  controlVersionId?: string
  variantVersionId?: string
  variantTitle?: string
  variantCtaText?: string
  trafficSplitPercent?: number
  eligiblePopulation?: string
  primaryMetricEvent?: string
  attributionHours?: number
  guardrails?: GuardrailInput[]
  plannedSamplePerGroup?: number
  plannedDurationDays?: number
  minDetectableEffectPp?: number
  stoppingRule?: string
  isAaTest?: boolean
}

function normalizeGuardrails(input: GuardrailInput[] | undefined): string {
  if (!input || input.length === 0) return DEFAULT_GUARDRAILS
  const cleaned = input
    .filter((g) => g.key && GUARDRAIL_KEYS.includes(g.key as never))
    .map((g) => ({
      key: g.key as string,
      label: GUARDRAIL_LABELS[g.key as keyof typeof GUARDRAIL_LABELS] ?? (g.label ?? g.key),
      maxLiftPp: typeof g.maxLiftPp === 'number' && g.maxLiftPp > 0 && g.maxLiftPp <= 20 ? g.maxLiftPp : 1,
    }))
  return JSON.stringify(cleaned.length > 0 ? cleaned : JSON.parse(DEFAULT_GUARDRAILS))
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('analytics.manage')
    const body = await parseBody<CreateBody>(req)

    const title = vString(body.title, 'عنوان آزمایش', { min: 4, max: 140 })
    const hypothesis = vString(body.hypothesis, 'فرضیه', { min: 15, max: 500 })
    const targetContentId = vString(body.targetContentId, 'محتوای هدف', { required: true, max: 40 })

    const article = await db.article.findUnique({ where: { id: targetContentId } })
    if (!article) throw new ApiError(400, 'محتوای هدف یافت نشد.')

    const changeType = vEnum(body.changeType, CHANGE_TYPES, 'نوع تغییر', 'TITLE')
    const slotLabel = vString(body.slotLabel, 'محل تغییر', { max: 140 })
    const isAaTest = body.isAaTest === true

    // نسخهٔ کنترل — باید متعلق به محتوای هدف باشد
    const controlVersionId = vString(body.controlVersionId, 'نسخهٔ کنترل', { required: true, max: 40 })
    const controlVersion = await db.articleVersion.findUnique({ where: { id: controlVersionId } })
    if (!controlVersion || controlVersion.articleId !== targetContentId) {
      throw new ApiError(400, 'نسخهٔ کنترل انتخاب‌شده متعلق به محتوای هدف نیست.')
    }

    // نسخهٔ جایگزین — یا اتصال به نسخهٔ موجود یا محتوای ثابت ثبت‌شده
    let variantVersionId: string | null = null
    if (body.variantVersionId) {
      const vv = await db.articleVersion.findUnique({ where: { id: String(body.variantVersionId) } })
      if (!vv || vv.articleId !== targetContentId) throw new ApiError(400, 'نسخهٔ جایگزین انتخاب‌شده متعلق به محتوای هدف نیست.')
      variantVersionId = vv.id
    }

    // در A/A هر دو نسخه یکسان‌اند — هدف فقط اعتبارسنجی اندازه‌گیری است
    const variantPayload: Record<string, string> = isAaTest
      ? { title: controlVersion.title, ctaText: '' }
      : {
          title: vString(body.variantTitle, 'عنوان نسخهٔ جایگزین', { max: 200 }),
          ctaText: vString(body.variantCtaText, 'متن فراخوان جایگزین', { max: 200 }),
        }
    if (!isAaTest && !variantVersionId && !variantPayload.title && !variantPayload.ctaText) {
      throw new ApiError(400, 'محتوای نسخهٔ جایگزین باید مشخص شود (عنوان یا متن فراخوان).')
    }
    if (variantVersionId) {
      const vv = await db.articleVersion.findUnique({ where: { id: variantVersionId } })
      if (vv) {
        if (!variantPayload.title) variantPayload.title = vv.title
      }
    }

    const trafficSplitPercent = vInt(body.trafficSplitPercent, 'نسبت تقسیم ترافیک', { min: 5, max: 95 }) ?? 50
    const eligiblePopulation = vEnum(body.eligiblePopulation, ['ALL', 'CONSENTED'] as const, 'جمعیت واجد شرایط', 'CONSENTED')
    const primaryMetricEvent = vEnum(body.primaryMetricEvent, SUCCESS_EVENTS, 'شاخص اصلی', 'FORM_SUCCESS')
    const attributionHours = vInt(body.attributionHours, 'پنجرهٔ انتساب', { min: 1, max: 168 }) ?? 24
    const plannedSamplePerGroup = vInt(body.plannedSamplePerGroup, 'حجم نمونهٔ هر گروه', { min: 50, max: 1_000_000 }) ?? 2000
    const plannedDurationDays = vInt(body.plannedDurationDays, 'مدت اجرا (روز)', { min: 1, max: 90 }) ?? 14
    const minDetectableEffectPp = typeof body.minDetectableEffectPp === 'number' && body.minDetectableEffectPp > 0 ? body.minDetectableEffectPp : null
    const stoppingRule = vString(body.stoppingRule, 'قواعد توقف و تصمیم‌گیری', { max: 500 })

    // در نسخهٔ اول برای هر محل محتوا فقط یک آزمایش فعال
    const activeConflict = await db.experiment.findFirst({
      where: { targetContentId, status: { in: ['REVIEW', 'RUNNING', 'PAUSED'] } },
      select: { title: true },
    })
    if (activeConflict) {
      throw new ApiError(400, `برای این محتوا آزمایش فعال دیگری وجود دارد («${activeConflict.title}»). در نسخهٔ اول برای یک محل فقط یک آزمایش فعال مجاز است.`)
    }

    const experiment = await db.experiment.create({
      data: {
        title,
        hypothesis,
        ownerUserId: user.id,
        ownerName: user.name,
        targetContentId,
        changeType,
        slotLabel: slotLabel || `تغییر ${changeType === 'TITLE' ? 'عنوان' : 'محتوا'} «${article.title}»`,
        controlVersionId,
        variantVersionId,
        variantPayload: JSON.stringify(variantPayload),
        trafficSplitPercent,
        eligiblePopulation,
        primaryMetricEvent,
        attributionHours,
        guardrailsJson: normalizeGuardrails(body.guardrails),
        plannedSamplePerGroup,
        plannedDurationDays,
        minDetectableEffectPp,
        stoppingRule: stoppingRule || 'پایان طبق برنامه؛ تصمیم با مسئول آزمایش و پس از بررسی عدم‌قطعیت و شاخص‌های محافظ.',
        isAaTest,
        createdById: user.id,
        createdByName: user.name,
        history: {
          create: {
            kind: 'CREATED',
            message: isAaTest
              ? 'آزمایش A/A برای اعتبارسنجی اندازه‌گیری تعریف شد (هر دو نسخه یکسان‌اند).'
              : 'آزمایش تعریف شد؛ پیش از شروع باید بررسی فنی با موفقیت گذرانده شود.',
            userName: user.name,
          },
        },
      },
      include: { article: { select: { id: true, title: true, slug: true, status: true } } },
    })

    return ok({ experiment }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
