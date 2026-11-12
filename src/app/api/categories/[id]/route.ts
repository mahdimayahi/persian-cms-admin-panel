/**
 * API دسته‌بندی مشخص
 * PUT    /api/categories/[id] — ویرایش دسته‌بندی
 * DELETE /api/categories/[id] — حذف دسته‌بندی؛ اگر مقاله دارد با ۴۰۹ و گزارش اثر مسدود می‌شود
 *        استراتژی‌ها: ?strategy=TRANSFER&targetCategoryId=... (انتقال مقالات) یا ?strategy=DETACH (خروج از دسته)
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, slugify } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { computeImpact } from '@/lib/impact'

/** اعتبارسنجی رنگ اختیاری (قالب هگز) */
function validateColor(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const color = vString(raw, 'رنگ', { max: 20 })
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    throw new ApiError(400, 'قالب رنگ معتبر نیست (نمونه صحیح: #64748b).')
  }
  return color
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('categories.manage')
    const category = await db.category.findUnique({ where: { id } })
    if (!category) throw new ApiError(404, 'دسته‌بندی یافت نشد.')

    const body = await parseBody<{ name?: unknown; description?: unknown; color?: unknown }>(req)
    const data: Prisma.CategoryUncheckedUpdateInput = {}

    if (body.name !== undefined && body.name !== null) {
      const name = vString(body.name, 'نام دسته‌بندی', { required: true, max: 100 })

      // بررسی یکتایی نام بدون حساسیت به حروف بزرگ/کوچک (به‌استثنای خود رکورد)
      const all = await db.category.findMany({ select: { id: true, name: true } })
      if (all.some((c) => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase())) {
        throw new ApiError(409, 'دسته‌بندی‌ای با این نام وجود دارد.')
      }
      data.name = name

      // با تغییر نام، slug نیز بازتولید می‌شود
      if (name !== category.name) {
        const base = slugify(name)
        let slug = base
        let counter = 1
        for (;;) {
          const taken = await db.category.findUnique({ where: { slug }, select: { id: true } })
          if (!taken || taken.id === id) break
          slug = `${base}-${counter++}`
        }
        data.slug = slug
      }
    }

    if (body.description !== undefined) {
      data.description = body.description === null ? null : vString(body.description, 'توضیح', { max: 500 })
    }

    const color = validateColor(body.color)
    if (color !== undefined) data.color = color

    const updated = await db.category.update({
      where: { id },
      data,
      include: { _count: { select: { articles: true } } },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'CATEGORY',
      entityId: id,
      entityTitle: updated.name,
      details: 'ویرایش دسته‌بندی',
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('categories.manage')
    const category = await db.category.findUnique({ where: { id } })
    if (!category) throw new ApiError(404, 'دسته‌بندی یافت نشد.')

    const articleCount = await db.article.count({ where: { categoryId: id } })

    if (articleCount > 0) {
      const strategy = req.nextUrl.searchParams.get('strategy')

      // استراتژی انتقال: مقالات به دستهٔ دیگر منتقل و سپس دسته حذف می‌شود
      if (strategy === 'TRANSFER') {
        const targetCategoryId = req.nextUrl.searchParams.get('targetCategoryId')
        if (!targetCategoryId) {
          throw new ApiError(400, 'دستهٔ مقصد برای انتقال مقالات انتخاب نشده است.')
        }
        if (targetCategoryId === id) {
          throw new ApiError(400, 'دستهٔ مقصد باید با دستهٔ حذف‌شده متفاوت باشد.')
        }
        const target = await db.category.findUnique({ where: { id: targetCategoryId }, select: { id: true, name: true } })
        if (!target) throw new ApiError(400, 'دستهٔ مقصد معتبر نیست.')

        await db.$transaction([
          db.article.updateMany({ where: { categoryId: id }, data: { categoryId: target.id } }),
          db.category.delete({ where: { id } }),
        ])

        await logActivity({
          userId: user.id,
          userName: user.name,
          action: 'DELETE',
          entityType: 'CATEGORY',
          entityId: id,
          entityTitle: category.name,
          details: `حذف دسته‌بندی با انتقال ${articleCount} مقاله به دستهٔ «${target.name}»`,
        })

        return ok({ ok: true })
      }

      // استراتژی جداسازی: مقالات بدون دسته می‌شوند و سپس دسته حذف می‌شود
      if (strategy === 'DETACH') {
        await db.$transaction([
          db.article.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
          db.category.delete({ where: { id } }),
        ])

        await logActivity({
          userId: user.id,
          userName: user.name,
          action: 'DELETE',
          entityType: 'CATEGORY',
          entityId: id,
          entityTitle: category.name,
          details: `حذف دسته‌بندی و خروج ${articleCount} مقاله از دسته`,
        })

        return ok({ ok: true })
      }

      // بدون استراتژی معتبر → گزارش اثر و مسدودسازی حذف
      const impact = await computeImpact('category', id, { id: user.id, role: user.role })
      throw new ApiError(409, 'این دسته‌بندی مقاله دارد. ابتدا مقالات را منتقل کنید یا از دسته خارج کنید.', {
        blocking: true,
        impact,
      })
    }

    await db.category.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'CATEGORY',
      entityId: id,
      entityTitle: category.name,
      details: 'حذف دسته‌بندی',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
