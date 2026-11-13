/**
 * گفتگوی رکوردی محتوا (کنار رکورد)
 * GET  /api/comments-panel?entityType=ARTICLE|PAGE&entityId=... — فهرست مسطح نظرها (کلاینت رشته می‌سازد) + تعداد باز
 * POST /api/comments-panel — ثبت نظر یا پاسخ
 *      بدنه: { entityType, entityId, body, mentions?, assigneeId?, parentId?, versionRef? }
 *      - پاسخ (parentId) باید به همین موجودیت تعلق داشته باشد؛ در پاسخ assignee نادیده گرفته می‌شود
 *      - تعیین مسئول روی رشتهٔ اصلی → ساخت/انتقال کار کارتابل (بدون کار تکراری)
 * دسترسی: ARTICLE → articles.view، PAGE → pages.view (در GET و POST چک می‌شود)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity, notifyUser } from '@/lib/audit'

const ENTITY_TYPES = ['ARTICLE', 'PAGE'] as const
type EntityType = (typeof ENTITY_TYPES)[number]

/** گارد وجود موجودیت: رکورد باید واقعاً موجود باشد */
async function assertEntityExists(entityType: EntityType, entityId: string) {
  if (entityType === 'ARTICLE') {
    const article = await db.article.findUnique({ where: { id: entityId }, select: { id: true } })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')
  } else {
    const page = await db.page.findUnique({ where: { id: entityId }, select: { id: true } })
    if (!page) throw new ApiError(404, 'صفحه یافت نشد.')
  }
}

