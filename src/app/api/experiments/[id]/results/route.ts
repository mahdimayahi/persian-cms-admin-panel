/**
 * API نتایج آزمایش
 * GET /api/experiments/[id]/results — جدول گروه‌ها، نرخ تبدیل، عدم‌قطعیت، SRM، شاخص‌های محافظ و هشدارهای کیفیت
 * نتایج توصیفی است؛ اعلام برنده فقط با تصمیم انسانی پس از پایان آزمایش انجام می‌شود
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, requirePermission } from '@/lib/api-utils'
import { computeExperimentResults } from '@/lib/experiments'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('analytics.view')
    const { id } = await params
    const experiment = await db.experiment.findUnique({ where: { id } })
    if (!experiment) throw new ApiError(404, 'آزمایش یافت نشد.')

    const [assignments, events] = await Promise.all([
      db.experimentAssignment.findMany({
        where: { experimentId: id },
        select: { visitorId: true, assignedGroup: true, firstExposedAt: true, convertedAt: true, assignedAt: true },
      }),
      db.analyticsEvent.findMany({
        where: { experimentId: id, eventType: { in: ['FORM_INVALID', experiment.primaryMetricEvent] } },
        select: { eventType: true, visitorId: true, variantGroup: true, occurredAt: true },
        take: 20000,
      }),
    ])

    const results = computeExperimentResults(experiment, assignments, events)

    return ok({
      experiment: {
        id: experiment.id,
        title: experiment.title,
        hypothesis: experiment.hypothesis,
        status: experiment.status,
        isAaTest: experiment.isAaTest,
        trafficSplitPercent: experiment.trafficSplitPercent,
        primaryMetricEvent: experiment.primaryMetricEvent,
        startedAt: experiment.startedAt?.toISOString() ?? null,
        plannedEndAt: experiment.plannedEndAt?.toISOString() ?? null,
        endedAt: experiment.endedAt?.toISOString() ?? null,
        decision: experiment.decision,
        decisionReason: experiment.decisionReason,
        decisionLimitations: experiment.decisionLimitations,
        decidedByName: experiment.decidedByName,
        decidedAt: experiment.decidedAt?.toISOString() ?? null,
        emergencyStoppedAt: experiment.emergencyStoppedAt?.toISOString() ?? null,
      },
      results,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
