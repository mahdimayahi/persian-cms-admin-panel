/**
 * عملیات روی یک گزارش پشتیبانی
 * PATCH /api/support/[id] — تغییر وضعیت { status: 'OPEN'|'IN_PROGRESS'|'RESOLVED' } (مجوز users.manage)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const
const LABELS: Record<string, string> = {
  OPEN: 'باز',
  IN_PROGRESS: 'در حال بررسی',
  RESOLVED: 'حل‌شده',
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('users.manage')

    const ticket = await db.supportTicket.findUnique({ where: { id } })
    if (!ticket) throw new ApiError(404, 'گزارش یافت نشد.')

    const body = await parseBody<{ status?: unknown }>(req)
    const status = vEnum<(typeof STATUSES)[number]>(body.status, STATUSES, 'وضعیت')

    const updated = await db.supportTicket.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
        resolvedByName: status === 'RESOLVED' ? user.name : null,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'SUPPORT_TICKET',
      entityId: id,
      entityTitle: ticket.code,
      details: `وضعیت گزارش: ${LABELS[status]}`,
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
