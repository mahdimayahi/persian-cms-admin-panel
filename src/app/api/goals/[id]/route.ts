/**
 * API هدف مشخص
 * GET /api/goals/[id] — جزئیات هدف (analytics.view)
 * PATCH /api/goals/[id] — ویرایش یا تغییر وضعیت (analytics.manage)
 * DELETE /api/goals/[id] — بایگانی هدف؛ برای شفافیت گزارش‌ها حذف فیزیکی انجام نمی‌شود
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, requirePermission, parseBody, vString, vInt, vEnum } from '@/lib/api-utils'
import { SUCCESS_EVENTS } from '@/lib/analytics'

async function getGoalOr404(id: string) {
  const goal = await db.contentGoal.findUnique({ where: { id }, include: { article: { select: { id: true, title: true, slug: true, status: true } } } })
  if (!goal) throw new ApiError(404, 'هدف یافت نشد.')
  return goal
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('analytics.view')
    const { id } = await params
    const goal = await getGoalOr404(id)
    return ok({ goal })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('analytics.manage')
    const { id } = await params
    const goal = await getGoalOr404(id)
    const body = await parseBody<Record<string, unknown>>(req)

    const data: Record<string, unknown> = {}

    if (body.status !== undefined) {
      data.status = vEnum(body.status, ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const, 'وضعیت هدف')
    }
    if (body.title !== undefined) data.title = vString(body.title, 'عنوان هدف', { min: 4, max: 120 })
    if (body.primaryGoal !== undefined) data.primaryGoal = vString(body.primaryGoal, 'هدف اصلی', { min: 4, max: 300 })
    if (body.metricLabel !== undefined) data.metricLabel = vString(body.metricLabel, 'شاخص اصلی', { min: 3, max: 120 })
    if (body.metricNumerator !== undefined) data.metricNumerator = vString(body.metricNumerator, 'تعریف صورت نرخ', { min: 4, max: 400 })
    if (body.metricDenominator !== undefined) data.metricDenominator = vString(body.metricDenominator, 'تعریف مخرج نرخ', { min: 4, max: 400 })
    if (body.attributionRule !== undefined) data.attributionRule = vEnum(body.attributionRule, ['AFTER_FIRST_VIEW', 'SAME_SESSION'] as const, 'قاعدهٔ انتساب')
    if (body.attributionHours !== undefined) data.attributionHours = vInt(body.attributionHours, 'پنجرهٔ انتساب', { min: 1, max: 168 })
    if (body.ownerUserId !== undefined) {
      if (body.ownerUserId === null || body.ownerUserId === '') {
        data.ownerUserId = null
        data.ownerName = null
      } else {
        const owner = await db.user.findUnique({ where: { id: String(body.ownerUserId) } })
        if (!owner) throw new ApiError(400, 'مسئول پیگیری یافت نشد.')
        data.ownerUserId = owner.id
        data.ownerName = owner.name
      }
    }

    const updated = await db.contentGoal.update({ where: { id: goal.id }, data })
    return ok({ goal: updated })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('analytics.manage')
    const { id } = await params
    const goal = await getGoalOr404(id)
    // بایگانی به‌جای حذف: سابقهٔ تعریف شاخص برای تفسیر گزارش‌های گذشته حفظ می‌شود
    const updated = await db.contentGoal.update({ where: { id: goal.id }, data: { status: 'ARCHIVED' } })
    return ok({ goal: updated })
  } catch (err) {
    return handleApiError(err)
  }
}
