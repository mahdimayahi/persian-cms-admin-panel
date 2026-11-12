/**
 * پشتیبانی تشخیصی
 * GET  /api/support — فهرست گزارش‌ها برای پشتیبان (مجوز users.manage) با جستجو و فیلتر وضعیت
 * POST /api/support — ثبت گزارش مشکل (همهٔ کاربران واردشده) با پالایش داده‌های حساس،
 *                     اطلاعات تشخیصی سمت سرور و ادغام گزارش‌های تکراری
 *
 * سیاست نگهداری (Retention): گزارش‌های پشتیبانی پس از SUPPORT_RETENTION_DAYS روز
 * (۱۸۰ روز ≈ ۶ ماه) از تاریخ ثبت قابل پاک‌سازی دوره‌ای هستند. اجرای خودکار پاک‌سازی
 * فعلاً لازم نیست (بدون cron)؛ این ثابت مرجع سیاست برای پیاده‌سازی آیندهٔ حذف دوره‌ای است.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, requirePermission, parseBody, vString, getPaginationParams } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

/** مدت نگهداری گزارش‌های پشتیبانی (روز) — پس از این مدت قابل حذف دوره‌ای */
export const SUPPORT_RETENTION_DAYS = 180

/** وضعیت‌های مجاز فیلتر در فهرست مدیریتی */
const TICKET_STATUSES = ['NEW', 'IN_PROGRESS', 'NEED_INFO', 'RESOLVED', 'CLOSED'] as const

/** نسخهٔ برنامه — در اطلاعات تشخیصی هر گزارش ثبت می‌شود */
const APP_VERSION = '1.3.0'

/** حداکثر طول مجاز تصویر پیوست (طول رشتهٔ data URL بر حسب نویسه) */
const MAX_SCREENSHOT_LENGTH = 2_000_000

const MASKED = '[پالایش‌شده]'

/** الگوهای دادهٔ حساس که پیش از ذخیره پالایش می‌شوند */
const SENSITIVE_PATTERNS: RegExp[] = [
  /(password|passwd|pwd|رمز)\s*[:=]\s*\S+/gi,
  /(token|توکن|bearer|authorization|api[-_]?key)\s*[:=]\s*\S+/gi,
  /cookie\s*[:=][^\s;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // توکن‌های JWT
]

/** پالایش داده‌های حساس (رمز/توکن/کوکی/کلید خصوصی/JWT) پیش از ذخیره */
function filterSensitive(text: string): string {
  let out = text
  for (const re of SENSITIVE_PATTERNS) out = out.replace(re, MASKED)
  return out
}

/** پاک‌سازی مسیر صفحه: حذف query/hash و محدود به ۲۰۰ نویسه */
function sanitizePage(raw: string): string {
  let p = raw
  const q = p.indexOf('?')
  if (q !== -1) p = p.slice(0, q)
  const h = p.indexOf('#')
  if (h !== -1) p = p.slice(0, h)
  return p.slice(0, 200)
}

/** تشخیص سادهٔ مرورگر از User-Agent (ترتیب مهم است: Edge/Opera قبل از Chrome) */
function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\/|Opera/i.test(ua)) return 'Opera'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/Chrome\//i.test(ua)) return 'Chrome'
  if (/Safari\//i.test(ua)) return 'Safari'
  return 'نامشخص'
}

/** استخراج نخستین کد خطا از متن خطا (مانند ERR-1200، E42 یا 500) */
function extractErrorCode(text: string): string | null {
  const m = text.match(/\b(ERR|E|HTTP)[-_:]?\d{2,5}\b|\b\d{3}\b/)
  return m ? m[0] : null
}

/** نگاشت وضعیت‌های قدیمی به وضعیت‌های جدید برای نمایش (OPEN→NEW) */
function toUiStatus(status: string): string {
  return status === 'OPEN' ? 'NEW' : status
}

/** ساخت کد قابل‌ردگیری مانند SUP-4821 */
function makeTicketCode(): string {
  return `SUP-${Math.floor(1000 + Math.random() * 9000)}`
}

