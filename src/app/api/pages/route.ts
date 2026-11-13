/**
 * API صفحات ثابت سایت
 * GET  /api/pages — فهرست همه صفحات به ترتیب نمایش (بدون صفحه‌بندی)
 * POST /api/pages — ایجاد صفحه جدید
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ApiError,
  ok,
  handleApiError,
  requirePermission,
  parseBody,
  vString,
  vEnum,
  vBoolean,
  vInt,
  slugify,
} from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET() {
  try {
    await requirePermission('pages.view')
    const pages = await db.page.findMany({ orderBy: { order: 'asc' } })
    return ok(pages)
  } catch (err) {
    return handleApiError(err)
  }
}

interface PageBody {
  title?: unknown
  slug?: unknown
  content?: unknown
  status?: unknown
  showInNav?: unknown
  order?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('pages.manage')
    const body = await parseBody<PageBody>(req)

    const title = vString(body.title, 'عنوان صفحه', { required: true, max: 200 })
    const slug = slugify(typeof body.slug === 'string' && body.slug.trim() !== '' ? body.slug : title)

    const slugTaken = await db.page.findUnique({ where: { slug }, select: { id: true } })
    if (slugTaken) throw new ApiError(409, 'صفحه‌ای با این آدرس کوتاه وجود دارد.')

    const status = vEnum(body.status, ['DRAFT', 'PUBLISHED'] as const, 'وضعیت صفحه', 'DRAFT')
    const content = typeof body.content === 'string' ? body.content : ''
    const showInNav = body.showInNav === undefined ? false : vBoolean(body.showInNav)
    const order =
      body.order === undefined || body.order === null || body.order === ''
        ? 0
        : vInt(body.order, 'ترتیب نمایش', { min: 0 }) ?? 0

    const page = await db.page.create({ data: { title, slug, content, status, showInNav, order } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'PAGE',
      entityId: page.id,
      entityTitle: title,
      details: 'ایجاد صفحه جدید',
    })

    return ok(page)
  } catch (err) {
    return handleApiError(err)
  }
}
