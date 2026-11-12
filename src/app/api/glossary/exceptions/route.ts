/**
 * استثناهای واژه‌نامه برند — موارد نادیده‌گرفته‌شده برای یک محتوای مشخص
 *
 * قواعد مجوز:
 * - بازبینی‌کننده (articles.review) یا نویسندهِ خود مقاله می‌تواند استثنا ثبت کند.
 * - اگر entityId نباشد یا مقاله یافت نشود، فقط articles.review مجاز است.
 * - حذف استثنا: بازبینی‌کننده یا ثبت‌کنندهِ همان استثنا.
 *
 * اصل: استثنا همیشه با دلیل و مسئول ثبت می‌شود و هرگز محتوا را تغییر نمی‌دهد.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, requireAuth, parseBody, vString, vEnum } from '@/lib/api-utils'
import { roleHasPermission } from '@/lib/permissions'
import { logActivity } from '@/lib/audit'
import { GLOSSARY_FIELD_LABELS, type GlossaryFieldType } from '@/lib/glossary-check'

const ENTITY_TYPES = ['ARTICLE'] as const
const FIELDS: GlossaryFieldType[] = ['TITLE', 'EXCERPT', 'CONTENT', 'SEO_TITLE', 'SEO_DESCRIPTION']

/** مجوز ثبت استثنا: بازبینی‌کننده یا نویسندهِ خود مقاله */
async function authorizeExceptionAccess(entityId: string) {
  const user = await requireAuth()
  if (roleHasPermission(user.role, 'articles.review')) return user
  const article = await db.article.findUnique({ where: { id: entityId }, select: { id: true, authorId: true } })
  if (article && article.authorId === user.id) return user
  throw new ApiError(403, 'برای این عملیات باید بازبینی‌کننده باشید یا نویسندهِ همین مقاله.')
}

// ─── فهرست استثناها ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const entityId = searchParams.get('entityId')?.trim() || ''
    const entityType = searchParams.get('entityType') || 'ARTICLE'
    if (entityType !== 'ARTICLE') throw new ApiError(400, 'نوع موجودیت پشتیبانی‌شده «ARTICLE» است.')

    if (!entityId) {
      // فهرست کامل استثناها فقط برای بازبینی‌کننده‌ها
      await requirePermission('articles.review')
      const items = await db.glossaryException.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          term: { select: { id: true, term: true, preferred: true, severity: true, type: true } },
        },
      })
      return ok({ items })
    }

    await authorizeExceptionAccess(entityId)
    const items = await db.glossaryException.findMany({
      where: { entityType: 'ARTICLE', entityId },
      orderBy: { createdAt: 'desc' },
      include: {
        term: { select: { id: true, term: true, preferred: true, severity: true, type: true } },
      },
    })
    return ok({ items })
  } catch (err) {
    return handleApiError(err)
  }
}

interface ExceptionBody {
  termId?: unknown
  entityType?: unknown
  entityId?: unknown
  field?: unknown
  reason?: unknown
}

// ─── ثبت/به‌روزرسانی استثنا (با دلیل الزامی) ─────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await parseBody<ExceptionBody>(req)

    const termId = vString(body.termId, 'شناسه قاعده', { required: true, max: 60 })
    const entityId = vString(body.entityId, 'شناسه محتوا', { required: true, max: 60 })
    const entityType = vEnum(body.entityType, ENTITY_TYPES, 'نوع موجودیت', 'ARTICLE')
    const field = vEnum(body.field, FIELDS, 'فیلد محتوا')
    const reason = vString(body.reason, 'دلیل نادیده گرفتن', { required: true, min: 5, max: 500 })

    const user = await authorizeExceptionAccess(entityId)

    const term = await db.glossaryTerm.findUnique({ where: { id: termId } })
    if (!term) throw new ApiError(404, 'قاعده واژه‌نامه یافت نشد.')

    const article = await db.article.findUnique({ where: { id: entityId }, select: { id: true, title: true } })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    // ثبت یکتا برای هر (قاعده × محتوا × فیلد)؛ در صورت وجود، دلیل و مسئول به‌روزرسانی می‌شود
    const exception = await db.glossaryException.upsert({
      where: { termId_entityId_field: { termId, entityId, field } },
      update: { reason, ignoredById: user.id, ignoredByName: user.name },
      create: {
        termId,
        entityType,
        entityId,
        field,
        reason,
        ignoredById: user.id,
        ignoredByName: user.name,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'GLOSSARY_IGNORE',
      entityType: 'ARTICLE',
      entityId,
      entityTitle: article.title,
      details: `نادیده گرفتن «${term.term}» در ${GLOSSARY_FIELD_LABELS[field]} — دلیل: ${reason}`,
    })

    return ok(exception, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}

// ─── حذف استثنا (بازگرداندن هشدار) ───────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')?.trim() || ''
    if (!id) throw new ApiError(400, 'شناسه استثنا الزامی است.')

    const user = await requireAuth()
    const exception = await db.glossaryException.findUnique({
      where: { id },
      include: { term: { select: { term: true } } },
    })
    if (!exception) throw new ApiError(404, 'مورد نادیده‌گرفته‌شده یافت نشد.')

    const allowed = roleHasPermission(user.role, 'articles.review') || exception.ignoredById === user.id
    if (!allowed) throw new ApiError(403, 'شما مجوز حذف این استثنا را ندارید.')

    await db.glossaryException.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'GLOSSARY_RESTORE',
      entityType: exception.entityType,
      entityId: exception.entityId,
      details: `حذف استثنای «${exception.term.term}» در ${GLOSSARY_FIELD_LABELS[exception.field as GlossaryFieldType] ?? exception.field}؛ هشدار مجدداً فعال می‌شود`,
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
