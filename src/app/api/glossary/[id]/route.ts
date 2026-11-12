/**
 * عملیات روی یک قاعده واژه‌نامه برند
 * PATCH  /api/glossary/[id] — ویرایش قاعده یا تغییر وضعیت فعال (مجوز articles.review)
 * DELETE /api/glossary/[id] — حذف قاعده به‌همراه استثناهای وابسته (مجوز articles.review)
 *
 * نکته: قاعده غیرفعال در بررسی‌ها اعمال نمی‌شود، اما سابقه و استثناهای آن حفظ می‌شود.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum, vBoolean } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

const TERM_TYPES = ['BRAND_TERM', 'BRAND_NAME', 'STYLE', 'CLARITY'] as const
const SEVERITIES = ['SUGGESTION', 'WARNING', 'ENFORCING'] as const
const SCOPES = ['ALL', 'TITLE', 'BODY', 'SEO'] as const
const LANGUAGES = ['FA', 'EN'] as const

/** تبدیل ورودی شکل‌های نامطلوب به فهرست تمیز و بدون تکرار */
function parseForms(value: unknown): string[] {
  let list: unknown[] = []
  if (Array.isArray(value)) {
    list = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    list = value.split(/[\n,،]+/)
  } else if (value === undefined || value === null || value === '') {
    return []
  } else {
    throw new ApiError(400, '«شکل‌های نامطلوب» باید فهرستی از متن باشد.')
  }
  const cleaned: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') throw new ApiError(400, '«شکل‌های نامطلوب» باید فهرستی از متن باشد.')
    const item = raw.trim()
    if (item === '') continue
    if (item.length > 80) throw new ApiError(400, 'هر شکل نامطلوب نباید بیش از ۸۰ نویسه باشد.')
    if (!cleaned.includes(item)) cleaned.push(item)
    if (cleaned.length >= 20) break
  }
  return cleaned
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.review')
    const existing = await db.glossaryTerm.findUnique({ where: { id } })
    if (!existing) throw new ApiError(404, 'قاعده واژه‌نامه یافت نشد.')

    const body = await parseBody<Record<string, unknown>>(req)
    const data: Record<string, unknown> = {}

    if (body.term !== undefined) {
      const term = vString(body.term, 'شکل نامطلوب', { required: true, min: 2, max: 80 })
      const dup = await db.glossaryTerm.findUnique({ where: { term } })
      if (dup && dup.id !== id) throw new ApiError(409, 'این واژه قبلاً ثبت شده است.')
      data.term = term
    }
    if (body.preferred !== undefined) data.preferred = vString(body.preferred, 'عبارت ترجیحی', { max: 120 })
    if (body.forms !== undefined) data.forms = JSON.stringify(parseForms(body.forms))
    if (body.type !== undefined) data.type = vEnum(body.type, TERM_TYPES, 'نوع قاعده')
    if (body.severity !== undefined) data.severity = vEnum(body.severity, SEVERITIES, 'شدت قاعده')
    if (body.scope !== undefined) data.scope = vEnum(body.scope, SCOPES, 'دامنه بررسی')
    if (body.language !== undefined) data.language = vEnum(body.language, LANGUAGES, 'زبان')
    if (body.explanation !== undefined) data.explanation = vString(body.explanation, 'توضیح علت هشدار', { max: 1000 })
    if (body.example !== undefined) data.example = vString(body.example, 'مثال کاربرد درست', { max: 1000 })
    if (body.note !== undefined) data.note = vString(body.note, 'یادداشت', { max: 500 })
    if (body.isActive !== undefined) data.isActive = vBoolean(body.isActive)

    if (Object.keys(data).length === 0) throw new ApiError(400, 'داده‌ای برای به‌روزرسانی ارسال نشده است.')

    const updated = await db.glossaryTerm.update({ where: { id }, data })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'GLOSSARY_TERM',
      entityId: id,
      entityTitle: updated.term,
      details: data.isActive !== undefined && Object.keys(data).length === 1
        ? `تغییر وضعیت قاعده به ${data.isActive ? 'فعال' : 'غیرفعال'}`
        : 'ویرایش قاعده واژه‌نامه',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

/** سازگاری با کلاینت‌های موجود: PUT همان رفتار PATCH را دارد */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return PATCH(req, ctx)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.review')
    const existing = await db.glossaryTerm.findUnique({ where: { id } })
    if (!existing) throw new ApiError(404, 'قاعده واژه‌نامه یافت نشد.')

    // استثناهای وابسته به‌صورت خودکار حذف می‌شوند (onDelete: Cascade)
    await db.glossaryTerm.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'GLOSSARY_TERM',
      entityId: id,
      entityTitle: existing.term,
      details: 'حذف قاعده از واژه‌نامه برند',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
