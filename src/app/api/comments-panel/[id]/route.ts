/**
 * عملیات روی یک نظر گفتگو
 * PATCH  /api/comments-panel/[id] — بدنه: { action: 'RESOLVE'|'REOPEN'|'ASSIGN', assigneeId? }
 *        حل‌کردن (فقط رشتهٔ اصلی)/بازگشایی/تعیین مسئول — نویسندهٔ ردیف یا مدیر همان نوع محتوا
 *        (مقاله → articles.review، صفحه → pages.manage)
 * DELETE /api/comments-panel/[id] — حذف نظر (حذف رشته، پاسخ‌ها را کاسکید حذف می‌کند) — همان مجوز PATCH
 * POST   /api/comments-panel/[id] — تبدیل نظر به درخواست اصلاح (ساخت کار واگذارشده)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vEnum } from '@/lib/api-utils'
import { logActivity, notifyUser } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'
import { createTask } from '@/lib/tasks-center'

async function loadComment(id: string) {
  const comment = await db.contentComment.findUnique({ where: { id } })
  if (!comment) throw new ApiError(404, 'نظر یافت نشد.')
  return comment
}

/** مدیریت گفتگو: نویسندهٔ ردیف یا مدیر همان نوع محتوا (بازبینی مقاله / مدیریت صفحه) */
function canModerate(
  user: { id: string; role: string },
  comment: { authorId: string; entityType: string }
): boolean {
  const permission = comment.entityType === 'ARTICLE' ? 'articles.review' : 'pages.manage'
  return comment.authorId === user.id || roleHasPermission(user.role, permission)
}

/** لینک ویرایشگر همان نوع محتوا */
function editorLink(comment: { entityType: string; entityId: string }): string {
  return comment.entityType === 'ARTICLE' ? `#/articles/${comment.entityId}/edit` : '#/pages'
}

/** عنوان استاندارد کار کارتابل برای رشتهٔ گفتگو */
function threadTaskTitle(thread: { body: string }): string {
  return `گفتگو: ${thread.body.slice(0, 60)}`
}

/**
 * ساخت/انتقال کار کارتابل مرتبط با رشتهٔ گفتگو:
 * اگر کار OPEN برای همان رشته هست فقط مسئول/عنوان/لینکش عوض می‌شود؛ وگرنه کار جدید ساخته می‌شود.
 */
