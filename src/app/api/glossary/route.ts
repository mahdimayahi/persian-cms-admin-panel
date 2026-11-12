/**
 * واژه‌نامه برند — فهرست و ایجاد قواعد
 * GET  /api/glossary — فهرست همه قواعد (مجوز articles.view)
 * POST /api/glossary — ایجاد قاعده جدید (مجوز articles.review)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

const TERM_TYPES = ['BRAND_TERM', 'BRAND_NAME', 'STYLE', 'CLARITY'] as const
const SEVERITIES = ['SUGGESTION', 'WARNING', 'ENFORCING'] as const
const SCOPES = ['ALL', 'TITLE', 'BODY', 'SEO'] as const
const LANGUAGES = ['FA', 'EN'] as const

const MAX_FORMS = 20

/** تبدیل ورودی شکل‌های نامطلوب به فهرست تمیز و بدون تکرار */
function parseForms(value: unknown): string[] {
  let list: unknown[] = []
  if (Array.isArray(value)) {
    list = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    // سازگاری: رشته با جداکننده خط جدید یا ویرگول
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
    if (cleaned.length >= MAX_FORMS) break
  }
  return cleaned
}

export async function GET() {
  try {
    await requirePermission('articles.view')
    const terms = await db.glossaryTerm.findMany({
      orderBy: [{ isActive: 'desc' }, { term: 'asc' }],
      include: { _count: { select: { exceptions: true } } },
    })
    const items = terms.map((t) => ({ ...t, exceptionsCount: t._count.exceptions }))
    return ok({ items })
  } catch (err) {
    return handleApiError(err)
  }
}

interface GlossaryBody {
  term?: unknown
  preferred?: unknown
  forms?: unknown
  type?: unknown
  severity?: unknown
  scope?: unknown
  language?: unknown
  explanation?: unknown
  example?: unknown
  note?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.review')
    const body = await parseBody<GlossaryBody>(req)

    const term = vString(body.term, 'شکل نامطلوب', { required: true, min: 2, max: 80 })
    const preferred = vString(body.preferred, 'عبارت ترجیحی', { max: 120 })
    const forms = parseForms(body.forms)
    const type = vEnum(body.type, TERM_TYPES, 'نوع قاعده', 'STYLE')
    const severity = vEnum(body.severity, SEVERITIES, 'شدت قاعده', 'SUGGESTION')
    const scope = vEnum(body.scope, SCOPES, 'دامنه بررسی', 'ALL')
    const language = vEnum(body.language, LANGUAGES, 'زبان', 'FA')
    const explanation = vString(body.explanation, 'توضیح علت هشدار', { max: 1000 })
    const example = vString(body.example, 'مثال کاربرد درست', { max: 1000 })
    const note = vString(body.note, 'یادداشت', { max: 500 })

    const exists = await db.glossaryTerm.findUnique({ where: { term } })
    if (exists) throw new ApiError(409, 'این واژه قبلاً در واژه‌نامه ثبت شده است.')

    const item = await db.glossaryTerm.create({
      data: {
        term,
        preferred,
        forms: JSON.stringify(forms),
        type,
        severity,
        scope,
        language,
        explanation,
        example,
        note,
        createdById: user.id,
        createdByName: user.name,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'GLOSSARY_TERM',
      entityId: item.id,
      entityTitle: term,
      details: `افزودن قاعده واژه‌نامه (نوع: ${type}، شدت: ${severity})`,
    })

    return ok(item, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
