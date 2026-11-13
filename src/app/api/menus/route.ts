/**
 * API آیتم‌های منو
 * GET  /api/menus — فهرست آیتم‌های منو به ترتیب نمایش
 * POST /api/menus — افزودن آیتم منو (ترتیب پیش‌فرض: بیشینه + ۱)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth, requirePermission, parseBody, vString, vInt } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET() {
  try {
    await requireAuth()
    const items = await db.menuItem.findMany({ orderBy: { order: 'asc' } })
    return ok(items)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('menus.manage')
    const body = await parseBody<{ label?: unknown; url?: unknown; order?: unknown }>(req)

    const label = vString(body.label, 'عنوان منو', { required: true, max: 100 })
    const url = vString(body.url, 'آدرس', { required: true, max: 500 })

    let order: number
    if (body.order !== undefined && body.order !== null && body.order !== '') {
      order = vInt(body.order, 'ترتیب نمایش', { min: 0 }) ?? 0
    } else {
      const maxAgg = await db.menuItem.aggregate({ _max: { order: true } })
      order = (maxAgg._max.order ?? 0) + 1
    }

    const item = await db.menuItem.create({ data: { label, url, order } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'MENU',
      entityId: item.id,
      entityTitle: label,
      details: 'افزودن آیتم منو',
    })

    return ok(item)
  } catch (err) {
    return handleApiError(err)
  }
}
