/**
 * API دیدگاه‌ها
 * GET /api/comments — فهرست دیدگاه‌ها با فیلتر وضعیت/مقاله، جست‌وجو و صفحه‌بندی
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, handleApiError, requirePermission, vEnum, getPaginationParams } from '@/lib/api-utils'
import { COMMENT_STATUSES } from '@/lib/constants'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('comments.view')
    const sp = req.nextUrl.searchParams
    const { page, pageSize, skip, take } = getPaginationParams(sp)

    const q = sp.get('q')?.trim() ?? ''
    const statusParam = sp.get('status') ?? ''
    const articleId = sp.get('articleId') ?? ''

    const status = statusParam
      ? vEnum(statusParam, COMMENT_STATUSES.map((s) => s.value), 'وضعیت دیدگاه')
      : undefined

    const where: Prisma.CommentWhereInput = {}
    if (status) where.status = status
    if (articleId) where.articleId = articleId
    if (q) where.OR = [{ content: { contains: q } }, { authorName: { contains: q } }]

    const [items, total] = await Promise.all([
      db.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { article: { select: { id: true, title: true, slug: true } } },
      }),
      db.comment.count({ where }),
    ])

    return ok({ items, total, page, pageSize })
  } catch (err) {
    return handleApiError(err)
  }
}
