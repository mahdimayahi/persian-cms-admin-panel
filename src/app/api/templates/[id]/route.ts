/**
 * عملیات روی یک الگوی محتوا
 * GET    /api/templates/[id] — جزئیات الگو + سابقه نسخه‌ها + تعداد محتوای ساخته‌شده
 * PATCH  /api/templates/[id] — ویرایش؛ تغییر فیلدهای اثرگذار نسخه جدید می‌سازد (مجوز articles.review)
 * POST   /api/templates/[id] — فعال/غیرفعال‌سازی با بدنه { action: 'ACTIVATE' | 'DEACTIVATE' } (بدون تغییر نسخه)
 * DELETE /api/templates/[id] — حذف؛ فقط اگر هیچ محتوایی از الگو ساخته نشده باشد
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

// ─── اعتبارسنجی فیلدهای JSON الگو ─────────────────────────────────

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

/** اعتبارسنجی ساختار الگو: آرایه‌ای از فیلدها/بلوک‌ها با برچسب و نوع مشخص */
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
      typeof row.key === 'string' && row.key.trim() !== '' ? row.key.trim().slice(0, 60) : `item-${i + 1}`
    const required = row.required === true
    const guide =
      row.guide === undefined || row.guide === null
        ? ''
        : vString(row.guide, `راهنمای سطر ${i + 1} ساختار`, { max: 300 })
    return { key, label, kind, required, guide }
  })

  return JSON.stringify(rows)
}

/** اعتبارسنجی چک‌لیست تکمیل الگو: آرایه‌ای از رشته‌های متنی */
function validateChecklist(raw: unknown): string {
  if (raw === undefined || raw === null) return '[]'
  if (!Array.isArray(raw)) throw new ApiError(400, '«چک‌لیست تکمیل» باید آرایه‌ای از متن باشد.')
  const items = raw.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
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
  const names = raw.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
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

/** فیلدهایی که تغییرشان اثر محتوایی دارد و نسخه جدید الگو می‌سازد */
const CONTENT_FIELDS = [
  'name',
  'description',
  'type',
  'structure',
  'titleTemplate',
  'excerptTemplate',
  'contentTemplate',
  'guideText',
  'checklist',
  'tagNames',
  'categoryId',
] as const

interface TemplatePatchBody {
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
  isActive?: unknown // فقط تغییر وضعیت — نسخه جدید نمی‌سازد
  changeNote?: unknown // شرح تغییر — با تغییر فیلدهای اثرگذار الزامی است
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('articles.view')
    const { id } = await params
    const template = await db.contentTemplate.findUnique({ where: { id } })
    if (!template) throw new ApiError(404, 'الگو یافت نشد.')

    const [versions, usedByCount] = await Promise.all([
      db.templateVersion.findMany({
        where: { templateId: id },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          name: true,
          type: true,
          changeNote: true,
          createdByName: true,
          createdAt: true,
        },
      }),
      db.article.count({ where: { sourceTemplateId: id } }),
    ])

    return ok({
      template: {
        ...template,
        parsedStructure: parseStructure(template.structure),
        parsedChecklist: parseStringList(template.checklist),
        parsedTagNames: parseStringList(template.tagNames),
      },
      versions,
      usedByCount,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.review')
    const template = await db.contentTemplate.findUnique({ where: { id } })
    if (!template) throw new ApiError(404, 'الگو یافت نشد.')
    if (template.isSystem && !roleHasPermission(user.role, 'settings.manage')) {
      throw new ApiError(403, 'الگوهای سیستمی فقط توسط مدیر کل قابل ویرایش هستند.')
    }

    const body = await parseBody<TemplatePatchBody>(req)

    // تغییر وضعیت فعال/غیرفعال نسخه جدید نمی‌سازد
    const data: Record<string, unknown> = {}
    if (body.isActive !== undefined) {
      data.isActive = body.isActive === true || body.isActive === 'true'
    }

    // آیا هیچ فیلد اثرگذار محتوایی در درخواست هست؟
    const hasContentChange = CONTENT_FIELDS.some((f) => body[f] !== undefined)

    let newVersion = template.version
    if (hasContentChange) {
      // شرح تغییر برای هر تغییر اثرگذار الزامی است (سابقه نسخه‌ها)
      const changeNote = vString(body.changeNote, 'شرح تغییر', { required: true, min: 3, max: 300 })

      if (body.name !== undefined) data.name = vString(body.name, 'نام الگو', { required: true, min: 3, max: 120 })
      if (body.description !== undefined) data.description = vString(body.description, 'توضیح', { max: 300 })
      if (body.type !== undefined) data.type = vEnum<'ARTICLE' | 'LANDING'>(body.type, ['ARTICLE', 'LANDING'] as const, 'نوع الگو')
      if (body.titleTemplate !== undefined)
        data.titleTemplate = vString(body.titleTemplate, 'عنوان الگو', { required: true, min: 3, max: 200 })
      if (body.excerptTemplate !== undefined)
        data.excerptTemplate = vString(body.excerptTemplate, 'خلاصه الگو', { max: 500 })
      if (body.contentTemplate !== undefined)
        data.contentTemplate = vString(body.contentTemplate, 'محتوای الگو', { required: true, min: 10, max: 20000 })
      if (body.structure !== undefined) data.structure = validateStructure(body.structure)
      if (body.guideText !== undefined) data.guideText = vString(body.guideText, 'متن راهنما', { max: 5000 })
      if (body.checklist !== undefined) data.checklist = validateChecklist(body.checklist)
      if (body.tagNames !== undefined) data.tagNames = validateTagNames(body.tagNames)
      if (body.categoryId !== undefined) data.categoryId = await validateCategoryId(body.categoryId)

      // ارتقای نسخه: نسخه جدید از «وضعیت جدید» پس از اعمال تغییرات ثبت می‌شود
      newVersion = template.version + 1
      data.version = newVersion

      const nextName = (data.name as string) ?? template.name
      const nextDescription = (data.description as string) ?? template.description
      const nextType = (data.type as string) ?? template.type
      const nextStructure = (data.structure as string) ?? template.structure
      const nextTitle = (data.titleTemplate as string) ?? template.titleTemplate
      const nextExcerpt = (data.excerptTemplate as string) ?? template.excerptTemplate
      const nextContent = (data.contentTemplate as string) ?? template.contentTemplate
      const nextGuide = (data.guideText as string) ?? template.guideText
      const nextChecklist = (data.checklist as string) ?? template.checklist
      const nextTagNames = (data.tagNames as string) ?? template.tagNames
      const nextCategoryId = data.categoryId !== undefined ? (data.categoryId as string | null) : template.categoryId

      const updated = await db.$transaction(async (tx) => {
        const row = await tx.contentTemplate.update({ where: { id }, data })
        await tx.templateVersion.create({
          data: {
            templateId: id,
            version: newVersion,
            name: nextName,
            description: nextDescription,
            type: nextType,
            structure: nextStructure,
            titleTemplate: nextTitle,
            excerptTemplate: nextExcerpt,
            contentTemplate: nextContent,
            guideText: nextGuide,
            checklist: nextChecklist,
            tagNames: nextTagNames,
            categoryId: nextCategoryId,
            changeNote,
            createdByName: user.name,
          },
        })
        return row
      })

      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'UPDATE',
        entityType: 'CONTENT_TEMPLATE',
        entityId: id,
        entityTitle: nextName,
        details: `ویرایش الگو — ثبت نسخه ${newVersion}: ${changeNote}`,
      })

      return ok({
        ...updated,
        parsedStructure: parseStructure(updated.structure),
        parsedChecklist: parseStringList(updated.checklist),
        parsedTagNames: parseStringList(updated.tagNames),
      })
    }

    // بدون تغییر اثرگذار: فقط وضعیت فعال/غیرفعال به‌روزرسانی می‌شود
    if (body.isActive === undefined) {
      throw new ApiError(400, 'هیچ تغییری برای ذخیره ارسال نشده است.')
    }

    const updated = await db.contentTemplate.update({ where: { id }, data })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: updated.isActive ? 'ACTIVATE' : 'DEACTIVATE',
      entityType: 'CONTENT_TEMPLATE',
      entityId: id,
      entityTitle: updated.name,
      details: updated.isActive ? 'الگو فعال شد' : 'الگو غیرفعال شد',
    })

    return ok({
      ...updated,
      parsedStructure: parseStructure(updated.structure),
      parsedChecklist: parseStringList(updated.checklist),
      parsedTagNames: parseStringList(updated.tagNames),
    })
  } catch (err) {
    return handleApiError(err)
  }
}

