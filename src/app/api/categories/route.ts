/**
 * API دسته‌بندی‌ها
 * GET  /api/categories — فهرست همه دسته‌بندی‌ها (بدون صفحه‌بندی)
 * POST /api/categories — ایجاد دسته‌بندی جدید
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
    const categories = await db.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { articles: true } } },
    })
    return ok(categories)
  } catch (err) {
    return handleApiError(err)
  }
}

/** اعتبارسنجی رنگ اختیاری (قالب هگز) */
function validateColor(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const color = vString(raw, 'رنگ', { max: 20 })
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    throw new ApiError(400, 'قالب رنگ معتبر نیست (نمونه صحیح: #64748b).')
  }
  return color
}

interface CategoryBody {
  name?: unknown
  description?: unknown
  color?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('categories.manage')
    const body = await parseBody<CategoryBody>(req)

    const name = vString(body.name, 'نام دسته‌بندی', { required: true, max: 100 })

    // بررسی یکتایی نام بدون حساسیت به حروف بزرگ/کوچک
    const all = await db.category.findMany({ select: { id: true, name: true } })
    if (all.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new ApiError(409, 'دسته‌بندی‌ای با این نام وجود دارد.')
    }

    // ساخت slug یکتا با پسوند شمارنده در صورت تکراری بودن
    const base = slugify(name)
    let slug = base
    let counter = 1
    for (;;) {
      const taken = await db.category.findUnique({ where: { slug }, select: { id: true } })
      if (!taken) break
      slug = `${base}-${counter++}`
    }

    const description =
      body.description === undefined || body.description === null ? null : vString(body.description, 'توضیح', { max: 500 })
    const color = validateColor(body.color)

    const category = await db.category.create({
      data: { name, slug, description, ...(color ? { color } : {}) },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'CATEGORY',
      entityId: category.id,
      entityTitle: name,
      details: 'ایجاد دسته‌بندی جدید',
    })

    return ok({ ...category, _count: { articles: 0 } })
  } catch (err) {
    return handleApiError(err)
  }
}
