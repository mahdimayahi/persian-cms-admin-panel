/**
 * مرکز کارهای من
 * GET  /api/tasks — همه چیزهایی که منتظر کاربر جاری است (محاسبه پویا)
 * POST /api/tasks — واگذاری کار جدید به یک کاربر
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { computeTaskCenter, createTask } from '@/lib/tasks-center'

export async function GET() {
  try {
    const user = await requireAuth()
    const data = await computeTaskCenter(user)
    return ok(data)
  } catch (err) {
    return handleApiError(err)
  }
}

interface CreateTaskBody {
  title?: unknown
  description?: unknown
  type?: unknown
  priority?: unknown
  dueDate?: unknown
  link?: unknown
  assignedToId?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<CreateTaskBody>(req)

    const title = vString(body.title, 'عنوان کار', { required: true, min: 3, max: 200 })
    const description = body.description ? vString(body.description, 'توضیح', { max: 1000 }) : null

    const priority = vEnum<'LOW' | 'MEDIUM' | 'HIGH'>(
      body.priority,
      ['LOW', 'MEDIUM', 'HIGH'] as const,
      'اولویت',
      'MEDIUM'
    )
    const type = vEnum<'GENERAL' | 'REVIEW' | 'REVISION' | 'HEALTH'>(
      body.type,
      ['GENERAL', 'REVIEW', 'REVISION', 'HEALTH'] as const,
      'نوع کار',
      'GENERAL'
    )

    if (typeof body.assignedToId !== 'string' || body.assignedToId.trim() === '') {
      throw new ApiError(400, 'انتخاب مسئول کار الزامی است.')
    }
    const assignee = await db.user.findUnique({ where: { id: body.assignedToId.trim() } })
    if (!assignee) throw new ApiError(400, 'کاربر انتخاب‌شده برای واگذاری یافت نشد.')
    if (assignee.status !== 'ACTIVE') {
      throw new ApiError(400, 'کار جدید فقط به کاربران فعال قابل واگذاری است.')
    }

    let dueDate: Date | null = null
    if (body.dueDate) {
      const d = new Date(String(body.dueDate))
      if (Number.isNaN(d.getTime())) throw new ApiError(400, 'تاریخ موعد نامعتبر است.')
      dueDate = d
    }

    const link = body.link && typeof body.link === 'string' && body.link.trim() !== '' ? body.link.trim() : null

    const task = await createTask({
      title,
      description,
      type,
      priority,
      dueDate,
      link,
      assignedToId: assignee.id,
      assignedById: user.id,
      assignedByName: user.name,
    })

    await db.notification.create({
      data: {
        userId: assignee.id,
        type: 'TASK',
        title: 'کار جدیدی به شما واگذار شد',
        body: `${user.name}: «${title}»`,
        link: link ?? '#/tasks',
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'TASK',
      entityId: task.id,
      entityTitle: title,
      details: `واگذاری کار به ${assignee.name}`,
    })

    return ok(task, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