async function upsertThreadTask(
  thread: { entityType: string; entityId: string; body: string },
  threadId: string,
  input: { assigneeId: string; actorId: string; actorName: string }
): Promise<string> {
  const link = editorLink(thread)
  const title = threadTaskTitle(thread)
  const existing = await db.task.findFirst({
    where: { relatedType: 'CONTENT_COMMENT', relatedId: threadId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    await db.task.update({
      where: { id: existing.id },
      data: {
        assignedToId: input.assigneeId,
        assignedById: input.actorId,
        assignedByName: input.actorName,
        title,
        link,
      },
    })
    return existing.id
  }
  const task = await db.task.create({
    data: {
      title,
      type: thread.entityType === 'ARTICLE' ? 'REVISION' : 'GENERAL',
      priority: 'MEDIUM',
      status: 'OPEN',
      link,
      relatedType: 'CONTENT_COMMENT',
      relatedId: threadId,
      assignedToId: input.assigneeId,
      assignedById: input.actorId,
      assignedByName: input.actorName,
    },
  })
  return task.id
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()
    const comment = await loadComment(id)

    if (!canModerate(user, comment)) {
      throw new ApiError(403, 'فقط نویسندهٔ نظر یا مدیر محتوا می‌تواند وضعیت آن را تغییر دهد.')
    }

    const body = await parseBody<{ action?: unknown; assigneeId?: unknown }>(req)
    const action = vEnum<'RESOLVE' | 'REOPEN' | 'ASSIGN'>(body.action, ['RESOLVE', 'REOPEN', 'ASSIGN'] as const, 'عملیات')

    // شناسهٔ رشته: خودِ نظر برای رشتهٔ اصلی؛ والد برای پاسخ
    const threadId = comment.parentId ?? comment.id

    if (action === 'RESOLVE') {
      // حل‌کردن فقط روی رشتهٔ اصلی معنا دارد؛ پاسخ همیشه ردیف پیام است
      if (comment.parentId) {
        throw new ApiError(400, 'حل‌کردن فقط روی رشتهٔ اصلی گفتگو امکان‌پذیر است.')
      }

      const updated = await db.contentComment.update({
        where: { id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByName: user.name },
      })

      // بستن کارهای باز مرتبط با رشته
      await db.task.updateMany({
        where: { relatedType: 'CONTENT_COMMENT', relatedId: id, status: 'OPEN' },
        data: { status: 'DONE', doneAt: new Date() },
      })

      // اعلان به نویسندهٔ رشته و مسئول (جز خودِ انجام‌دهنده)
      const targets = new Set<string>([comment.authorId])
      if (comment.assigneeId) targets.add(comment.assigneeId)
      targets.delete(user.id)
      for (const targetId of targets) {
        await notifyUser(targetId, {
          type: 'DISCUSSION',
          title: 'گفتگو حل شد',
          body: comment.body.slice(0, 140),
          link: editorLink(comment),
        })
      }

      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'UPDATE',
        entityType: 'CONTENT_COMMENT',
        entityId: comment.entityId,
        entityTitle: null,
        details: 'حل‌شدن گفتگو',
      })

      return ok({ ...updated, mentions: JSON.parse(updated.mentions || '[]') as string[] })
    }

    if (action === 'REOPEN') {
      const updated = await db.contentComment.update({
        where: { id },
        data: { status: 'OPEN', resolvedAt: null, resolvedByName: null },
      })

      // بازگشایی کار مرتبط؛ اگر کار بسته‌ای نبود و رشته مسئول دارد، کار دوباره ساخته می‌شود
      const reopened = await db.task.updateMany({
        where: { relatedType: 'CONTENT_COMMENT', relatedId: threadId, status: 'DONE' },
        data: { status: 'OPEN', doneAt: null },
      })
      if (reopened.count === 0 && comment.assigneeId) {
        await upsertThreadTask(comment, threadId, {
          assigneeId: comment.assigneeId,
          actorId: user.id,
          actorName: user.name,
        })
      }

      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'UPDATE',
        entityType: 'CONTENT_COMMENT',
        entityId: comment.entityId,
        entityTitle: null,
        details: 'بازگشایی گفتگو',
      })

      return ok({ ...updated, mentions: JSON.parse(updated.mentions || '[]') as string[] })
    }

    // ASSIGN — تغییر مسئول رشته/ردیف و انتقال یا ساخت کار مرتبط
    if (typeof body.assigneeId !== 'string' || body.assigneeId.trim() === '') {
      throw new ApiError(400, 'انتخاب مسئول الزامی است.')
    }
    const assignee = await db.user.findUnique({
      where: { id: body.assigneeId.trim() },
      select: { id: true, name: true, status: true },
    })
    if (!assignee || assignee.status !== 'ACTIVE') throw new ApiError(400, 'مسئول انتخابی معتبر نیست.')

    const updated = await db.contentComment.update({
      where: { id },
      data: { assigneeId: assignee.id, assigneeName: assignee.name },
    })

    await upsertThreadTask(comment, threadId, {
      assigneeId: assignee.id,
      actorId: user.id,
      actorName: user.name,
    })

    // اعلان به مسئول جدید (جز خودِ انجام‌دهنده)
    if (assignee.id !== user.id) {
      await notifyUser(assignee.id, {
        type: 'DISCUSSION',
        title: 'مسئول گفتگو شدید',
        body: `${user.name}: ${comment.body.slice(0, 140)}`,
        link: editorLink(comment),
      })
    }

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'CONTENT_COMMENT',
      entityId: comment.entityId,
      entityTitle: null,
      details: 'تعیین مسئول گفتگو',
    })

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
      throw new ApiError(403, 'فقط نویسندهٔ نظر یا مدیر محتوا می‌تواند آن را حذف کند.')
    }

    // حذف صریح پاسخ‌ها (کاسکید Prisma هم پوشش می‌دهد) + لغو کارهای باز رشته
    await db.contentComment.deleteMany({ where: { parentId: id } })
    await db.task.updateMany({
      where: { relatedType: 'CONTENT_COMMENT', relatedId: id, status: 'OPEN' },
      data: { status: 'CANCELLED' },
    })
    await db.contentComment.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'CONTENT_COMMENT',
      entityId: comment.entityId,
      entityTitle: null,
      details: 'حذف نظر گفتگو',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
