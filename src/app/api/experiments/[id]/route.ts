/**
 * API آزمایش مشخص
 * GET /api/experiments/[id] — جزئیات کامل با سابقه و شمارش تخصیص (analytics.view)
 * PATCH /api/experiments/[id] — ویرایش فقط در پیش‌نویس؛ در حین اجرا نسخه‌ها آزاد نمی‌شوند (analytics.manage)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, requirePermission, parseBody, vString, vInt, vEnum } from '@/lib/api-utils'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('analytics.view')
    const { id } = await params
    const experiment = await db.experiment.findUnique({
      where: { id },
      include: {
        article: { select: { id: true, title: true, slug: true, status: true } },
        history: { orderBy: { createdAt: 'desc' }, take: 50 },
        _count: { select: { assignments: true } },
      },
    })
    if (!experiment) throw new ApiError(404, 'آزمایش یافت نشد.')
    const exposed = await db.experimentAssignment.count({ where: { experimentId: id, firstExposedAt: { not: null } } })
    const controlVersion = experiment.controlVersionId ? await db.articleVersion.findUnique({ where: { id: experiment.controlVersionId } }) : null
    const variantVersion = experiment.variantVersionId ? await db.articleVersion.findUnique({ where: { id: experiment.variantVersionId } }) : null
    return ok({
      experiment,
      exposedCount: exposed,
      controlVersion: controlVersion ? { id: controlVersion.id, title: controlVersion.title, note: controlVersion.note, createdAt: controlVersion.createdAt } : null,
      variantVersion: variantVersion ? { id: variantVersion.id, title: variantVersion.title, note: variantVersion.note, createdAt: variantVersion.createdAt } : null,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('analytics.manage')
    const { id } = await params
    const experiment = await db.experiment.findUnique({ where: { id } })
    if (!experiment) throw new ApiError(404, 'آزمایش یافت نشد.')
    if (experiment.status !== 'DRAFT') {
      throw new ApiError(400, 'ویرایش آزمایش فقط در وضعیت پیش‌نویس مجاز است؛ نسخه‌های آزمایش در حین اجرا ثابت می‌مانند.')
    }
    const body = await parseBody<Record<string, unknown>>(req)

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) data.title = vString(body.title, 'عنوان آزمایش', { min: 4, max: 140 })
    if (body.hypothesis !== undefined) data.hypothesis = vString(body.hypothesis, 'فرضیه', { min: 15, max: 500 })
    if (body.slotLabel !== undefined) data.slotLabel = vString(body.slotLabel, 'محل تغییر', { max: 140 })
    if (body.trafficSplitPercent !== undefined) data.trafficSplitPercent = vInt(body.trafficSplitPercent, 'نسبت تقسیم ترافیک', { min: 5, max: 95 })
    if (body.plannedSamplePerGroup !== undefined) data.plannedSamplePerGroup = vInt(body.plannedSamplePerGroup, 'حجم نمونهٔ هر گروه', { min: 50, max: 1_000_000 })
    if (body.plannedDurationDays !== undefined) data.plannedDurationDays = vInt(body.plannedDurationDays, 'مدت اجرا (روز)', { min: 1, max: 90 })
    if (body.stoppingRule !== undefined) data.stoppingRule = vString(body.stoppingRule, 'قواعد توقف', { max: 500 })
    if (body.minDetectableEffectPp !== undefined) data.minDetectableEffectPp = typeof body.minDetectableEffectPp === 'number' && body.minDetectableEffectPp > 0 ? body.minDetectableEffectPp : null
    if (body.variantTitle !== undefined) {
      const payload = JSON.parse(experiment.variantPayload || '{}') as Record<string, string>
      payload.title = vString(body.variantTitle, 'عنوان نسخهٔ جایگزین', { max: 200 })
      data.variantPayload = JSON.stringify(payload)
    }

    const updated = await db.experiment.update({ where: { id }, data })
    await db.experimentHistory.create({
      data: { experimentId: id, kind: 'UPDATED', message: 'طرح آزمایش در پیش‌نویس ویرایش شد.', userName: user.name },
    })
    return ok({ experiment: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
