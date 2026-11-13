/**
 * پیش‌نمایش سایت عمومی
 * GET /api/site-preview — داده‌های «نمایش سایت»: تنظیمات، منو، مقالات منتشرشده و صفحات منتشرشده
 * هر کاربر واردشده به پنل مجاز به مشاهده است؛ فقط محتوای وضعیت PUBLISHED برگردانده می‌شود.
 */
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'

export async function GET() {
  try {
    await requireAuth()

    const [settingRows, menu, articles, pages] = await Promise.all([
      db.setting.findMany(),
      db.menuItem.findMany({ orderBy: { order: 'asc' } }),
      db.article.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          publishedAt: true,
          views: true,
          coverImageId: true,
          author: { select: { name: true } },
          category: { select: { name: true, slug: true } },
        },
      }),
      db.page.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: [{ order: 'asc' }, { updatedAt: 'desc' }],
        take: 12,
        select: { id: true, title: true, slug: true },
      }),
    ])

    const s: Record<string, string> = {}
    for (const row of settingRows) s[row.key] = row.value

    return ok({
      settings: {
        siteName: s.siteName?.trim() || 'سایت من',
        siteDescription: s.siteDescription?.trim() || '',
        contactEmail: s.contactEmail?.trim() || '',
        maintenanceMode: s.maintenanceMode === 'true',
      },
      menu: menu.map((m) => ({ id: m.id, label: m.label, url: m.url })),
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        excerpt: a.excerpt,
        publishedAt: a.publishedAt,
        views: a.views,
        coverImageId: a.coverImageId,
        authorName: a.author?.name ?? '',
        categoryName: a.category?.name ?? null,
        categorySlug: a.category?.slug ?? null,
      })),
      pages: pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
