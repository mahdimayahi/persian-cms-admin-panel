/**
 * API دسته‌بندی مشخص
 * PUT    /api/categories/[id] — ویرایش دسته‌بندی
 * DELETE /api/categories/[id] — حذف دسته‌بندی (مقالات بدون دسته‌بندی می‌شوند: onDelete SetNull)
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, slugify } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('categories.manage')
    const category = await db.category.findUnique({ where: { id } })
    if (!category) throw new ApiError(404, 'دسته‌بندی یافت نشد.')

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
