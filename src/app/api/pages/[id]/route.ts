/**
 * API صفحه مشخص
 * GET    /api/pages/[id] — مشاهده صفحه
 * PUT    /api/pages/[id] — ویرایش صفحه
 * DELETE /api/pages/[id] — حذف صفحه
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('pages.view')
    const { id } = await params
    const page = await db.page.findUnique({ where: { id } })
    if (!page) throw new ApiError(404, 'صفحه یافت نشد.')
    return ok(page)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('pages.manage')

    const page = await db.page.findUnique({ where: { id } })
    if (!page) throw new ApiError(404, 'صفحه یافت نشد.')

    const body = await parseBody<{
      title?: unknown
      slug?: unknown
      content?: unknown
      status?: unknown
      showInNav?: unknown
      order?: unknown
    }>(req)

    const data: Prisma.PageUncheckedUpdateInput = {}

    if (body.title !== undefined && body.title !== null) {
      data.title = vString(body.title, 'عنوان صفحه', { required: true, max: 200 })
    }

    if (typeof body.slug === 'string' && body.slug.trim() !== '') {
      const slug = slugify(body.slug)
      const taken = await db.page.findUnique({ where: { slug }, select: { id: true } })
      if (taken && taken.id !== id) throw new ApiError(409, 'صفحه‌ای با این آدرس کوتاه وجود دارد.')
      data.slug = slug
    }

    if (typeof body.content === 'string') data.content = body.content

    if (body.status !== undefined && body.status !== null && body.status !== '') {
      data.status = vEnum(body.status, ['DRAFT', 'PUBLISHED'] as const, 'وضعیت صفحه')
    }

    if (body.showInNav !== undefined && body.showInNav !== null) {
      data.showInNav = vBoolean(body.showInNav)
    }

    if (body.order !== undefined && body.order !== null && body.order !== '') {
      data.order = vInt(body.order, 'ترتیب نمایش', { min: 0 }) ?? 0
    }

    const updated = await db.page.update({ where: { id }, data })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'PAGE',
      entityId: id,
      entityTitle: updated.title,
      details: 'ویرایش صفحه',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('pages.manage')

    const page = await db.page.findUnique({ where: { id } })
    if (!page) throw new ApiError(404, 'صفحه یافت نشد.')

    await db.page.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'PAGE',
      entityId: id,
      entityTitle: page.title,
      details: 'حذف صفحه',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
