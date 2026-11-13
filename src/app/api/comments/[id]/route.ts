/**
 * API دیدگاه مشخص
 * PUT    /api/comments/[id] — تغییر وضعیت دیدگاه (بررسی/تأیید/رد)
 * DELETE /api/comments/[id] — حذف دیدگاه
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { COMMENT_STATUSES, commentStatusInfo } from '@/lib/constants'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('comments.moderate')

    const comment = await db.comment.findUnique({ where: { id } })
    if (!comment) throw new ApiError(404, 'دیدگاه یافت نشد.')

    const body = await parseBody<{ status?: unknown }>(req)
    const status = vEnum(body.status, COMMENT_STATUSES.map((s) => s.value), 'وضعیت دیدگاه')

    const updated = await db.comment.update({
      where: { id },
      data: { status },
      include: { article: { select: { id: true, title: true } } },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'MODERATE',
      entityType: 'COMMENT',
      entityId: id,
      entityTitle: comment.content.slice(0, 40),
      details: `تغییر وضعیت دیدگاه به «${commentStatusInfo(status).label}»`,
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('comments.moderate')

    const comment = await db.comment.findUnique({ where: { id } })
    if (!comment) throw new ApiError(404, 'دیدگاه یافت نشد.')

    await db.comment.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'COMMENT',
      entityId: id,
      entityTitle: comment.content.slice(0, 40),
      details: 'حذف دیدگاه',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
