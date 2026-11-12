/**
 * عملیات روی یک الگوی محتوا
 * PUT    /api/templates/[id] — ویرایش (مجوز articles.review)
 * DELETE /api/templates/[id] — حذف (مجوز articles.review؛ الگوهای سیستمی فقط مدیر کل)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.review')
    const template = await db.contentTemplate.findUnique({ where: { id } })
    if (!template) throw new ApiError(404, 'الگو یافت نشد.')
    if (template.isSystem && !roleHasPermission(user.role, 'settings.manage')) {
      throw new ApiError(403, 'الگوهای سیستمی فقط توسط مدیر کل قابل ویرایش هستند.')
    }

    const body = await parseBody<Record<string, unknown>>(req)
    const data: Record<string, unknown> = {}

    if (body.name !== undefined) data.name = vString(body.name, 'نام الگو', { required: true, min: 3, max: 120 })
    if (body.description !== undefined) data.description = vString(body.description, 'توضیح', { max: 300 })
    if (body.type !== undefined) data.type = vEnum<'ARTICLE' | 'LANDING'>(body.type, ['ARTICLE', 'LANDING'] as const, 'نوع الگو')
    if (body.titleTemplate !== undefined) data.titleTemplate = vString(body.titleTemplate, 'عنوان الگو', { required: true, min: 3, max: 200 })
    if (body.excerptTemplate !== undefined) data.excerptTemplate = vString(body.excerptTemplate, 'خلاصه الگو', { max: 500 })
    if (body.contentTemplate !== undefined) data.contentTemplate = vString(body.contentTemplate, 'محتوای الگو', { required: true, min: 10, max: 20000 })
    if (Array.isArray(body.tagNames)) {
      const names = body.tagNames.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, 10)
      data.tagNames = JSON.stringify(names)
    }

    const updated = await db.contentTemplate.update({ where: { id }, data })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'CONTENT_TEMPLATE',
      entityId: id,
      entityTitle: updated.name,
      details: 'ویرایش الگوی محتوا',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.review')
    const template = await db.contentTemplate.findUnique({ where: { id } })
    if (!template) throw new ApiError(404, 'الگو یافت نشد.')
    if (template.isSystem && !roleHasPermission(user.role, 'settings.manage')) {
      throw new ApiError(403, 'الگوهای سیستمی فقط توسط مدیر کل قابل حذف هستند.')
    }

    await db.contentTemplate.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'CONTENT_TEMPLATE',
      entityId: id,
      entityTitle: template.name,
      details: 'حذف الگوی محتوا',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
