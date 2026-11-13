/**
 * جستجوی سراسری پنل مدیریت
 * GET /api/search?q=...
 * - عبارت کمتر از ۲ نویسه → گروه‌های خالی
 * - حداکثر ۵ نتیجه در هر گروه؛ نتایج کاربران فقط با مجوز users.view
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth } from '@/lib/api-utils'
import { roleHasPermission } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() || ''

    // عبارت خیلی کوتاه: گروه‌های خالی
    if (q.length < 2) {
      return ok({ articles: [], pages: [], media: [], users: [] })
    }

    const canViewUsers = roleHasPermission(user.role, 'users.view')

    const [articles, pages, media, users] = await Promise.all([
      db.article.findMany({
        where: { title: { contains: q } },
        take: 5,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, status: true },
      }),
      db.page.findMany({
        where: { title: { contains: q } },
        take: 5,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, status: true },
      }),
      db.media.findMany({
        where: { originalName: { contains: q } },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, originalName: true, mimeType: true },
      }),
      canViewUsers
        ? db.user.findMany({
            where: { OR: [{ name: { contains: q } }, { email: { contains: q } }] },
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, email: true, role: true },
          })
        : Promise.resolve([]),
    ])

    return ok({ articles, pages, media, users })
  } catch (err) {
    return handleApiError(err)
  }
}
