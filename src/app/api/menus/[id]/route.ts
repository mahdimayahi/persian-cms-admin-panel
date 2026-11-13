/**
 * API آیتم منوی مشخص
 * PUT    /api/menus/[id] — ویرایش آیتم منو
 * DELETE /api/menus/[id] — حذف آیتم منو
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vInt } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('menus.manage')

    const item = await db.menuItem.findUnique({ where: { id } })
    if (!item) throw new ApiError(404, 'آیتم منو یافت نشد.')

    const body = await parseBody<{ label?: unknown; url?: unknown; order?: unknown }>(req)
    const data: Prisma.MenuItemUncheckedUpdateInput = {}

    if (body.label !== undefined && body.label !== null) {
      data.label = vString(body.label, 'عنوان منو', { required: true, max: 100 })
    }
    if (body.url !== undefined && body.url !== null) {
      data.url = vString(body.url, 'آدرس', { required: true, max: 500 })
    }
    if (body.order !== undefined && body.order !== null && body.order !== '') {
      data.order = vInt(body.order, 'ترتیب نمایش', { min: 0 }) ?? 0
    }

    const updated = await db.menuItem.update({ where: { id }, data })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'MENU',
      entityId: id,
      entityTitle: updated.label,
      details: 'ویرایش آیتم منو',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('menus.manage')

    const item = await db.menuItem.findUnique({ where: { id } })
    if (!item) throw new ApiError(404, 'آیتم منو یافت نشد.')

    await db.menuItem.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'MENU',
      entityId: id,
      entityTitle: item.label,
      details: 'حذف آیتم منو',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