/** لینک ویرایشگر همان نوع محتوا */
function editorLink(entityType: EntityType, entityId: string): string {
  return entityType === 'ARTICLE' ? `#/articles/${entityId}/edit` : '#/pages'
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const entityType = vEnum<EntityType>(searchParams.get('entityType'), ENTITY_TYPES, 'نوع موجودیت')
    const entityId = searchParams.get('entityId') ?? ''
    if (!entityId) throw new ApiError(400, 'پارامترهای گفتگو ناقص است.')

    // مجوز مشاهدهٔ همان نوع محتوا + وجود رکورد
    await requirePermission(entityType === 'ARTICLE' ? 'articles.view' : 'pages.view')
    await assertEntityExists(entityType, entityId)

    const items = await db.contentComment.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'asc' },
    })

    return ok({
      items: items.map((c) => ({
        ...c,
        mentions: JSON.parse(c.mentions || '[]') as string[],
      })),
      openCount: items.filter((c) => c.status === 'OPEN').length,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

interface CommentBody {
  entityType?: unknown
  entityId?: unknown
  body?: unknown
  mentions?: unknown
  assigneeId?: unknown
  parentId?: unknown
  versionRef?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<CommentBody>(req)

    const entityType = vEnum<EntityType>(body.entityType, ENTITY_TYPES, 'نوع موجودیت')
    const entityId = vString(body.entityId, 'شناسه موجودیت', { required: true, max: 100 })
    const text = vString(body.body, 'متن نظر', { required: true, min: 2, max: 2000 })

    // مجوز مشاهدهٔ همان نوع محتوا + وجود رکورد
    await requirePermission(entityType === 'ARTICLE' ? 'articles.view' : 'pages.view')
    await assertEntityExists(entityType, entityId)

    // پاسخ به رشته: والد باید با همان موجودیت وجود داشته باشد
    let parentId: string | null = null
    let parent: { id: string; authorId: string } | null = null
    if (typeof body.parentId === 'string' && body.parentId.trim() !== '') {
      parentId = body.parentId.trim()
      const found = await db.contentComment.findUnique({
        where: { id: parentId },
        select: { id: true, authorId: true, entityType: true, entityId: true },
      })
      if (!found || found.entityType !== entityType || found.entityId !== entityId) {
        throw new ApiError(400, 'رشتهٔ والد یافت نشد یا به همین محتوا تعلق ندارد.')
      }
      parent = { id: found.id, authorId: found.authorId }
    }

    // اتصال اختیاری گفتگو به نسخهٔ محتوا
    const versionRef =
      typeof body.versionRef === 'string' && body.versionRef.trim() !== '' ? body.versionRef.trim() : null

    // منشن‌ها: فقط شناسه‌های معتبر از کاربران فعال (منشن فقط اعلان می‌سازد، دسترسی نمی‌سازد)
    let mentionIds: string[] = []
    if (Array.isArray(body.mentions)) {
      const raw = body.mentions.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
      if (raw.length > 0) {
        const users = await db.user.findMany({
          where: { id: { in: raw }, status: 'ACTIVE' },
          select: { id: true },
        })
        mentionIds = users.map((u) => u.id)
      }
    }

    // تعیین مسئول: فقط روی رشتهٔ اصلی؛ در پاسخ نادیده گرفته می‌شود
    let assigneeId: string | null = null
    let assigneeName: string | null = null
    if (!parentId && typeof body.assigneeId === 'string' && body.assigneeId.trim() !== '') {
      const assignee = await db.user.findUnique({
        where: { id: body.assigneeId.trim() },
        select: { id: true, name: true, status: true },
      })
      if (assignee && assignee.status === 'ACTIVE') {
        assigneeId = assignee.id
        assigneeName = assignee.name
      }
    }

    const comment = await db.contentComment.create({
      data: {
        entityType,
        entityId,
        body: text,
        authorId: user.id,
        authorName: user.name,
        mentions: JSON.stringify(mentionIds),
        status: 'OPEN', // پاسخ هم ردیف پیام است و OPEN می‌ماند
        assigneeId,
        assigneeName,
        parentId,
        versionRef,
      },
    })

    // threadId: خودِ نظر برای رشتهٔ اصلی؛ والد برای پاسخ — فقط رشته کار کارتابل می‌گیرد
    const threadId = parentId ?? comment.id

    // ساخت/انتقال کار کارتابل برای رشتهٔ دارای مسئول (بدون کار تکراری)
    if (assigneeId && assigneeName) {
      const taskTitle = `گفتگو: ${text.slice(0, 60)}`
      const link = editorLink(entityType, entityId)
      const existingTask = await db.task.findFirst({
        where: { relatedType: 'CONTENT_COMMENT', relatedId: threadId, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
      })
      if (existingTask) {
        await db.task.update({
          where: { id: existingTask.id },
          data: {
            assignedToId: assigneeId,
            assignedById: user.id,
            assignedByName: user.name,
            title: taskTitle,
            link,
          },
        })
      } else {
        await db.task.create({
          data: {
            title: taskTitle,
            type: entityType === 'ARTICLE' ? 'REVISION' : 'GENERAL',
            priority: 'MEDIUM',
            status: 'OPEN',
            link,
            relatedType: 'CONTENT_COMMENT',
            relatedId: threadId,
            assignedToId: assigneeId,
            assignedById: user.id,
            assignedByName: user.name,
          },
        })
      }
    }

    // اعلان به منشن‌شدگان + مسئول + (در پاسخ) نویسندهٔ رشته — بدون خود فرستنده
    const notifyTargets = new Set(mentionIds)
    if (assigneeId) notifyTargets.add(assigneeId)
    if (parent) notifyTargets.add(parent.authorId)
    notifyTargets.delete(user.id)
    for (const targetId of notifyTargets) {
      await notifyUser(targetId, {
        type: 'MENTION',
        title: `${user.name} در گفتگویی از شما نام برد`,
        body: text.slice(0, 140),
        link: editorLink(entityType, entityId),
      })
    }

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'CONTENT_COMMENT',
      entityId,
      entityTitle: null,
      details: 'ثبت نظر در گفتگوی محتوا',
    })

    return ok({ ...comment, mentions: mentionIds }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
