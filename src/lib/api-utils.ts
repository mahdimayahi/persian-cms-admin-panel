/**
 * ابزارهای مشترک Route Handler ها
 * - پاسخ JSON یکپارچه و خطاهای ساختاریافته فارسی
 * - گارد احراز هویت و مجوز سمت سرور
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, SessionUser } from '@/lib/auth'
import { Permission, roleHasPermission } from '@/lib/permissions'

export class ApiError extends Error {
  status: number
  data?: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function fail(status: number, message: string, data?: unknown) {
  return NextResponse.json({ error: message, ...(data !== undefined ? { data } : {}) }, { status })
}

/** تبدیل خطا به پاسخ استاندارد */
export function handleApiError(err: unknown) {
  if (err instanceof ApiError) return fail(err.status, err.message, err.data)
  console.error('[API]', err)
  return fail(500, 'خطای غیرمنتظره سرور. لطفاً دوباره تلاش کنید.')
}

/** گارد احراز هویت: کاربر جاری را برمی‌گرداند یا خطای ۴۰۱ می‌دهد */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new ApiError(401, 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.')
  return user
}

/** گارد مجوز: در صورت نداشتن مجوز خطای ۴۰۳ می‌دهد */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireAuth()
  if (!roleHasPermission(user.role, permission)) {
    throw new ApiError(403, 'شما مجوز انجام این عملیات را ندارید.')
  }
  return user
}

export async function parseBody<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new ApiError(400, 'بدنه درخواست نامعتبر است.')
  }
}

// ─── اعتبارسنجی سبک ──────────────────────────────────────────────

export function vString(value: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): string {
  const { min = 0, max = 10000, required = min > 0 } = opts
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `«${field}» الزامی است.`)
    return ''
  }
  if (typeof value !== 'string') throw new ApiError(400, `«${field}» باید متن باشد.`)
  const trimmed = value.trim()
  if (required && trimmed.length === 0) throw new ApiError(400, `«${field}» الزامی است.`)
  if (trimmed.length < min) throw new ApiError(400, `«${field}» باید حداقل ${min} نویسه باشد.`)
  if (trimmed.length > max) throw new ApiError(400, `«${field}» نباید بیش از ${max} نویسه باشد.`)
  return trimmed
}

export function vEmail(value: unknown, field = 'ایمیل'): string {
  const s = vString(value, field, { required: true, max: 200 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ApiError(400, 'قالب ایمیل معتبر نیست.')
  return s.toLowerCase()
}

export function vInt(value: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw new ApiError(400, `«${field}» الزامی است.`)
    return null
  }
  const n = Number(value)
  if (!Number.isFinite(n)) throw new ApiError(400, `«${field}» باید عدد باشد.`)
  if (opts.min !== undefined && n < opts.min) throw new ApiError(400, `«${field}» نباید کمتر از ${opts.min} باشد.`)
  if (opts.max !== undefined && n > opts.max) throw new ApiError(400, `«${field}» نباید بیشتر از ${opts.max} باشد.`)
  return Math.floor(n)
}

export function vBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

export function vEnum<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw new ApiError(400, `«${field}» الزامی است.`)
  }
  if (!allowed.includes(value as T)) throw new ApiError(400, `مقدار «${field}» نامعتبر است.`)
  return value as T
}

/** ساخت slug امن از متن فارسی/انگلیسی */
export function slugify(text: string): string {
  return (
    text
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[\u200c\u064B-\u065F]/g, '') // نیم‌فاصله و اعراب
      .replace(/[\u06CC]/g, 'y')
      .replace(/[\u06A9]/g, 'k')
      .replace(/[\u0640]/g, '')
      .replace(/[^\w\s\u0600-\u06FF-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || `item-${Date.now()}`
  )
}

export function getPaginationParams(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 10))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

/** محدودکننده نرخ ساده در حافظه (ضد تلاش ورود انبوه) */
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  bucket.count++
  if (bucket.count > max) return false
  return true
}
