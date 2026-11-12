/**
 * عملیات روی یک کار واگذارشده
 * PATCH /api/tasks/[id] — تغییر وضعیت (انجام‌شده / بازگشایی / لغو)
 * فقط مسئول کار یا مدیر کل مجاز است.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

const TASK_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()

    const task = await db.task.findUnique({ where: { id } })
    if (!task) throw new ApiError(404, 'کار یافت نشد.')

    // فقط مسئول کار یا مدیر کل
    if (task.assignedToId !== user.id && !roleHasPermission(user.role, 'users.manage')) {
      throw new ApiError(403, 'فقط مسئول کار یا مدیر کل می‌تواند وضعیت آن را تغییر دهد.')
    }

    const body = await parseBody<{ status?: unknown }>(req)
    const status = vEnum<(typeof TASK_STATUSES)[number]>(body.status, TASK_STATUSES, 'وضعیت')

    const updated = await db.task.update({
      where: { id },
      data: {
        status,
        doneAt: status === 'DONE' ? new Date() : null,
      },
    })

    const LABELS: Record<string, string> = {
      DONE: 'انجام شد',
      OPEN: 'بازگشایی شد',
      CANCELLED: 'لغو شد',
    }

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'TASK',
      entityId: id,
      entityTitle: task.title,
      details: `وضعیت کار: ${LABELS[status]}`,
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