interface TemplateActionBody {
  action?: unknown
}

/** فعال/غیرفعال‌سازی الگو — بدون تغییر نسخه؛ سابقه نسخه‌ها و محتواهای ساخته‌شده حفظ می‌شود */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.review')
    const body = await parseBody<TemplateActionBody>(req)
    const action = vEnum<'ACTIVATE' | 'DEACTIVATE'>(body.action, ['ACTIVATE', 'DEACTIVATE'] as const, 'عملیات')

    const template = await db.contentTemplate.findUnique({ where: { id } })
    if (!template) throw new ApiError(404, 'الگو یافت نشد.')

    const updated = await db.contentTemplate.update({
      where: { id },
      data: { isActive: action === 'ACTIVATE' },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action,
      entityType: 'CONTENT_TEMPLATE',
      entityId: id,
      entityTitle: template.name,
      details: action === 'ACTIVATE' ? 'الگو فعال شد' : 'الگو غیرفعال شد (فقط برای ساخت محتوای جدید غیرقابل انتخاب)',
    })

    return ok({
      ...updated,
      parsedStructure: parseStructure(updated.structure),
      parsedChecklist: parseStringList(updated.checklist),
      parsedTagNames: parseStringList(updated.tagNames),
    })
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

    // الگوی در حال استفاده حذف نمی‌شود؛ سابقه محتواهای ساخته‌شده حفظ می‌شود
    const usedCount = await db.article.count({ where: { sourceTemplateId: id } })
    if (usedCount > 0) {
      throw new ApiError(409, 'الگو در حال استفاده است؛ فقط می‌توانید آن را غیرفعال کنید.')
    }

    await db.contentTemplate.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'CONTENT_TEMPLATE',
      entityId: id,
      entityTitle: template.name,
      details: `حذف الگوی محتوا (نسخه ${template.version})`,
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
