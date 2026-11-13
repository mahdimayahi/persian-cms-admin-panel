/**
 * کتابخانه احراز هویت سمت سرور
 * - هش رمز عبور با scrypt (استاندارد Node.js)
 * - مدیریت نشست با کوکی HttpOnly
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { cookies, headers } from 'next/headers'

export const SESSION_COOKIE = 'cms_session'
const SESSION_DAYS = 7

/**
 * تشخیص HTTPS اتصال جاری (پشت پروکسی معکوس استاندارد).
 * کوکی نشست فقط روی اتصال امن پرچم Secure می‌گیرد تا در استقرار HTTPS
 * هرگز از کانال غیررمز ارسال نشود؛ در توسعه/localhost بدون پروکسی false می‌ماند.
 */
export async function isHttpsRequest(): Promise<boolean> {
  try {
    const h = await headers()
    const proto = h.get('x-forwarded-proto') ?? ''
    return proto.split(',')[0].trim() === 'https'
  } catch {
    return false
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const original = Buffer.from(hash, 'hex')
  return candidate.length === original.length && timingSafeEqual(candidate, original)
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export async function createSession(userId: string, userAgent?: string) {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({
    data: { token, userId, userAgent: userAgent?.slice(0, 200), expiresAt },
  })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttpsRequest(),
    path: '/',
    expires: expiresAt,
  })
  return token
}

export type SessionUser = {
  id: string
  email: string
  name: string
  role: string
  status: string
  lastLoginAt: Date | null
  createdAt: Date
}

/** بازیابی کاربر جاری از کوکی نشست؛ در صورت انقضا، نشست حذف می‌شود */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => null)
    return null
  }
  if (session.user.status === 'SUSPENDED' || session.user.status === 'DISABLED') return null
  // تمدید زمان آخرین فعالیت (بدون انتظار برای نتیجه)
  db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => null)
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    status: session.user.status,
    lastLoginAt: session.user.lastLoginAt,
    createdAt: session.user.createdAt,
  }
}

export async function destroyCurrentSession() {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { token } })
    store.delete(SESSION_COOKIE)
  }
}

export function hashIpStable(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
