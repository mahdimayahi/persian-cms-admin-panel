/**
 * پشتیبانی تشخیصی
 * GET  /api/support — فهرست گزارش‌ها (مجوز users.manage)
 * POST /api/support — ثبت گزارش مشکل با شناسه قابل‌ردگیری (همه کاربران)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, handleApiError, requireAuth, requirePermission, parseBody, vString, vEnum, getPaginationParams } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

/** ساخت کد قابل‌ردگیری مانند SUP-4821 */
function makeTicketCode(): string {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `SUP-${n}`
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('users.manage')
    const { searchParams } = new URL(req.url)
    const { page, pageSize, skip, take } = getPaginationParams(searchParams)
    const statusParam = searchParams.get('status') || ''
    const status = ['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(statusParam) ? statusParam : undefined

    const [items, total] = await Promise.all([
      db.supportTicket.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      db.supportTicket.count({ where: status ? { status } : undefined }),
    ])

    return ok({ items, total, page, pageSize })
  } catch (err) {
    return handleApiError(err)
  }
}

interface SupportBody {
  page?: unknown
  steps?: unknown
  errorInfo?: unknown
  userAgent?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<SupportBody>(req)

    const page = body.page ? vString(body.page, 'صفحه', { max: 200 }) : ''
    const steps = vString(body.steps, 'شرح مشکل', { required: true, min: 10, max: 3000 })
    const errorInfo = body.errorInfo ? vString(body.errorInfo, 'اطلاعات خطا', { max: 1000 }) : ''
    const userAgent = body.userAgent ? vString(body.userAgent, 'مرورگر', { max: 300 }) : ''

    const ticket = await db.supportTicket.create({
      data: {
        code: makeTicketCode(),
        userName: user.name,
        userEmail: user.email,
        page,
        steps,
        errorInfo,
        userAgent,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'SUPPORT_TICKET',
      entityId: ticket.id,
      entityTitle: ticket.code,
      details: `گزارش مشکل از صفحه ${page || 'نامشخص'}`,
    })

    return ok({ code: ticket.code, id: ticket.id }, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
