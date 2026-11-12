/**
 * عملیات روی یک واژه واژه‌نامه
 * PUT    /api/glossary/[id] — ویرایش
 * DELETE /api/glossary/[id] — حذف
 * (مجوز articles.review)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requirePermission('articles.review')
    const existing = await db.glossaryTerm.findUnique({ where: { id } })
    if (!existing) throw new ApiError(404, 'واژه یافت نشد.')

    const body = await parseBody<Record<string, unknown>>(req)
    const data: Record<string, unknown> = {}

    if (body.term !== undefined) {
      const term = vString(body.term, 'واژه', { required: true, min: 2, max: 80 })
      const dup = await db.glossaryTerm.findUnique({ where: { term } })
      if (dup && dup.id !== id) throw new ApiError(409, 'این واژه قبلاً ثبت شده است.')
      data.term = term
    }
    if (body.replacement !== undefined) data.replacement = vString(body.replacement, 'نگارش پیشنهادی', { max: 120 })
    if (body.type !== undefined) {
      data.type = vEnum<'PREFERRED' | 'FORBIDDEN' | 'REVIEW'>(body.type, ['PREFERRED', 'FORBIDDEN', 'REVIEW'] as const, 'نوع قاعده')
    }
    if (body.note !== undefined) data.note = vString(body.note, 'توضیح', { max: 300 })

    const updated = await db.glossaryTerm.update({ where: { id }, data })
    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.review')
    const existing = await db.glossaryTerm.findUnique({ where: { id } })
    if (!existing) throw new ApiError(404, 'واژه یافت نشد.')

    await db.glossaryTerm.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'GLOSSARY_TERM',
      entityId: id,
      entityTitle: existing.term,
      details: 'حذف واژه از واژه‌نامه',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
