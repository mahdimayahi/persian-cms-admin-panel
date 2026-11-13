/**
 * جایگزینی ارجاع‌های رسانه
 * POST /api/media/[id]/replace-references — بدنه { targetMediaId }
 * همهٔ مقالاتی که این فایل تصویر شاخص آن‌هاست به فایل مقصد منتقل می‌شوند (در یک تراکنش)
 * مصرف‌کننده: impact-dialog (بخش «راه اصلاح» برای BLOCKING رسانه)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

interface ReplaceBody {
  targetMediaId?: unknown
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()

    const source = await db.media.findUnique({ where: { id }, select: { id: true, originalName: true } })
    if (!source) throw new ApiError(404, 'فایل یافت نشد.')

    const body = await parseBody<ReplaceBody>(req)
    const targetMediaId = vString(body.targetMediaId, 'شناسه فایل مقصد', { required: true, max: 100 })

    if (targetMediaId === id) {
      throw new ApiError(400, 'فایل مقصد باید با فایل فعلی متفاوت باشد.')
    }

    const target = await db.media.findUnique({ where: { id: targetMediaId }, select: { id: true, originalName: true } })
    if (!target) throw new ApiError(404, 'فایل مقصد یافت نشد.')

    // انتقال همهٔ ارجاع‌های تصویر شاخص در یک تراکنش
    const moved = await db.$transaction((tx) =>
      tx.article.updateMany({ where: { coverImageId: id }, data: { coverImageId: targetMediaId } })
    )

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'REPLACE',
      entityType: 'MEDIA',
      entityId: id,
      entityTitle: source.originalName,
      details: `تصویر شاخص ${moved.count} مقاله به فایل دیگر منتقل شد`,
    })

    return ok({ moved: moved.count })
  } catch (err) {
    return handleApiError(err)
  }
}
