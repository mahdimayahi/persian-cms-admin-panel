/**
 * API ریدایرکت‌های ثبت‌شده (تغییر آدرس محتوای منتشرشده)
 * GET    /api/redirects?entityType=ARTICLE&entityId=... — فهرست (اختیاری: فیلتر موجودیت؛ حداکثر ۱۰۰ مورد، جدیدترین اول)
 * DELETE /api/redirects?id=... — حذف ریدایرکت
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('articles.view')
    const { searchParams } = new URL(req.url)
    const entityType = searchParams.get('entityType') ?? undefined
    const entityId = searchParams.get('entityId') ?? undefined

    const where: Prisma.RedirectWhereInput = {}
    if (entityType) where.entityType = entityType
    if (entityId) where.entityId = entityId

    const items = await db.redirect.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return ok({ items })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requirePermission('articles.edit.any')
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) throw new ApiError(400, 'شناسه ریدایرکت الزامی است.')

    const redirect = await db.redirect.findUnique({ where: { id } })
    if (!redirect) throw new ApiError(404, 'ریدایرکت یافت نشد.')

    await db.redirect.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'REDIRECT',
      entityId: id,
      entityTitle: `${redirect.fromPath} → ${redirect.toPath}`,
      details: 'حذف ریدایرکت',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
