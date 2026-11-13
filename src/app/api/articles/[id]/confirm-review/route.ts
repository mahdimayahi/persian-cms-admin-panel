/**
 * تأیید اعتبار اطلاعات محتوا (مالکیت و بازبینی)
 * POST /api/articles/[id]/confirm-review — بدنه: { months?: 1|3|6|12 }
 * کاربر مسئول محتوا تأیید می‌کند «اطلاعات همچنان معتبر است»؛
 * موعد بازبینی بعدی بر اساس دوره انتخابی تمدید می‌شود.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vInt } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

const MONTH_MS = 30 * 24 * 60 * 60 * 1000

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.view')

    const article = await db.article.findUnique({ where: { id } })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    // نویسنده، مالک مسئول یا بازبین مجاز به تأیید اعتبار است
    const isAuthor = article.authorId === user.id
    const isOwner = article.ownerId === user.id
    const canReview = roleHasPermission(user.role, 'articles.review')
    if (!isAuthor && !isOwner && !canReview) {
      throw new ApiError(403, 'فقط نویسنده، مالک مسئول یا بازبین می‌تواند اعتبار اطلاعات را تأیید کند.')
    }

    const body = await parseBody<{ months?: unknown }>(req)
    const months = vInt(body.months, 'دربه تأیید', { min: 1, max: 36 }) ?? 6

    const now = new Date()
    const reviewAt = new Date(now.getTime() + months * MONTH_MS)

    const updated = await db.article.update({
      where: { id },
      data: { lastReviewedAt: now, reviewAt },
      include: {
        author: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true } },
        tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
        versions: { take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, editorName: true, createdAt: true, note: true } },
        _count: { select: { comments: true } },
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'REVIEW_CONFIRM',
      entityType: 'ARTICLE',
      entityId: id,
      entityTitle: article.title,
      details: `اطلاعات همچنان معتبر است — بازبینی بعدی: ${reviewAt.toLocaleDateString('fa-IR-u-ca-persian')}`,
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
