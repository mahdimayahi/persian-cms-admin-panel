/**
 * گزارش CSV یک عملیات — بدون داده حساس
 * GET /api/operations/[id]/report → پاسخ text/csv با BOM (\uFEFF) برای سازگاری اکسل فارسی
 * ستون‌ها: مورد، شناسه، وضعیت، پیام — از OperationItemها؛ عملیات قدیمی بدون آیتم → ردیف‌های errorsJson
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, requireAuth } from '@/lib/api-utils'
import { sweepStaleOperations } from '@/lib/operations'

/** برچسب فارسی وضعیت آیتم برای گزارش */
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار',
  SUCCEEDED: 'موفق',
  FAILED: 'ناموفق',
  SKIPPED: 'ردشده',
  CANCELLED: 'لغوشده',
}

/** گری‌کردن سلول CSV (کاما / کوتیشن / خط جدید) */
function csvCell(value: string): string {
  if (/["\n,]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await requireAuth()
    await sweepStaleOperations()

    const operation = await db.operationLog.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    })
    if (!operation) throw new ApiError(404, 'عملیات یافت نشد.')

    type ReportRow = { item: string; ref: string; status: string; message: string }

    const rows: ReportRow[] = operation.items.length
      ? operation.items.map((it) => ({
          item: it.label,
          ref: it.refId,
          status: STATUS_LABELS[it.status] ?? it.status,
          message: it.message ?? '',
        }))
      : (JSON.parse(operation.errorsJson || '[]') as { item: string; reason: string }[]).map((e) => ({
          item: e.item,
          ref: '',
          status: 'ناموفق',
          message: e.reason,
        }))

    const header = 'مورد,شناسه,وضعیت,پیام'
    const lines = rows.map((r) => [r.item, r.ref, r.status, r.message].map(csvCell).join(','))
    const csv = '\uFEFF' + [header, ...lines].join('\n')

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="operation-${id}.csv"`,
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
