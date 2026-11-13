/**
 * API تخصیص پایدار آزمایش
 * POST /api/experiments/[id]/assign — { visitorId, consent? }
 * - گروه بر پایهٔ هش ثابت (شناسهٔ آزمایش + شناسهٔ بازدیدکننده) تعیین می‌شود؛ سلیقهٔ کاربر و زمان ورود بی‌اثرند
 * - همان بازدیدکننده در مراجعه‌های بعدی نسخهٔ ثابت می‌بیند
 * - جمعیت واجد شرایط: بازدیدکنندهٔ بدون رضایت ردیابی وارد آزمایش نمی‌شود
 * - اگر آزمایش در حال اجرا نباشد، نسخهٔ کنترل به‌صورت امن نمایش داده می‌شود (fallback)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, checkRateLimit } from '@/lib/api-utils'
import { stableAssignGroup } from '@/lib/experiments'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (!checkRateLimit(`assign:${ip}`, 1200, 60_000)) {
      throw new ApiError(429, 'حجم درخواست تخصیص بیش از حد مجاز است.')
    }

    let body: { visitorId?: unknown; consent?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      throw new ApiError(400, 'بدنهٔ درخواست نامعتبر است.')
    }

    const visitorId = typeof body.visitorId === 'string' ? body.visitorId.trim() : ''
    if (!/^[A-Za-z0-9_\-.:]{6,80}$/.test(visitorId)) {
      throw new ApiError(400, 'شناسهٔ بازدیدکننده نامعتبر است.')
    }
    const consent = body.consent === undefined ? true : body.consent === true || body.consent === 'true'

    const experiment = await db.experiment.findUnique({ where: { id } })
    if (!experiment) throw new ApiError(404, 'آزمایش یافت نشد.')

    // پایان یا توقف → نمایش امن نسخهٔ کنترل (وضعیت غیرعادی در پاسخ شفاف است)
    if (experiment.status !== 'RUNNING') {
      const reason =
        experiment.status === 'PAUSED'
          ? 'آزمایش متوقف شده است؛ نسخهٔ کنترل به‌صورت امن نمایش داده می‌شود.'
          : 'آزمایش در حال اجرا نیست؛ نسخهٔ کنترل به‌صورت امن نمایش داده می‌شود.'
      return ok({ group: 'CONTROL', fallback: true, reason, variant: null })
    }

    // جمعیت واجد شرایط: بدون رضایت ردیابی خارج از آزمایش
    if (experiment.eligiblePopulation === 'CONSENTED' && !consent) {
      return ok({ group: null, excluded: 'NO_CONSENT', fallback: false, variant: null })
    }

    const group = stableAssignGroup(experiment.id, visitorId, experiment.trafficSplitPercent)
    const assignment = await db.experimentAssignment.upsert({
      where: { experimentId_visitorId: { experimentId: experiment.id, visitorId } },
      create: { experimentId: experiment.id, visitorId, assignedGroup: group },
      update: {},
    })

    // محتوای نسخه از نقشهٔ ثابت ثبت‌شدهٔ آزمایش می‌آید
    let variant: Record<string, string> | null = null
    if (assignment.assignedGroup === 'VARIANT') {
      try {
        variant = JSON.parse(experiment.variantPayload || '{}') as Record<string, string>
      } catch {
        variant = null
      }
    }

    return ok({ group: assignment.assignedGroup, fallback: false, variant, assignmentId: assignment.id })
  } catch (err) {
    return handleApiError(err)
  }
}
