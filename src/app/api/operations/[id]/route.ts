/**
 * جزئیات یک عملیات
 * GET /api/operations/[id] — عملیات + آیتم‌ها به ترتیب ایجاد (جدول نتیجهٔ تک‌تک موارد)
 * عملیات‌های RUNNING سرگردان پیش از خواندن نهایی می‌شوند (sweep)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth } from '@/lib/api-utils'
import { sweepStaleOperations } from '@/lib/operations'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireAuth()
    await sweepStaleOperations()

    const operation = await db.operationLog.findUnique({ where: { id } })
    if (!operation) throw new ApiError(404, 'عملیات یافت نشد.')

    const items = await db.operationItem.findMany({
      where: { operationId: id },
      orderBy: { createdAt: 'asc' },
    })

    return ok({
      operation: {
        ...operation,
        errors: JSON.parse(operation.errorsJson || '[]') as { item: string; reason: string }[],
      },
      items,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
