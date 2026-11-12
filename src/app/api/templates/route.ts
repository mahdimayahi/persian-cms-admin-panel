/**
 * الگوهای آماده محتوا
 * GET  /api/templates — فهرست الگوها
 * POST /api/templates — ایجاد الگو (مجوز articles.review)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET() {
  try {
    await requirePermission('articles.view')
    const items = await db.contentTemplate.findMany({
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
    })
    return ok({ items })
  } catch (err) {
    return handleApiError(err)
  }
}

interface TemplateBody {
  name?: unknown
  description?: unknown
  type?: unknown
  titleTemplate?: unknown
  excerptTemplate?: unknown
  contentTemplate?: unknown
  tagNames?: unknown
  categoryId?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.review')
    const body = await parseBody<TemplateBody>(req)

    const name = vString(body.name, 'نام الگو', { required: true, min: 3, max: 120 })
    const description = body.description ? vString(body.description, 'توضیح', { max: 300 }) : ''
    const type = vEnum<'ARTICLE' | 'LANDING'>(body.type, ['ARTICLE', 'LANDING'] as const, 'نوع الگو', 'ARTICLE')
    const titleTemplate = vString(body.titleTemplate, 'عنوان الگو', { required: true, min: 3, max: 200 })
    const excerptTemplate = body.excerptTemplate ? vString(body.excerptTemplate, 'خلاصه الگو', { max: 500 }) : ''
    const contentTemplate = vString(body.contentTemplate, 'محتوای الگو', { required: true, min: 10, max: 20000 })

    let categoryId: string | null = null
    if (body.categoryId && typeof body.categoryId === 'string' && body.categoryId.trim() !== '') {
      const cat = await db.category.findUnique({ where: { id: body.categoryId.trim() }, select: { id: true } })
      if (!cat) throw new ApiError(400, 'دسته‌بندی انتخاب‌شده معتبر نیست.')
      categoryId = cat.id
    }

    let tagNamesJson = '[]'
    if (Array.isArray(body.tagNames)) {
      const names = body.tagNames.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, 10)
      tagNamesJson = JSON.stringify(names)
    }

    const template = await db.contentTemplate.create({
      data: {
        name,
        description,
        type,
        titleTemplate,
        excerptTemplate,
        contentTemplate,
        tagNames: tagNamesJson,
        categoryId,
        isSystem: false,
        createdById: user.id,
        createdByName: user.name,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'CONTENT_TEMPLATE',
      entityId: template.id,
      entityTitle: name,
      details: 'ایجاد الگوی محتوا',
    })

    return ok(template, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
