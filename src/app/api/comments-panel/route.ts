/**
 * گفتگوهای درون‌محتوایی (کنار رکورد)
 * GET  /api/comments-panel?entityType=ARTICLE&entityId=... — فهرست نظرهای یک محتوا
 * POST /api/comments-panel — ثبت نظر جدید با منشن @ (بدنه: { entityType, entityId, body, mentions? , assigneeId? })
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

const ENTITY_TYPES = ['ARTICLE', 'PAGE'] as const

export async function GET(req: NextRequest) {
  try {
    await requireAuth()
    const { searchParams } = new URL(req.url)
    const entityType = searchParams.get('entityType') ?? ''
    const entityId = searchParams.get('entityId') ?? ''
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType) || !entityId) {
      throw new ApiError(400, 'پارامترهای گفتگو ناقص است.')
    }

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
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<CommentBody>(req)

    const entityType = vEnum<(typeof ENTITY_TYPES)[number]>(body.entityType, ENTITY_TYPES, 'نوع موجودیت')
    const entityId = vString(body.entityId, 'شناسه موجودیت', { required: true, max: 100 })
    const text = vString(body.body, 'متن نظر', { required: true, min: 2, max: 2000 })

    // منشن‌ها: فقط شناسه‌های معتبر از کاربران فعال
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

    // تعیین مسئول (اختیاری)
    let assigneeId: string | null = null
    let assigneeName: string | null = null
    if (typeof body.assigneeId === 'string' && body.assigneeId.trim() !== '') {
      const assignee = await db.user.findUnique({ where: { id: body.assigneeId.trim() }, select: { id: true, name: true, status: true } })
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
        assigneeId,
        assigneeName,
      },
    })

    // اعلان به منشن‌شدگان و مسئول
    const notifyTargets = new Set(mentionIds)
    if (assigneeId) notifyTargets.add(assigneeId)
    notifyTargets.delete(user.id)
    for (const targetId of notifyTargets) {
      await db.notification.create({
        data: {
          userId: targetId,
          type: 'MENTION',
          title: `${user.name} در گفتگویی از شما نام برد`,
          body: text.slice(0, 140),
          link: entityType === 'ARTICLE' ? `#/articles/${entityId}/edit` : '#/pages',
        },
      }).catch(() => undefined)
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
