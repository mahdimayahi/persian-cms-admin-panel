/**
 * الگوهای آماده محتوا
 * GET  /api/templates — فهرست همه الگوها (شامل نسخه، وضعیت فعال و تعداد محتوای ساخته‌شده)
 * POST /api/templates — ایجاد الگو با نسخه ۱ و ثبت نسخه اولیه (مجوز articles.review)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

// ─── انواع ساختار الگو ────────────────────────────────────────────

type TemplateStructureKind = 'FIELD' | 'BLOCK'

interface TemplateStructureRow {
  key: string
  label: string
  kind: TemplateStructureKind
  required: boolean
  guide: string
}

/** تجزیه امن JSON ساختار الگو */
function parseStructure(json: string): TemplateStructureRow[] {
  if (!json.trim()) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is TemplateStructureRow =>
        !!r && typeof r === 'object' && typeof (r as TemplateStructureRow).label === 'string'
    )
  } catch {
    return []
  }
}

/** تجزیه امن JSON آرایه رشته‌ای (چک‌لیست/برچسب‌ها) */
function parseStringList(json: string): string[] {
  if (!json.trim()) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
  } catch {
    return []
  }
}

/**
 * اعتبارسنجی ساختار الگو: آرایه‌ای از فیلدها/بلوک‌ها با برچسب و نوع مشخص.
 * خروجی به‌صورت JSON ذخیره می‌شود.
 */
function validateStructure(raw: unknown): string {
  if (raw === undefined || raw === null) return '[]'
  if (!Array.isArray(raw)) throw new ApiError(400, '«ساختار الگو» باید آرایه‌ای از فیلدها و بلوک‌ها باشد.')
  if (raw.length > 30) throw new ApiError(400, 'ساختار الگو حداکثر می‌تواند ۳۰ فیلد یا بلوک داشته باشد.')

  const rows: TemplateStructureRow[] = raw.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(400, `سطر ${i + 1} ساختار الگو نامعتبر است.`)
    }
    const row = item as Record<string, unknown>
    const label = vString(row.label, `برچسب سطر ${i + 1} ساختار`, { required: true, min: 1, max: 120 })
    const kind = vEnum<TemplateStructureKind>(row.kind ?? 'FIELD', ['FIELD', 'BLOCK'] as const, `نوع سطر ${i + 1} ساختار`, 'FIELD')
    const key =
      typeof row.key === 'string' && row.key.trim() !== ''
        ? row.key.trim().slice(0, 60)
        : `item-${i + 1}`
    const required = row.required === true
    const guide = row.guide === undefined || row.guide === null ? '' : vString(row.guide, `راهنمای سطر ${i + 1} ساختار`, { max: 300 })
    return { key, label, kind, required, guide }
  })

  return JSON.stringify(rows)
}

/** اعتبارسنجی چک‌لیست تکمیل الگو: آرایه‌ای از رشته‌های متنی */
function validateChecklist(raw: unknown): string {
  if (raw === undefined || raw === null) return '[]'
  if (!Array.isArray(raw)) throw new ApiError(400, '«چک‌لیست تکمیل» باید آرایه‌ای از متن باشد.')
  const items = raw
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim())
  if (items.length > 20) throw new ApiError(400, 'چک‌لیست تکمیل حداکثر می‌تواند ۲۰ آیتم داشته باشد.')
  for (const item of items) {
    if (item.length > 200) throw new ApiError(400, 'هر آیتم چک‌لیست نباید بیش از ۲۰۰ نویسه باشد.')
  }
  return JSON.stringify(items)
}

/** اعتبارسنجی نام برچسب‌های پیشنهادی الگو (حداکثر ۱۰ مورد) */
function validateTagNames(raw: unknown): string {
  if (raw === undefined || raw === null) return '[]'
  if (!Array.isArray(raw)) throw new ApiError(400, '«برچسب‌ها» باید آرایه‌ای از متن باشد.')
  const names = raw
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim())
  if (names.length > 10) throw new ApiError(400, 'برچسب‌های الگو حداکثر می‌توانند ۱۰ مورد باشند.')
  for (const name of names) {
    if (name.length > 60) throw new ApiError(400, 'هر برچسب نباید بیش از ۶۰ نویسه باشد.')
  }
  return JSON.stringify(names)
}

