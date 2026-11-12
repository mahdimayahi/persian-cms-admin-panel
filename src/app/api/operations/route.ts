/**
 * مرکز عملیات
 * GET  /api/operations — فهرست عملیات (جدیدترین اول)
 * POST /api/operations — ثبت عملیات سمت کلاینت (مانند بارگذاری دسته‌ای رسانه)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth, parseBody, vString, vEnum, vInt } from '@/lib/api-utils'

export async function GET() {
  try {
    await requireAuth()
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

interface CreateOperationBody {
  type?: unknown
  title?: unknown
  status?: unknown
  totalItems?: unknown
  doneItems?: unknown
  failedItems?: unknown
  resultSummary?: unknown
  errors?: unknown
  relatedId?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<CreateOperationBody>(req)

    const type = vEnum<'MEDIA_UPLOAD' | 'CSV_EXPORT' | 'OTHER'>(
      body.type,
      ['MEDIA_UPLOAD', 'CSV_EXPORT', 'OTHER'] as const,
      'نوع عملیات',
      'OTHER'
    )
    const title = vString(body.title, 'عنوان عملیات', { required: true, min: 3, max: 200 })
    const status = vEnum<'SUCCESS' | 'PARTIAL' | 'FAILED' | 'RUNNING'>(
      body.status,
      ['SUCCESS', 'PARTIAL', 'FAILED', 'RUNNING'] as const,
      'وضعیت',
      'SUCCESS'
    )
    const totalItems = vInt(body.totalItems, 'تعداد کل', { min: 0 }) ?? 0
    const doneItems = vInt(body.doneItems, 'تعداد موفق', { min: 0 }) ?? 0
    const failedItems = vInt(body.failedItems, 'تعداد ناموفق', { min: 0 }) ?? 0
    const resultSummary = body.resultSummary ? vString(body.resultSummary, 'خلاصه نتیجه', { max: 300 }) : ''
    const relatedId = body.relatedId && typeof body.relatedId === 'string' ? body.relatedId : null

    let errorsJson = '[]'
    if (Array.isArray(body.errors)) {
      const safe = body.errors
        .filter((e): e is { item?: unknown; reason?: unknown } => typeof e === 'object' && e !== null)
        .slice(0, 100)
        .map((e) => ({
          item: typeof e.item === 'string' ? e.item.slice(0, 200) : '',
          reason: typeof e.reason === 'string' ? e.reason.slice(0, 300) : '',
        }))
      errorsJson = JSON.stringify(safe)
    }

    const op = await db.operationLog.create({
      data: {
        type,
        title,
        status,
        totalItems,
        doneItems,
        failedItems,
        initiatorId: user.id,
        initiatorName: user.name,
        resultSummary,
        errorsJson,
        relatedId,
        finishedAt: status === 'RUNNING' ? null : new Date(),
      },
    })

    return ok(op, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
