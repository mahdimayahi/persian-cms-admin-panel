/**
 * API انتقال وضعیت مقاله (چرخه انتشار)
 * POST /api/articles/[id]/transition — بدنه: { action, note? }
 * اقدام‌ها: SUBMIT_REVIEW | APPROVE | REJECT | PUBLISH | UNPUBLISH | ARCHIVE | BACK_TO_DRAFT
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vEnum } from '@/lib/api-utils'
import { logActivity, notifyUsers, notifyUser } from '@/lib/audit'
import { createTask } from '@/lib/tasks-center'
import { roleHasPermission } from '@/lib/permissions'
import {
  TRANSITION_ACTIONS,
  TRANSITION_LABELS,
  articleStatusInfo,
  type TransitionAction,
} from '@/lib/constants'

/** نقشه انتقال‌های مجاز وضعیت */
const TRANSITIONS: Record<TransitionAction, { from: string[]; to: string }> = {
  SUBMIT_REVIEW: { from: ['DRAFT', 'NEEDS_REVISION'], to: 'IN_REVIEW' },
  APPROVE: { from: ['IN_REVIEW'], to: 'APPROVED' },
  REJECT: { from: ['IN_REVIEW'], to: 'NEEDS_REVISION' },
  PUBLISH: { from: ['APPROVED'], to: 'PUBLISHED' },
  UNPUBLISH: { from: ['PUBLISHED'], to: 'DRAFT' },
  ARCHIVE: { from: ['PUBLISHED', 'APPROVED'], to: 'ARCHIVED' },
  BACK_TO_DRAFT: { from: ['NEEDS_REVISION', 'APPROVED'], to: 'DRAFT' },
}

interface TransitionBody {
  action?: unknown
  note?: unknown
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.view')
    const body = await parseBody<TransitionBody>(req)
    const action = vEnum<TransitionAction>(body.action, TRANSITION_ACTIONS, 'عملیات')

    const article = await db.article.findUnique({ where: { id } })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    const rule = TRANSITIONS[action]
    if (!rule.from.includes(article.status)) {
      throw new ApiError(
        400,
        `انتقال وضعیت از «${articleStatusInfo(article.status).label}» به «${articleStatusInfo(rule.to).label}» مجاز نیست.`
      )
    }

    // بررسی مجوز مربوط به هر اقدام
    switch (action) {
      case 'SUBMIT_REVIEW': {
        if (!roleHasPermission(user.role, 'articles.create')) {
          throw new ApiError(403, 'شما مجوز ارسال محتوا برای بازبینی را ندارید.')
        }
        if (article.authorId !== user.id && !roleHasPermission(user.role, 'articles.review')) {
          throw new ApiError(403, 'فقط نویسنده مقاله یا بازبین می‌تواند آن را برای بررسی ارسال کند.')
        }
        break
      }
      case 'APPROVE':
      case 'REJECT': {
        if (!roleHasPermission(user.role, 'articles.review')) {
          throw new ApiError(403, 'شما مجوز بازبینی و تأیید محتوا را ندارید.')
        }
        break
      }
      case 'PUBLISH':
      case 'UNPUBLISH':
      case 'ARCHIVE': {
        if (!roleHasPermission(user.role, 'articles.publish')) {
          throw new ApiError(403, 'شما مجوز انتشار مقاله را ندارید.')
        }
        break
      }
      case 'BACK_TO_DRAFT': {
        if (article.authorId !== user.id && !roleHasPermission(user.role, 'articles.review')) {
          throw new ApiError(403, 'فقط نویسنده مقاله یا بازبین می‌تواند آن را به پیش‌نویس بازگرداند.')
        }
        break
      }
    }

    // یادداشت بازبینی برای «بازگشت برای اصلاح» الزامی است
    let note: string | null = null
    if (action === 'REJECT') {
      if (typeof body.note !== 'string' || body.note.trim().length < 5) {
        throw new ApiError(400, 'یادداشت بازبینی الزامی است.')
      }
      note = body.note.trim()
    }

    const data: Prisma.ArticleUncheckedUpdateInput = { status: rule.to }
    if (action === 'REJECT') {
      data.reviewNote = note
    } else {
      data.reviewNote = null // با خروج از وضعیت «نیازمند اصلاح»، یادداشت پاک می‌شود
    }
    if (action === 'PUBLISH' && !article.publishedAt) {
      data.publishedAt = new Date()
    }

    const updated = await db.article.update({
      where: { id },
      data,
      include: {
        author: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true } },
        tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
      },
    })

    // اعلان‌های درون‌پنلی
    if (action === 'SUBMIT_REVIEW') {
      await notifyUsers(['ADMIN', 'EDITOR'], {
        type: 'REVIEW_REQUEST',
        title: 'محتوای جدید برای بررسی',
        body: `«${article.title}» برای بازبینی ارسال شد.`,
        link: `#/articles/${article.id}/edit`,
        excludeUserId: user.id,
      })
    } else if (action === 'APPROVE') {
      await notifyUser(article.authorId, {
        type: 'APPROVED',
        title: 'مقاله شما تأیید شد',
        body: `«${article.title}» آماده انتشار است.`,
        link: `#/articles/${article.id}/edit`,
      })
    } else if (action === 'REJECT') {
      await notifyUser(article.authorId, {
        type: 'REJECTED',
        title: 'مقاله نیازمند اصلاح',
        body: note ?? '',
        link: `#/articles/${article.id}/edit`,
      })
    } else if (action === 'PUBLISH') {
      await notifyUser(article.authorId, {
        type: 'PUBLISHED',
        title: 'مقاله شما منتشر شد',
        body: `«${article.title}» در سایت منتشر شد.`,
        link: '#/articles',
      })
    }

    // ── اتوماسیون سبک گردش کار ─────────────────────────────
    if (action === 'REJECT') {
      // کار خودکار اصلاح برای نویسنده ساخته می‌شود
      await createTask({
        title: `اصلاح مقاله «${article.title}»`,
        description: note ?? 'مقاله توسط بازبین بازگردانده شد؛ یادداشت بازبینی را ببینید.',
        type: 'REVISION',
        priority: 'HIGH',
        link: `#/articles/${article.id}/edit`,
        relatedType: 'ARTICLE',
        relatedId: article.id,
        assignedToId: article.authorId,
        assignedById: user.id,
        assignedByName: user.name,
      })
    } else if (action === 'SUBMIT_REVIEW') {
      // با ارسال مجدد برای بررسی، کارهای باز اصلاحِ همین مقاله بسته می‌شوند
      await db.task.updateMany({
        where: { relatedType: 'ARTICLE', relatedId: article.id, type: 'REVISION', status: 'OPEN' },
        data: { status: 'DONE', doneAt: new Date() },
      })
    } else if (action === 'PUBLISH') {
      // کارهای باز مرتبط با این مقاله (مانند «بازبینی پیش از جمعه») بسته می‌شوند
      await db.task.updateMany({
        where: { relatedType: 'ARTICLE', relatedId: article.id, type: { in: ['REVIEW', 'REVISION'] }, status: 'OPEN' },
        data: { status: 'DONE', doneAt: new Date() },
      })
    }

    await logActivity({
      userId: user.id,
      userName: user.name,
      action,
      entityType: 'ARTICLE',
      entityId: id,
      entityTitle: article.title,
      details: `${TRANSITION_LABELS[action]}${note ? ` — ${note}` : ''}`,
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
