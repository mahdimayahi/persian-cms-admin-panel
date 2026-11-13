/**
 * عملیات روی یک گزارش پشتیبانی
 * GET   /api/support/[id] — مشاهدهٔ کامل گزارش (فقط مالک یا کاربر دارای مجوز users.manage)
 *         + اتصال به مرکز عملیات برای مدیران + ثبت حسابرسیِ مشاهدهٔ پشتیبان
 * PATCH /api/support/[id] — تغییر وضعیت/یادداشت (مجوز users.manage) با ثبت در تاریخچهٔ فعالیت
 *
 * وضعیت‌های پنج‌گانه: NEW | IN_PROGRESS | NEED_INFO | RESOLVED | CLOSED
 * وضعیت‌های قدیمی پایگاه‌داده (مانند OPEN) به‌صورت سازگار نرمال می‌شوند.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { roleHasPermission } from '@/lib/permissions'
import { logActivity } from '@/lib/audit'

const STATUSES = ['NEW', 'IN_PROGRESS', 'NEED_INFO', 'RESOLVED', 'CLOSED'] as const
type TicketStatus = (typeof STATUSES)[number]

/** برچسب فارسی وضعیت‌ها برای پیام‌های تاریخچهٔ فعالیت */
const STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: 'دریافت‌شده',
  IN_PROGRESS: 'در حال بررسی',
  NEED_INFO: 'نیازمند اطلاعات بیشتر',
  RESOLVED: 'حل‌شده',
  CLOSED: 'بسته‌شده',
}

/** وضعیت‌های پیش از حل‌شدن — بازگشت به آن‌ها اطلاعات حل‌شدن را پاک می‌کند (CLOSED حفظ می‌کند) */
const BEFORE_RESOLVED: TicketStatus[] = ['NEW', 'IN_PROGRESS', 'NEED_INFO']

/** نرمال‌سازی وضعیت‌های قدیمی برای جایگزینی امن (OPEN→NEW) */
function normalizeStatus(status: string): TicketStatus {
  const mapped = status === 'OPEN' ? 'NEW' : status
  return ((STATUSES as readonly string[]).includes(mapped) ? mapped : 'NEW') as TicketStatus
}

/** نگاشت وضعیت قدیمی برای نمایش (OPEN→NEW؛ وضعیت ذخیره‌شده تغییر نمی‌کند) */
function toUiStatus(status: string): string {
  return status === 'OPEN' ? 'NEW' : status
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAuth()

    const ticket = await db.supportTicket.findUnique({ where: { id } })
    if (!ticket) throw new ApiError(404, 'گزارش یافت نشد.')

    const isOwner = ticket.userId !== null && ticket.userId === user.id
    const isManager = roleHasPermission(user.role, 'users.manage')
    if (!isOwner && !isManager) {
      throw new ApiError(403, 'دسترسی به این گزارش مجاز نیست.')
    }

    // الزام حسابرسی: مشاهدهٔ گزارش توسط پشتیبان (غیر مالک) ثبت می‌شود
    if (!isOwner) {
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'VIEW',
        entityType: 'SUPPORT_TICKET',
        entityId: ticket.id,
        entityTitle: ticket.code,
        details: 'مشاهدهٔ گزارش و اطلاعات تشخیصی',
      })
    }

    // اتصال به مرکز عملیات — فقط برای مدیران و بدون آیتم‌های خام عملیات
    let operation: {
      id: string
      type: string
      status: string
      resultSummary: string
      createdAt: Date
      finishedAt: Date | null
    } | null = null
    if (ticket.operationId && isManager) {
      operation = await db.operationLog.findUnique({
        where: { id: ticket.operationId },
        select: { id: true, type: true, status: true, resultSummary: true, createdAt: true, finishedAt: true },
      })
    }

    // وضعیت‌های قدیمی برای نمایش نرمال می‌شوند (مقدار ذخیره‌شده در پایگاه‌داده دست‌نخورده می‌ماند)
    return ok({ ...ticket, status: toUiStatus(ticket.status), operation })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('users.manage')

    const ticket = await db.supportTicket.findUnique({ where: { id } })
    if (!ticket) throw new ApiError(404, 'گزارش یافت نشد.')

    const body = await parseBody<{ status?: unknown; note?: unknown }>(req)

    // وضعیت فعلی نرمال می‌شود تا ردیف‌های قدیمی (مانند OPEN) هم به‌درستی جایگزین شوند
    const currentStatus = normalizeStatus(ticket.status)
    const status = vEnum<TicketStatus>(body.status, STATUSES, 'وضعیت', currentStatus)

    // یادداشت اختیاری است؛ ارسال رشتهٔ خالی یعنی پاک کردن یادداشت قبلی
    const note = body.note === undefined ? (ticket.note ?? null) : vString(body.note, 'یادداشت', { max: 1000 }) || null

    // اطلاعات حل‌شدن: هنگام RESOLVED ثبت می‌شود؛ بازگشت به وضعیت‌های پیش از حل آن را پاک می‌کند
    const leavingResolved = BEFORE_RESOLVED.includes(status)
    const updated = await db.supportTicket.update({
      where: { id },
      data: {
        status,
        note,
        resolvedAt: status === 'RESOLVED' ? new Date() : leavingResolved ? null : ticket.resolvedAt,
        resolvedByName: status === 'RESOLVED' ? user.name : leavingResolved ? null : ticket.resolvedByName,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'SUPPORT_TICKET',
      entityId: id,
      entityTitle: ticket.code,
      details: `تغییر وضعیت گزارش ${ticket.code} به ${STATUS_LABELS[status]}`,
    })

    return ok(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
