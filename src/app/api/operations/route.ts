/**
 * مرکز عملیات
 * GET  /api/operations — پاک‌سازی عملیات سرگردان (sweep) + فهرست ۵۰ عملیات آخر (جدیدترین اول)
 * POST /api/operations — آغاز عملیات دسته‌ای مقالات (انتشار/لغو انتشار گروهی) → 202 { id, status: 'QUEUED' }
 * مجوز POST: articles.publish — اجرا نامتزامن است و نتیجه از GET جزئیات خوانده می‌شود
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, requirePermission, parseBody } from '@/lib/api-utils'
import { startBulkArticleOperation, sweepStaleOperations, type OperationType } from '@/lib/operations'

const OPERATION_TYPES = ['BULK_PUBLISH_ARTICLES', 'BULK_UNPUBLISH_ARTICLES'] as const

export async function GET() {
  try {
    await requireAuth()
    // پیش از هر خواندن، عملیات‌های RUNNING بدون ضربان قلب نهایی می‌شوند
    await sweepStaleOperations()

    const items = await db.operationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return ok({
      items: items.map((op) => ({
        ...op,
        errors: JSON.parse(op.errorsJson || '[]') as { item: string; reason: string }[],
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.publish')
    const body = await parseBody<{ type?: unknown; articleIds?: unknown }>(req)

    if (typeof body.type !== 'string' || !(OPERATION_TYPES as readonly string[]).includes(body.type)) {
      throw new ApiError(400, 'نوع عملیات نامعتبر است.')
    }

    if (!Array.isArray(body.articleIds)) {
      throw new ApiError(400, 'فهرست مقالات باید آرایه باشد.')
    }
    // حذف تکراری‌ها و مقادیر خالی
    const ids = Array.from(
      new Set(
        body.articleIds
          .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
          .map((v) => v.trim())
      )
    )
    if (ids.length === 0) throw new ApiError(400, 'فهرست مقالات خالی است.')
    if (ids.length > 100) throw new ApiError(400, 'حداکثر 100 مورد در هر عملیات مجاز است.')

    const id = await startBulkArticleOperation(body.type as OperationType, ids, {
      id: user.id,
      name: user.name,
    })

    return ok({ id, status: 'QUEUED' }, { status: 202 })
  } catch (err) {
    return handleApiError(err)
  }
}
