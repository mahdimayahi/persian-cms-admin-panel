/**
 * واژه‌نامه و کنترل هویت برند
 * GET  /api/glossary — فهرست واژه‌ها
 * POST /api/glossary — افزودن واژه (مجوز articles.review)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET() {
  try {
    await requirePermission('articles.view')
    const items = await db.glossaryTerm.findMany({ orderBy: { term: 'asc' } })
    return ok({ items })
  } catch (err) {
    return handleApiError(err)
  }
}

interface GlossaryBody {
  term?: unknown
  replacement?: unknown
  type?: unknown
  note?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.review')
    const body = await parseBody<GlossaryBody>(req)

    const term = vString(body.term, 'واژه', { required: true, min: 2, max: 80 })
    const replacement = body.replacement ? vString(body.replacement, 'نگارش پیشنهادی', { max: 120 }) : ''
    const type = vEnum<'PREFERRED' | 'FORBIDDEN' | 'REVIEW'>(
      body.type,
      ['PREFERRED', 'FORBIDDEN', 'REVIEW'] as const,
      'نوع قاعده',
      'PREFERRED'
    )
    const note = body.note ? vString(body.note, 'توضیح', { max: 300 }) : ''

    const exists = await db.glossaryTerm.findUnique({ where: { term } })
    if (exists) throw new ApiError(409, 'این واژه قبلاً در واژه‌نامه ثبت شده است.')

    const item = await db.glossaryTerm.create({
      data: { term, replacement, type, note, createdById: user.id, createdByName: user.name },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'GLOSSARY_TERM',
      entityId: item.id,
      entityTitle: term,
      details: `افزودن واژه به واژه‌نامه (${type})`,
    })

    return ok(item, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
