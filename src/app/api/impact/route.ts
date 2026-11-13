/**
 * بررسی اثر تغییر قبل از حذف/تغییر
 * GET /api/impact?type=article|category|tag|media|user|page&id=...
 * پاسخ: ImpactReport کامل (گروه‌های وابستگی با شدت INFO/WARNING/BLOCKING و حداکثر ۵ نمونه در هر گروه)
 * مصرف‌کننده: impact-dialog
 */
import { NextRequest } from 'next/server'
import { ApiError, ok, handleApiError, requirePermission } from '@/lib/api-utils'
import { computeImpact, IMPACT_TYPES } from '@/lib/impact'

export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('articles.view')
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') ?? ''
    const id = searchParams.get('id') ?? ''

    if (!(IMPACT_TYPES as readonly string[]).includes(type)) {
      throw new ApiError(400, 'نوع موجودیت پشتیبانی نمی‌شود.')
    }
    if (!id) throw new ApiError(400, 'شناسه موجودیت الزامی است.')

    const report = await computeImpact(type, id, { id: user.id, role: user.role })

    return ok(report)
  } catch (err) {
    return handleApiError(err)
  }
}
