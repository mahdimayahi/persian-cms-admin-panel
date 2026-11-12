/**
 * API ثبت مواجههٔ واقعی
 * POST /api/experiments/[id]/expose — { visitorId, group }
 * تخصیص به گروه با مشاهدهٔ نسخه یکسان نیست؛ مواجهه زمانی ثبت می‌شود که نسخه طبق تعریف فنی واقعاً ارائه شده باشد.
 * هر بازدیدکننده فقط نخستین مواجهه زمان‌دار می‌شود؛ شمارش تکراری ایجاد نمی‌شود.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, ok, checkRateLimit } from '@/lib/api-utils'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (!checkRateLimit(`expose:${ip}`, 1200, 60_000)) {
      throw new ApiError(429, 'حجم درخواست بیش از حد مجاز است.')
    }

    let body: { visitorId?: unknown; group?: unknown; occurredAt?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      throw new ApiError(400, 'بدنهٔ درخواست نامعتبر است.')
    }

    const visitorId = typeof body.visitorId === 'string' ? body.visitorId.trim() : ''
    if (!/^[A-Za-z0-9_\-.:]{6,80}$/.test(visitorId)) throw new ApiError(400, 'شناسهٔ بازدیدکننده نامعتبر است.')
    const group = body.group === 'CONTROL' || body.group === 'VARIANT' ? body.group : null
    if (!group) throw new ApiError(400, 'گروه نسخه نامعتبر است.')

    const experiment = await db.experiment.findUnique({ where: { id } })
    if (!experiment) throw new ApiError(404, 'آزمایش یافت نشد.')
    if (experiment.status !== 'RUNNING') {
      return ok({ ok: false, reason: 'آزمایش در حال اجرا نیست؛ مواجهه ثبت نشد.' })
    }

    // زمان مواجههٔ واقعی (اختیاری) — نباید در آینده یا پیش از شروع آزمایش باشد
    let exposedAt = new Date()
    if (body.occurredAt !== undefined) {
      const parsed = new Date(String(body.occurredAt))
      if (Number.isNaN(parsed.getTime())) throw new ApiError(400, 'زمان مواجهه نامعتبر است.')
      if (parsed.getTime() > Date.now() + 5 * 60 * 1000) throw new ApiError(400, 'زمان مواجهه نمی‌تواند در آینده باشد.')
      if (experiment.startedAt && parsed.getTime() < experiment.startedAt.getTime() - 60 * 1000) {
        throw new ApiError(400, 'زمان مواجهه نمی‌تواند پیش از شروع آزمایش باشد.')
      }
      exposedAt = parsed
    }

    const assignment = await db.experimentAssignment.findUnique({
      where: { experimentId_visitorId: { experimentId: id, visitorId } },
    })
    if (!assignment) throw new ApiError(400, 'برای این بازدیدکننده تخصیص ثبت نشده است؛ ابتدا تخصیص انجام شود.')
    if (assignment.assignedGroup !== group) {
      // ناهماهنگی گروه — اختلال ثبت می‌شود و مواجهه پذیرفته نمی‌شود
      throw new ApiError(400, 'ناهماهنگی گروه نسخه؛ مواجهه با این گروه پذیرفته نمی‌شود.')
    }

    await db.experimentAssignment.update({
      where: { id: assignment.id },
      data: {
        firstExposedAt: assignment.firstExposedAt ?? exposedAt,
        exposureCount: { increment: 1 },
      },
    })

    return ok({ ok: true, firstExposure: assignment.firstExposedAt === null })
  } catch (err) {
    return handleApiError(err)
  }
}
