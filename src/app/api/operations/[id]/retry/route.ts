/**
 * تلاش مجدد عملیات — فقط موارد ناموفق در یک عملیات جدید اجرا می‌شوند
 * (بدون تکرار اثرهای موفق قبلی)
 * POST /api/operations/[id]/retry → 202 { id, status: 'QUEUED' }
 * مجوز: articles.publish
 */
import { NextRequest } from 'next/server'
import { ok, handleApiError, requirePermission } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { retryOperation } from '@/lib/operations'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.publish')

    const newOpId = await retryOperation(id, { id: user.id, name: user.name })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'RETRY',
      entityType: 'OPERATION_LOG',
      entityId: id,
      entityTitle: null,
      details: 'تلاش مجدد موارد ناموفق عملیات',
    })

    return ok({ id: newOpId, status: 'QUEUED' }, { status: 202 })
  } catch (err) {
    return handleApiError(err)
  }
}
