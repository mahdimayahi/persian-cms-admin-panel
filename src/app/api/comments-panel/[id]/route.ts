/**
 * عملیات روی یک نظر گفتگو
 * PATCH  /api/comments-panel/[id] — بدنه: { action: 'RESOLVE' | 'REOPEN' | 'ASSIGN', assigneeId? }
 *        حل‌کردن/بازگشایی/تعیین مسئول — نویسنده نظر یا بازبین
 * DELETE /api/comments-panel/[id] — حذف نظر — نویسنده نظر یا بازبین
 * POST   /api/comments-panel/[id] — تبدیل نظر به درخواست اصلاح (ساخت کار واگذارشده)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'
import { createTask } from '@/lib/tasks-center'

async function loadComment(id: string) {
  const comment = await db.contentComment.findUnique({ where: { id } })
  if (!comment) throw new ApiError(404, 'نظر یافت نشد.')
  return comment
}

function canModerate(user: { id: string; role: string }, comment: { authorId: string }): boolean {
  return comment.authorId === user.id || roleHasPermission(user.role, 'articles.review')
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()
    const comment = await loadComment(id)

    if (!canModerate(user, comment)) {
      throw new ApiError(403, 'فقط نویسنده نظر یا بازبین می‌تواند وضعیت آن را تغییر دهد.')
    }

    const body = await parseBody<{ action?: unknown; assigneeId?: unknown }>(req)
    const action = vEnum<'RESOLVE' | 'REOPEN' | 'ASSIGN'>(body.action, ['RESOLVE', 'REOPEN', 'ASSIGN'] as const, 'عملیات')

    const data: { status?: string; resolvedAt?: Date | null; resolvedByName?: string | null; assigneeId?: string | null; assigneeName?: string | null } = {}

    if (action === 'RESOLVE') {
      data.status = 'RESOLVED'
      data.resolvedAt = new Date()
      data.resolvedByName = user.name
    } else if (action === 'REOPEN') {
      data.status = 'OPEN'
      data.resolvedAt = null
      data.resolvedByName = null
    } else {
      if (typeof body.assigneeId !== 'string' || body.assigneeId.trim() === '') {
        throw new ApiError(400, 'انتخاب مسئول الزامی است.')
      }
      const assignee = await db.user.findUnique({ where: { id: body.assigneeId.trim() }, select: { id: true, name: true, status: true } })
      if (!assignee || assignee.status !== 'ACTIVE') throw new ApiError(400, 'مسئول انتخابی معتبر نیست.')
      data.assigneeId = assignee.id
      data.assigneeName = assignee.name
    }

    const updated = await db.contentComment.update({ where: { id }, data })

    if (action === 'RESOLVE') {
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'UPDATE',
        entityType: 'CONTENT_COMMENT',
        entityId: comment.entityId,
        entityTitle: null,
        details: 'حل‌شدن گفتگو',
      })
    }

    return ok({ ...updated, mentions: JSON.parse(updated.mentions || '[]') as string[] })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()
    const comment = await loadComment(id)

    if (!canModerate(user, comment)) {
      throw new ApiError(403, 'فقط نویسنده نظر یا بازبین می‌تواند آن را به درخواست اصلاح تبدیل کند.')
    }
    if (comment.entityType !== 'ARTICLE') {
      throw new ApiError(400, 'تبدیل به درخواست اصلاح فعلاً فقط برای مقالات فعال است.')
    }

    const article = await db.article.findUnique({ where: { id: comment.entityId }, select: { id: true, title: true, authorId: true } })
    if (!article) throw new ApiError(404, 'مقاله مرتبط یافت نشد.')

    // مسئول درخواست اصلاح: مسئول نظر اگر تعیین شده، وگرنه نویسنده مقاله
    const targetId = comment.assigneeId ?? article.authorId

    const task = await createTask({
      title: `اصلاح بر اساس گفتگو — «${article.title}»`,
      description: comment.body,
      type: 'REVISION',
      priority: 'MEDIUM',
      link: `#/articles/${article.id}/edit`,
      relatedType: 'ARTICLE',
      relatedId: article.id,
      assignedToId: targetId,
      assignedById: user.id,
      assignedByName: user.name,
    })

    // اعلان به مسئول
    if (targetId !== user.id) {
      await db.notification.create({
        data: {
          userId: targetId,
          type: 'TASK',
          title: 'درخواست اصلاح جدید از گفتگو',
          body: `${user.name}: ${comment.body.slice(0, 120)}`,
          link: `#/articles/${article.id}/edit`,
        },
      }).catch(() => undefined)
    }

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'TASK',
      entityId: task.id,
      entityTitle: task.title,
      details: 'تبدیل نظر گفتگو به درخواست اصلاح',
    })

    return ok(task, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()
    const comment = await loadComment(id)

    if (!canModerate(user, comment)) {
      throw new ApiError(403, 'فقط نویسنده نظر یا بازبین می‌تواند آن را حذف کند.')
    }

    await db.contentComment.delete({ where: { id } })
    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
