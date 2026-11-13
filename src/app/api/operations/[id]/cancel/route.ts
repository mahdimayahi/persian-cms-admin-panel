/**
 * لغو عملیات
 * QUEUED → لغو فوری؛ RUNNING → ثبت cancelRequested و توقف در گام بعدی پردازشگر
 * POST /api/operations/[id]/cancel → { ok, status }
 * مجوز: articles.publish
 */
import { NextRequest } from 'next/server'
import { ok, handleApiError, requirePermission } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { cancelOperation } from '@/lib/operations'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.publish')

    const status = await cancelOperation(id)

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CANCEL',
      entityType: 'OPERATION_LOG',
      entityId: id,
      entityTitle: null,
      details: 'درخواست لغو عملیات',
    })

    return ok({ ok: true, status })
  } catch (err) {
    return handleApiError(err)
  }
}
