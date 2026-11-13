/**
 * ساخت محتوای جدید از الگو (کپی امن)
 * POST /api/templates/create-content — بدنه: { templateId } (مجوز articles.create)
 *
 * قواعد کپی امن:
 * - خروجی همیشه یک مقاله مستقل با وضعیت «پیش‌نویس» است؛ بدون تاریخ انتشار و بدون یادداشت بازبینی.
 * - متن‌های راهنمای الگو به‌صورت جای‌نگهدار منتقل می‌شوند و تا جایگزینی، انتشار را مسدود می‌کنند.
 * - آدرس صفحه (slug) از عنوان دوباره تعیین و در برابر مقالات/صفحات اعتبارسنجی می‌شود.
 * - برچسب‌ها فقط در صورت وجود هم‌نام متصل می‌شوند (چیزی ساخته نمی‌شود).
 * - هر محتوا الگو و نسخه‌ای را که از آن ساخته شده ثبت می‌کند؛ تغییر آتی الگو اثر پشتیبان ندارد.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, slugify } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

interface CreateContentBody {
  templateId?: unknown
}

/** تعیین آدرس یکتا از عنوان: در برابر مقالات و صفحات بررسی و در صورت تکرار با پسوند -۲ و -۳ ادامه می‌یابد */
async function deriveUniqueSlug(title: string): Promise<string> {
  const base = slugify(title)
  let slug = base
  let n = 2
  for (;;) {
    const [articleTaken, pageTaken] = await Promise.all([
      db.article.findUnique({ where: { slug }, select: { id: true } }),
      db.page.findUnique({ where: { slug }, select: { id: true } }),
    ])
    if (!articleTaken && !pageTaken) return slug
    slug = `${base}-${n}`
    n++
    if (n > 100) return `${base}-${Date.now()}` // گارد محافظتی در برابر حلقه بی‌نهایت
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.create')
    const body = await parseBody<CreateContentBody>(req)

    if (typeof body.templateId !== 'string' || body.templateId.trim() === '') {
      throw new ApiError(400, 'شناسه الگو الزامی است.')
    }
    const templateId = body.templateId.trim()

    const template = await db.contentTemplate.findUnique({ where: { id: templateId } })
    if (!template) throw new ApiError(404, 'الگو یافت نشد.')
    // الگوی غیرفعال برای ساخت محتوای جدید قابل انتخاب نیست؛ سابقه محتواهای قبلی حفظ می‌شود
    if (!template.isActive) {
      throw new ApiError(409, 'الگوی غیرفعال برای ساخت جدید قابل انتخاب نیست.')
    }

    const title = template.titleTemplate.trim()
    if (title.length < 3) throw new ApiError(400, 'عنوان الگو برای ساخت محتوا کوتاه‌تر از حد مجاز است.')

    const slug = await deriveUniqueSlug(title)

    // برچسب‌ها: فقط اتصال برچسب‌های هم‌نام موجود؛ برچسب جدید ساخته نمی‌شود
    let existingTagIds: string[] = []
    try {
      const names: unknown = JSON.parse(template.tagNames || '[]')
      if (Array.isArray(names)) {
        const cleanNames = names.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
        if (cleanNames.length > 0) {
          const tags = await db.tag.findMany({ where: { name: { in: cleanNames } }, select: { id: true } })
          existingTagIds = tags.map((t) => t.id)
        }
      }
    } catch {
      existingTagIds = []
    }

    const created = await db.$transaction(async (tx) => {
      const article = await tx.article.create({
        data: {
          title,
          slug,
          excerpt: template.excerptTemplate,
          content: template.contentTemplate,
          status: 'DRAFT', // خروجی همیشه پیش‌نویس مستقل است
          categoryId: template.categoryId, // کپی دسته‌بندی از الگو (در صورت تعیین)
          authorId: user.id,
          sourceTemplateId: template.id, // ثبت الگوی مبدأ
          sourceTemplateVersion: template.version, // ثبت نسخه الگو در لحظه ساخت
          sourceTemplateName: template.name, // حتی پس از حذف/غیرفعال شدن الگو حفظ می‌شود
        },
        select: { id: true, title: true, slug: true },
      })
      if (existingTagIds.length > 0) {
        await tx.articleTag.createMany({
          data: existingTagIds.map((tagId) => ({ articleId: article.id, tagId })),
        })
      }
      return article
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'ARTICLE',
      entityId: created.id,
      entityTitle: created.title,
      details: `ساخت پیش‌نویس مستقل از الگوی «${template.name}» (نسخه ${template.version})`,
    })

    return ok(created, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
