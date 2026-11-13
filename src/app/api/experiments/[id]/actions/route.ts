/**
 * API اقدام‌های چرخهٔ آزمایش
 * POST /api/experiments/[id]/actions
 *   PREFLIGHT — بررسی فنی پیش از شروع (نسخهٔ ثابت، تأیید محتوا، یک آزمایش برای هر محل، A/A، شاخص‌ها)
 *   START — شروع تخصیص ترافیک پس از گذراندن بررسی فنی
 *   PAUSE / RESUME — توقف و ادامهٔ برنامه‌ریزی‌شده
 *   EMERGENCY_STOP — توقف اضطراری؛ نمایش امن نسخهٔ کنترل
 *   END — پایان طبق برنامه (انتشار خودکار انجام نمی‌شود)
 *   DECISION — ثبت تصمیم انسانی همراه با دلیل و محدودیت‌های تحلیل
 *   INVALIDATE — اعلام نامعتبری نتیجه به‌دلیل مشکل داده یا اجرا
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { runPreflight, preflightHasFail, computeExperimentResults, DECISION_OPTIONS, type PreflightCheck } from '@/lib/experiments'

type ActionBody = {
  action?: string
  decision?: string
  reason?: string
  invalidReason?: string
  endReason?: string
}

async function getExperimentOr404(id: string) {
  const experiment = await db.experiment.findUnique({ where: { id } })
  if (!experiment) throw new ApiError(404, 'آزمایش یافت نشد.')
  return experiment
}

/** محاسبهٔ بررسی فنی زنده با زمینهٔ فعلی */
async function buildPreflightContext(experiment: Awaited<ReturnType<typeof getExperimentOr404>>) {
  const article = await db.article.findUnique({ where: { id: experiment.targetContentId }, select: { id: true, title: true, status: true } })

  let versionsBelongToArticle = false
  if (experiment.controlVersionId) {
    const cv = await db.articleVersion.findUnique({ where: { id: experiment.controlVersionId } })
    versionsBelongToArticle = !!cv && cv.articleId === experiment.targetContentId
  }

  const activeSlotConflict = await db.experiment.findFirst({
    where: { targetContentId: experiment.targetContentId, changeType: experiment.changeType, status: { in: ['REVIEW', 'RUNNING', 'PAUSED'] }, id: { not: experiment.id } },
    select: { id: true, title: true },
  })

  const aaValidationDone = await db.experiment.findFirst({
    where: { targetContentId: experiment.targetContentId, isAaTest: true, status: 'ENDED', decision: { not: null } },
    select: { id: true, title: true },
  })

  let guardrailCount = 0
  try {
    guardrailCount = (JSON.parse(experiment.guardrailsJson || '[]') as unknown[]).length
  } catch {
    guardrailCount = 0
  }

  return {
    article,
    versionsBelongToArticle,
    activeSlotConflict,
    aaValidationDone,
    guardrailCount,
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('analytics.manage')
    const { id } = await params
    const experiment = await getExperimentOr404(id)
    const body = await parseBody<ActionBody>(req)
    const action = vEnum(body.action, ['PREFLIGHT', 'START', 'PAUSE', 'RESUME', 'EMERGENCY_STOP', 'END', 'DECISION', 'INVALIDATE'] as const, 'اقدام')

    // ─── بررسی فنی ───
    if (action === 'PREFLIGHT') {
      if (!['DRAFT', 'REVIEW'].includes(experiment.status)) {
        throw new ApiError(400, 'بررسی فنی فقط پیش از شروع اجرا معنا دارد.')
      }
      const payloadTitle = (() => {
        try {
          return (JSON.parse(experiment.variantPayload || '{}') as Record<string, string>).title ?? ''
        } catch {
          return ''
        }
      })()
      const ctx = await buildPreflightContext(experiment)
      const checks = runPreflight(
        {
          id: experiment.id,
          title: experiment.title,
          targetContentId: experiment.targetContentId,
          changeType: experiment.changeType,
          controlVersionId: experiment.controlVersionId,
          variantVersionId: experiment.variantVersionId,
          variantPayloadTitle: payloadTitle,
          primaryMetricEvent: experiment.primaryMetricEvent,
          guardrailsJson: experiment.guardrailsJson,
          plannedSamplePerGroup: experiment.plannedSamplePerGroup,
          plannedDurationDays: experiment.plannedDurationDays,
          isAaTest: experiment.isAaTest,
        },
        ctx
      )
      const hasFail = preflightHasFail(checks)
      const updated = await db.experiment.update({
        where: { id: experiment.id },
        data: {
          lastPreflightJson: JSON.stringify(checks),
          status: hasFail ? 'DRAFT' : 'REVIEW',
        },
      })
      await db.experimentHistory.create({
        data: {
          experimentId: experiment.id,
          kind: 'REVIEW',
          message: hasFail
            ? 'بررسی فنی با مشکل مواجه شد؛ رفع موارد قرمز لازم است.'
            : 'بررسی فنی با موفقیت گذرانده شد؛ آزمایش آمادهٔ شروع است.',
          userName: user.name,
        },
      })
      return ok({ checks, experiment: updated, canStart: !hasFail })
    }

    // ─── شروع ───
    if (action === 'START') {
      if (experiment.status !== 'REVIEW') throw new ApiError(400, 'شروع آزمایش فقط پس از گذراندن بررسی فنی مجاز است.')
      // بازبینی زندهٔ بررسی فنی در لحظهٔ شروع (نسخه‌ها نباید از زمان بررسی تغییر کرده باشند)
      const payloadTitle = (() => {
        try {
          return (JSON.parse(experiment.variantPayload || '{}') as Record<string, string>).title ?? ''
        } catch {
          return ''
        }
      })()
      const ctx = await buildPreflightContext(experiment)
      const checks = runPreflight(
        {
          id: experiment.id,
          title: experiment.title,
          targetContentId: experiment.targetContentId,
          changeType: experiment.changeType,
          controlVersionId: experiment.controlVersionId,
          variantVersionId: experiment.variantVersionId,
          variantPayloadTitle: payloadTitle,
          primaryMetricEvent: experiment.primaryMetricEvent,
          guardrailsJson: experiment.guardrailsJson,
          plannedSamplePerGroup: experiment.plannedSamplePerGroup,
          plannedDurationDays: experiment.plannedDurationDays,
          isAaTest: experiment.isAaTest,
        },
        ctx
      )
      if (preflightHasFail(checks)) {
        await db.experiment.update({ where: { id: experiment.id }, data: { lastPreflightJson: JSON.stringify(checks), status: 'DRAFT' } })
        throw new ApiError(400, 'بررسی فنی در لحظهٔ شروع با مشکل مواجه شد؛ شروع انجام نشد.')
      }
      const now = new Date()
      const plannedEndAt = new Date(now.getTime() + experiment.plannedDurationDays * 24 * 3600 * 1000)
      const updated = await db.experiment.update({
        where: { id: experiment.id },
        data: { status: 'RUNNING', startedAt: now, plannedEndAt, lastPreflightJson: JSON.stringify(checks), pausedAt: null, emergencyStoppedAt: null },
      })
      await db.experimentHistory.create({
        data: {
          experimentId: experiment.id,
          kind: 'START',
          message: experiment.isAaTest
            ? 'آزمایش A/A شروع شد؛ صحت تخصیص و رویدادها پیش از آزمایش واقعی سنجیده می‌شود.'
            : 'تخصیص ترافیک شروع شد؛ پایان طبق برنامه انجام می‌شود و برنده به‌صورت خودکار اعلام یا منتشر نمی‌شود.',
          userName: user.name,
        },
      })
      return ok({ experiment: updated })
    }

    // ─── توقف برنامه‌ریزی‌شده ───
    if (action === 'PAUSE') {
      if (experiment.status !== 'RUNNING') throw new ApiError(400, 'توقف فقط در حین اجرا مجاز است.')
      const updated = await db.experiment.update({ where: { id: experiment.id }, data: { status: 'PAUSED', pausedAt: new Date() } })
      await db.experimentHistory.create({ data: { experimentId: experiment.id, kind: 'PAUSE', message: 'آزمایش به‌صورت موقت متوقف شد؛ تخصیص جدید انجام نمی‌شود و نسخهٔ کنترل نمایش داده می‌شود.', userName: user.name } })
      return ok({ experiment: updated })
    }

    // ─── ادامهٔ پس از توقف برنامه‌ریزی‌شده ───
    if (action === 'RESUME') {
      if (experiment.status !== 'PAUSED') throw new ApiError(400, 'ادامه فقط برای آزمایش متوقف‌شده مجاز است.')
      if (experiment.emergencyStoppedAt) {
        throw new ApiError(400, 'پس از توقف اضطراری، ادامهٔ خودکار مجاز نیست؛ ابتدا علت اختلال بررسی و نتیجه به‌صورت نامعتبر یا پایان‌یافته ثبت شود.')
      }
      const updated = await db.experiment.update({ where: { id: experiment.id }, data: { status: 'RUNNING', pausedAt: null } })
      await db.experimentHistory.create({ data: { experimentId: experiment.id, kind: 'RESUME', message: 'آزمایش ادامه یافت؛ تخصیص و ثبت مواجهه از سر گرفته شد.', userName: user.name } })
      return ok({ experiment: updated })
    }

    // ─── توقف اضطراری ───
    if (action === 'EMERGENCY_STOP') {
      if (!['RUNNING', 'PAUSED'].includes(experiment.status)) throw new ApiError(400, 'توقف اضطراری فقط در حین اجرا معنا دارد.')
      const reason = vString(body.reason, 'علت توقف اضطراری', { min: 4, max: 300 })
      const updated = await db.experiment.update({
        where: { id: experiment.id },
        data: { status: 'PAUSED', pausedAt: new Date(), emergencyStoppedAt: new Date() },
      })
      await db.experimentHistory.create({ data: { experimentId: experiment.id, kind: 'EMERGENCY_STOP', message: `توقف اضطراری: ${reason} — همهٔ بازدیدکنندگان نسخهٔ کنترل را به‌صورت امن می‌بینند.`, userName: user.name } })
      return ok({ experiment: updated })
    }

    // ─── پایان طبق برنامه ───
    if (action === 'END') {
      if (!['RUNNING', 'PAUSED'].includes(experiment.status)) throw new ApiError(400, 'پایان فقط برای آزمایش در حال اجرا یا متوقف‌شده مجاز است.')
      const endReason = vString(body.endReason, 'علت پایان', { max: 300 })
      const updated = await db.experiment.update({
        where: { id: experiment.id },
        data: { status: 'ENDED', endedAt: new Date(), endReason: endReason || 'پایان طبق برنامه' },
      })
      await db.experimentHistory.create({
        data: {
          experimentId: experiment.id,
          kind: 'END',
          message: 'آزمایش پایان یافت. انتشار نسخهٔ منتخب به‌صورت خودکار انجام نمی‌شود؛ تصمیم با مسئول آزمایش ثبت می‌شود و انتشار از مسیر عادی مجوز انجام می‌گیرد.',
          userName: user.name,
        },
      })
      return ok({ experiment: updated })
    }

    // ─── ثبت تصمیم انسانی ───
    if (action === 'DECISION') {
      if (experiment.status !== 'ENDED') throw new ApiError(400, 'ثبت تصمیم فقط پس از پایان آزمایش مجاز است.')
      if (experiment.decision) throw new ApiError(400, 'برای این آزمایش قبلاً تصمیم ثبت شده است.')
      const decision = vEnum(body.decision, DECISION_OPTIONS, 'نتیجهٔ آزمایش')
      const reason = vString(body.reason, 'دلیل تصمیم', { min: 10, max: 800 })

      // محدودیت‌های تحلیل در لحظهٔ تصمیم ثبت می‌شود تا شفاف بماند
      const assignments = await db.experimentAssignment.findMany({
        where: { experimentId: experiment.id },
        select: { visitorId: true, assignedGroup: true, firstExposedAt: true, convertedAt: true, assignedAt: true },
      })
      const guardrailEventTypes = ['FORM_INVALID', experiment.primaryMetricEvent]
      const events = await db.analyticsEvent.findMany({
        where: { experimentId: experiment.id, eventType: { in: guardrailEventTypes } },
        select: { eventType: true, visitorId: true, variantGroup: true, occurredAt: true },
        take: 20000,
      })
      const results = computeExperimentResults(experiment, assignments, events)
      const limitations: string[] = []
      if (results.srm.severity !== 'OK') limitations.push('عدم تطابق نسبت گروه‌ها (SRM) مشاهده شده است.')
      const unmet = results.readiness.filter((r) => !r.met).map((r) => r.label)
      if (unmet.length > 0) limitations.push(`شرایط برقرارنشده: ${unmet.join('، ')}.`)
      if (results.qualityWarnings.length > 0) limitations.push(`هشدار کیفیت داده: ${results.qualityWarnings.map((w) => w.label).join('، ')}.`)
      limitations.push('محدودیت شناسایی میان دستگاه‌ها و پوشش رضایت ردیابی بر دقت اثر دارد.')

      const updated = await db.experiment.update({
        where: { id: experiment.id },
        data: {
          decision,
          decisionReason: reason,
          decisionLimitations: limitations.join(' '),
          decidedByName: user.name,
          decidedAt: new Date(),
        },
      })
      await db.experimentHistory.create({
        data: {
          experimentId: experiment.id,
          kind: 'DECISION',
          message: `تصمیم ثبت شد: ${decision} — انتشار نسخهٔ منتخب (در صورت انتخاب) از مسیر عادی مجوز و ثبت سابقه انجام می‌شود.`,
          userName: user.name,
        },
      })
      return ok({ experiment: updated, limitations })
    }

    // ─── اعلام نامعتبری ───
    const invalidReason = vString(body.invalidReason, 'علت نامعتبری', { min: 10, max: 400 })
    if (['ENDED'].includes(experiment.status) && experiment.decision) {
      throw new ApiError(400, 'آزمایش با تصمیم ثبت‌شده را نمی‌توان نامعتبر اعلام کرد.')
    }
    const updated = await db.experiment.update({
      where: { id: experiment.id },
      data: { status: 'INVALID', invalidReason },
    })
    await db.experimentHistory.create({
      data: { experimentId: experiment.id, kind: 'INVALID', message: `نتیجهٔ آزمایش نامعتبر اعلام شد: ${invalidReason}`, userName: user.name },
    })
    return ok({ experiment: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
