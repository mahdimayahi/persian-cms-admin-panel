/**
 * API برچسب‌ها
 * GET  /api/tags — فهرست همه برچسب‌ها (بدون صفحه‌بندی)
 * POST /api/tags — ایجاد برچسب جدید
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ApiError,
  ok,
  handleApiError,
  requireAuth,
  requirePermission,
  parseBody,
  vString,
  slugify,
} from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function GET() {
  try {
    await requireAuth()
    const tags = await db.tag.findMany({
      where: { mergedIntoId: null }, // حذف رکوردهای ادغام‌شده از فهرست انتخاب
      orderBy: { name: 'asc' },
      include: { _count: { select: { articles: true } } },
    })
    return ok(tags)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('tags.manage')
    const body = await parseBody<{ name?: unknown }>(req)

    const name = vString(body.name, 'نام برچسب', { required: true, max: 60 })

    // بررسی یکتایی نام بدون حساسیت به حروف بزرگ/کوچک
    const all = await db.tag.findMany({ select: { id: true, name: true } })
    if (all.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new ApiError(409, 'برچسبی با این نام وجود دارد.')
    }

    // ساخت slug یکتا با پسوند شمارنده در صورت تکراری بودن
    const base = slugify(name)
    let slug = base
    let counter = 1
    for (;;) {
      const taken = await db.tag.findUnique({ where: { slug }, select: { id: true } })
      if (!taken) break
      slug = `${base}-${counter++}`
    }

    const tag = await db.tag.create({ data: { name, slug } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'TAG',
      entityId: tag.id,
      entityTitle: name,
      details: 'ایجاد برچسب جدید',
    })

    return ok({ ...tag, _count: { articles: 0 } })
  } catch (err) {
    return handleApiError(err)
  }
}
