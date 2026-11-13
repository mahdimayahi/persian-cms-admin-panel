/**
 * API پاسخ فرم مشخص
 * PUT    /api/form-submissions/[id] — تغییر وضعیت پاسخ (جدید/خوانده‌شده/بایگانی)
 * DELETE /api/form-submissions/[id] — حذف پاسخ
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { FORM_STATUSES } from '@/lib/constants'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('forms.manage')

    const submission = await db.formSubmission.findUnique({ where: { id } })
    if (!submission) throw new ApiError(404, 'پاسخ فرم یافت نشد.')

    const body = await parseBody<{ status?: unknown }>(req)
    const status = vEnum(body.status, FORM_STATUSES.map((s) => s.value), 'وضعیت')

    const updated = await db.formSubmission.update({ where: { id }, data: { status } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'FORM',
      entityId: id,
      entityTitle: submission.subject,
      details: 'به‌روزرسانی پاسخ فرم',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('forms.manage')

    const submission = await db.formSubmission.findUnique({ where: { id } })
    if (!submission) throw new ApiError(404, 'پاسخ فرم یافت نشد.')

    await db.formSubmission.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'FORM',
      entityId: id,
      entityTitle: submission.subject,
      details: 'حذف پاسخ فرم',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
