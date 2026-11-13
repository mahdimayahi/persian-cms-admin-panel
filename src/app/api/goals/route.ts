/**
 * API هدف‌های محتوا
 * GET /api/goals — فهرست هدف‌ها با خلاصهٔ عملکرد (مجوز analytics.view)
 * POST /api/goals — تعریف هدف با قرارداد شاخص شفاف (مجوز analytics.manage)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, requirePermission, parseBody, vString, vInt, vEnum } from '@/lib/api-utils'
import { SUCCESS_EVENTS } from '@/lib/analytics'

export async function GET() {
  try {
    await requirePermission('analytics.view')
    const goals = await db.contentGoal.findMany({
      orderBy: { createdAt: 'desc' },
      include: { article: { select: { id: true, title: true, slug: true, status: true } } },
    })
    return ok({ items: goals })
  } catch (err) {
    return handleApiError(err)
  }
}

type CreateBody = {
  title?: string
  contentId?: string
  primaryGoal?: string
  successEvent?: string
  metricLabel?: string
  metricNumerator?: string
  metricDenominator?: string
  attributionRule?: string
  attributionHours?: number
  ownerUserId?: string
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('analytics.manage')
    const body = await parseBody<CreateBody>(req)

    const title = vString(body.title, 'عنوان هدف', { min: 4, max: 120 })
    const contentId = vString(body.contentId, 'محتوای هدف', { required: true, max: 40 })
    const article = await db.article.findUnique({ where: { id: contentId } })
    if (!article) throw new ApiError(400, 'محتوای هدف یافت نشد.')

    const primaryGoal = vString(body.primaryGoal, 'هدف اصلی', { min: 4, max: 300 })
    const successEvent = vEnum(body.successEvent, SUCCESS_EVENTS, 'رویداد موفقیت', 'FORM_SUCCESS')
    const metricLabel = vString(body.metricLabel, 'شاخص اصلی', { min: 3, max: 120 })
    const metricNumerator = vString(body.metricNumerator, 'تعریف صورت نرخ', { min: 4, max: 400 })
    const metricDenominator = vString(body.metricDenominator, 'تعریف مخرج نرخ', { min: 4, max: 400 })
    const attributionRule = vEnum(body.attributionRule, ['AFTER_FIRST_VIEW', 'SAME_SESSION'] as const, 'قاعدهٔ انتساب', 'AFTER_FIRST_VIEW')
    const attributionHours = vInt(body.attributionHours, 'پنجرهٔ انتساب', { min: 1, max: 168 }) ?? 24

    // مسئول پیگیری (اختیاری)
    let ownerUserId: string | null = null
    let ownerName: string | null = null
    if (body.ownerUserId) {
      const owner = await db.user.findUnique({ where: { id: String(body.ownerUserId) } })
      if (owner) {
        ownerUserId = owner.id
        ownerName = owner.name
      }
    }

    const existing = await db.contentGoal.findFirst({ where: { contentId, status: { not: 'ARCHIVED' } } })
    if (existing) throw new ApiError(400, 'برای این محتوا پیش‌تر هدف فعالی تعریف شده است.')

    const goal = await db.contentGoal.create({
      data: {
        title,
        contentId,
        primaryGoal,
        successEvent,
        metricLabel,
        metricNumerator,
        metricDenominator,
        attributionRule,
        attributionHours,
        ownerUserId,
        ownerName,
        createdById: user.id,
        createdByName: user.name,
      },
    })

    return ok({ goal }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