/** ساخت تیکت با تلاش مجدد تا ۵ بار هنگام برخورد یکتایی کد (P2002) */
async function createTicketWithRetry(data: Omit<Prisma.SupportTicketCreateInput, 'code'>) {
  let lastError: unknown = new Error('کد تیکت ساخته نشد.')
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.supportTicket.create({ data: { ...data, code: makeTicketCode() } })
    } catch (e) {
      lastError = e
      // فقط برخورد یکتایی کد تلاش مجدد می‌شود؛ بقیهٔ خطاها بالا پرتاب می‌شوند
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e
    }
  }
  throw lastError
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('users.manage')
    const { searchParams } = new URL(req.url)
    const { page, pageSize, skip, take } = getPaginationParams(searchParams)

    const q = searchParams.get('q')?.trim() || ''
    const statusParam = searchParams.get('status') || ''
    const status = (TICKET_STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined

    const where: Prisma.SupportTicketWhereInput = {}
    if (status) {
      // ردیف‌های قدیمی با وضعیت OPEN در فیلتر NEW هم دیده می‌شوند (رفتار سازگار با نگاشت نمایش)
      where.status = status === 'NEW' ? { in: ['NEW', 'OPEN'] } : status
    }
    if (q) {
      where.OR = [{ subject: { contains: q } }, { code: { contains: q } }, { userName: { contains: q } }]
    }

    const [items, total] = await Promise.all([
      db.supportTicket.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      db.supportTicket.count({ where }),
    ])

    return ok({
      items: items.map((t) => ({ ...t, status: toUiStatus(t.status) })),
      total,
      page,
      pageSize,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

interface SupportBody {
  subject?: unknown
  expectation?: unknown
  actual?: unknown
  steps?: unknown
  page?: unknown
  section?: unknown
  errorInfo?: unknown
  operationId?: unknown
  screenshot?: unknown
  userAgent?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<SupportBody>(req)

    // ── اعتبارسنجی فیلدهای متنی ─────────────────────────────────
    const subject = vString(body.subject, 'موضوع', { required: true, min: 3, max: 150 })
    const expectation = vString(body.expectation, 'انتظار', { max: 3000 })
    const actual = vString(body.actual, 'اتفاق واقعی', { max: 3000 })
    const steps = vString(body.steps, 'مراحل', { max: 3000 })
    const section = vString(body.section, 'بخش', { max: 60 })
    const errorInfo = vString(body.errorInfo, 'اطلاعات خطا', { max: 1000 })

    // «مراحل» دیگر الزامی نیست؛ اما حداقل یکی از شرح‌ها باید پر باشد
    if (!expectation && !actual && !steps) {
      throw new ApiError(400, 'شرح مشکل را کامل کنید.')
    }

    // مسیر صفحه: ابتدا query/hash حذف و سپس به ۲۰۰ نویسه محدود می‌شود
    const page = sanitizePage(vString(body.page, 'صفحه', { max: 2000 }))

    // ── اعتبارسنجی شناسهٔ عملیات ────────────────────────────────
    let operationId: string | null = null
    if (body.operationId !== undefined && body.operationId !== null && body.operationId !== '') {
      const opId = vString(body.operationId, 'شناسهٔ عملیات', { required: true, max: 40 })
      const op = await db.operationLog.findUnique({ where: { id: opId }, select: { id: true } })
      if (!op) throw new ApiError(400, 'شناسهٔ عملیات معتبر نیست.')
      operationId = opId
    }

    // ── اعتبارسنجی تصویر پیوست (data URL تصویر) ─────────────────
    let screenshot: string | null = null
    let screenshotMime: string | null = null
    if (body.screenshot !== undefined && body.screenshot !== null && body.screenshot !== '') {
      if (typeof body.screenshot !== 'string') {
        throw new ApiError(400, 'قالب تصویر پیوست معتبر نیست.')
      }
      if (body.screenshot.length > MAX_SCREENSHOT_LENGTH) {
        throw new ApiError(400, 'حجم تصویر بیش از حد مجاز است.')
      }
      if (body.screenshot.startsWith('data:image/png;base64,')) {
        screenshot = body.screenshot
        screenshotMime = 'image/png'
      } else if (body.screenshot.startsWith('data:image/jpeg;base64,')) {
        screenshot = body.screenshot
        screenshotMime = 'image/jpeg'
      } else {
        throw new ApiError(400, 'قالب تصویر پیوست معتبر نیست.')
      }
    }

    // ── User-Agent: بدنه (سازگاری با نسخهٔ قبل) یا سرصفحهٔ درخواست ──
    const userAgent =
      typeof body.userAgent === 'string' && body.userAgent.trim() !== ''
        ? vString(body.userAgent, 'مرورگر', { max: 300 })
        : (req.headers.get('user-agent') ?? '').slice(0, 300)

    // ── پالایش داده‌های حساس پیش از هر ذخیره‌سازی ───────────────
    const safeSubject = filterSensitive(subject)
    const safeExpectation = filterSensitive(expectation)
    const safeActual = filterSensitive(actual)
    const safeSteps = filterSensitive(steps)
    const safeErrorInfo = filterSensitive(errorInfo)

    // ── اطلاعات تشخیصی — فقط سمت سرور ساخته می‌شود ──────────────
    const diagnostics = JSON.stringify({
      time: new Date().toISOString(),
      appVersion: APP_VERSION,
      page,
      section,
      browser: detectBrowser(userAgent),
      errorCode: extractErrorCode(safeErrorInfo),
      operationId,
    })

    // ── ادغام گزارش تکراری: همان کاربر/موضوع/صفحه در ۱۰ دقیقهٔ اخیر ──
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const duplicate = await db.supportTicket.findFirst({
      where: {
        userId: user.id,
        subject: safeSubject,
        page,
        createdAt: { gte: tenMinutesAgo },
        status: { not: 'CLOSED' },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (duplicate) {
      return ok({ code: duplicate.code, id: duplicate.id, deduped: true })
    }

    const ticket = await createTicketWithRetry({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      subject: safeSubject,
      expectation: safeExpectation,
      actual: safeActual,
      page,
      section,
      steps: safeSteps,
      errorInfo: safeErrorInfo,
      operationId,
      diagnostics,
      screenshot,
      screenshotMime,
      userAgent,
      status: 'NEW',
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

    return ok({ code: ticket.code, id: ticket.id })
  } catch (err) {
    return handleApiError(err)
  }
}