/** اعتبارسنجی دسته‌بندی اختیاری الگو */
async function validateCategoryId(raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return null
  const cat = await db.category.findUnique({ where: { id: String(raw).trim() }, select: { id: true } })
  if (!cat) throw new ApiError(400, 'دسته‌بندی انتخاب‌شده معتبر نیست.')
  return cat.id
}

interface TemplateCreateBody {
  name?: unknown
  description?: unknown
  type?: unknown
  titleTemplate?: unknown
  excerptTemplate?: unknown
  contentTemplate?: unknown
  structure?: unknown
  guideText?: unknown
  checklist?: unknown
  tagNames?: unknown
  categoryId?: unknown
}

export async function GET() {
  try {
    await requirePermission('articles.view')
    const items = await db.contentTemplate.findMany({
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { articles: true } } },
    })
    // ساختار/چک‌لیست/برچسب‌ها در پاسخ به‌صورت تجزیه‌شده هم برگردانده می‌شوند
    return ok({
      items: items.map((t) => ({
        ...t,
        parsedStructure: parseStructure(t.structure),
        parsedChecklist: parseStringList(t.checklist),
        parsedTagNames: parseStringList(t.tagNames),
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.review')
    const body = await parseBody<TemplateCreateBody>(req)

    const name = vString(body.name, 'نام الگو', { required: true, min: 3, max: 120 })
    const description = body.description ? vString(body.description, 'توضیح', { max: 300 }) : ''
    const type = vEnum<'ARTICLE' | 'LANDING'>(body.type, ['ARTICLE', 'LANDING'] as const, 'نوع الگو', 'ARTICLE')
    const titleTemplate = vString(body.titleTemplate, 'عنوان الگو', { required: true, min: 3, max: 200 })
    const excerptTemplate = body.excerptTemplate ? vString(body.excerptTemplate, 'خلاصه الگو', { max: 500 }) : ''
    const contentTemplate = vString(body.contentTemplate, 'محتوای الگو', { required: true, min: 10, max: 20000 })
    const structure = validateStructure(body.structure)
    const guideText = body.guideText ? vString(body.guideText, 'متن راهنما', { max: 5000 }) : ''
    const checklist = validateChecklist(body.checklist)
    const tagNames = validateTagNames(body.tagNames)
    const categoryId = await validateCategoryId(body.categoryId)

    // ایجاد الگو با نسخه ۱ و ثبت هم‌زمان نسخه اولیه در سابقه نسخه‌ها
    const template = await db.$transaction(async (tx) => {
      const created = await tx.contentTemplate.create({
        data: {
          name,
          description,
          type,
          titleTemplate,
          excerptTemplate,
          contentTemplate,
          structure,
          guideText,
          checklist,
          tagNames,
          categoryId,
          version: 1,
          isSystem: false,
          createdById: user.id,
          createdByName: user.name,
        },
      })
      await tx.templateVersion.create({
        data: {
          templateId: created.id,
          version: 1,
          name,
          description,
          type,
          structure,
          titleTemplate,
          excerptTemplate,
          contentTemplate,
          guideText,
          checklist,
          tagNames,
          categoryId,
          changeNote: 'نسخه اولیه',
          createdByName: user.name,
        },
      })
      return created
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'CONTENT_TEMPLATE',
      entityId: template.id,
      entityTitle: name,
      details: 'ایجاد الگوی محتوا (نسخه ۱)',
    })

    return ok(
      {
        ...template,
        parsedStructure: parseStructure(template.structure),
        parsedChecklist: parseStringList(template.checklist),
        parsedTagNames: parseStringList(template.tagNames),
      },
      { status: 201 }
    )
  } catch (err) {
    return handleApiError(err)
  }
}
