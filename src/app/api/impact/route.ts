/**
 * بررسی اثر تغییر قبل از حذف
 * GET /api/impact?type=category|tag|media|user&id=...
 * پاسخ: فهرست بخش‌های تحت تأثیر با تعداد و نمونه‌ها
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission } from '@/lib/api-utils'

type ImpactGroup = {
  label: string
  detail: string
  count: number
  items: { id: string; title: string }[]
}

const SAMPLE_SIZE = 5

export async function GET(req: NextRequest) {
  try {
    await requirePermission('articles.view')
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') ?? ''
    const id = searchParams.get('id') ?? ''

    if (!id) throw new ApiError(400, 'شناسه موجودیت الزامی است.')

    let name = ''
    let impacts: ImpactGroup[] = []

    if (type === 'category') {
      const category = await db.category.findUnique({ where: { id } })
      if (!category) throw new ApiError(404, 'دسته‌بندی یافت نشد.')
      name = category.name
      const articles = await db.article.findMany({
        where: { categoryId: id },
        select: { id: true, title: true },
        take: SAMPLE_SIZE,
      })
      const count = await db.article.count({ where: { categoryId: id } })
      if (count > 0) {
        impacts.push({
          label: 'مقالات این دسته',
          detail: `${count} مقاله بدون دسته‌بندی خواهند شد.`,
          count,
          items: articles,
        })
      }
    } else if (type === 'tag') {
      const tag = await db.tag.findUnique({ where: { id } })
      if (!tag) throw new ApiError(404, 'برچسب یافت نشد.')
      name = tag.name
      const rows = await db.articleTag.findMany({
        where: { tagId: id },
        select: { article: { select: { id: true, title: true } } },
        take: SAMPLE_SIZE,
      })
      const count = await db.articleTag.count({ where: { tagId: id } })
      if (count > 0) {
        impacts.push({
          label: 'مقالات دارای این برچسب',
          detail: `برچسب از ${count} مقاله حذف می‌شود.`,
          count,
          items: rows.map((r) => r.article),
        })
      }
    } else if (type === 'media') {
      const media = await db.media.findUnique({ where: { id }, select: { id: true, originalName: true } })
      if (!media) throw new ApiError(404, 'فایل یافت نشد.')
      name = media.originalName
      const usedAsCover = await db.article.findMany({
        where: { coverImageId: id },
        select: { id: true, title: true },
        take: SAMPLE_SIZE,
      })
      const coverCount = await db.article.count({ where: { coverImageId: id } })
      if (coverCount > 0) {
        impacts.push({
          label: 'استفاده به‌عنوان تصویر شاخص',
          detail: `تصویر شاخص ${coverCount} مقاله حذف می‌شود و آن مقاله‌ها بدون تصویر خواهند ماند.`,
          count: coverCount,
          items: usedAsCover,
        })
      }
    } else if (type === 'user') {
      const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true } })
      if (!target) throw new ApiError(404, 'کاربر یافت نشد.')
      name = target.name

      const [authoredCount, ownedCount, mediaCount, openTaskCount] = await Promise.all([
        db.article.count({ where: { authorId: id } }),
        db.article.count({ where: { ownerId: id } }),
        db.media.count({ where: { uploadedById: id } }),
        db.task.count({ where: { assignedToId: id, status: 'OPEN' } }),
      ])

      const authored = await db.article.findMany({
        where: { authorId: id },
        select: { id: true, title: true },
        take: SAMPLE_SIZE,
      })
      const owned = await db.article.findMany({
        where: { ownerId: id },
        select: { id: true, title: true },
        take: SAMPLE_SIZE,
      })

      if (authoredCount > 0) {
        impacts.push({
          label: 'مقالات نوشته‌شده توسط کاربر',
          detail: 'مالکیت محتوا بدون انتقال باقی می‌ماند؛ در صورت نیاز قبل از حذف، مالکیت را منتقل کنید.',
          count: authoredCount,
          items: authored,
        })
      }
      if (ownedCount > 0) {
        impacts.push({
          label: 'محتوایی که این کاربر مالک مسئول آن است',
          detail: 'این محتواها بدون مسئول صحت اطلاعات خواهند شد.',
          count: ownedCount,
          items: owned,
        })
      }
      if (mediaCount > 0) {
        impacts.push({
          label: 'فایل‌های بارگذاری‌شده',
          detail: `${mediaCount} فایل به این کاربر منتسب است.`,
          count: mediaCount,
          items: [],
        })
      }
      if (openTaskCount > 0) {
        impacts.push({
          label: 'کارهای باز واگذارشده به این کاربر',
          detail: `${openTaskCount} کار باز بدون مسئول می‌ماند.`,
          count: openTaskCount,
          items: [],
        })
      }
    } else {
      throw new ApiError(400, 'نوع موجودیت پشتیبانی نمی‌شود.')
    }

    return ok({ type, name, impacts, total: impacts.reduce((s, i) => s + i.count, 0) })
  } catch (err) {
    return handleApiError(err)
  }
}
