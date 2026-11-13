/**
 * API برچسب مشخص
 * DELETE /api/tags/[id] — حذف برچسب (پیوندهای ArticleTag به‌صورت آبشاری حذف می‌شوند)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('tags.manage')

    const tag = await db.tag.findUnique({ where: { id } })
    if (!tag) throw new ApiError(404, 'برچسب یافت نشد.')

    await db.tag.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'TAG',
      entityId: id,
      entityTitle: tag.name,
      details: 'حذف برچسب',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
