/**
 * ورود کاربر به سامانه
 * POST /api/auth/login
 * - محدودسازی نرخ تلاش (۱۰ تلاش در ۱۰ دقیقه برای هر IP)
 * - پیام خطای یکسان برای «کاربر یافت نشد» و «رمز اشتباه» برای جلوگیری از افشای وجود حساب
 * - فعال‌سازی خودکار کاربران دعوت‌شده در نخستین ورود
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createSession } from '@/lib/auth'
import { ApiError, ok, handleApiError, parseBody, checkRateLimit } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    // محدودسازی نرخ بر اساس IP — سقف برای محیط تست پیکربندی‌پذیر است (پیش‌فرض production: ۱۰)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const loginMaxAttempts = Math.max(1, Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10)
    if (!checkRateLimit(`login:${ip}`, loginMaxAttempts, 10 * 60 * 1000)) {
      throw new ApiError(429, 'تلاش بیش از حد برای ورود. لطفاً چند دقیقه دیگر تلاش کنید.')
    }

    const body = await parseBody<{ email?: unknown; password?: unknown }>(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) {
      throw new ApiError(400, 'ایمیل و رمز عبور الزامی است.')
    }

    const user = await db.user.findUnique({ where: { email } })
    // پیام یکسان در هر دو حالت (جلوگیری از شناسایی وجود حساب)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new ApiError(401, 'ایمیل یا رمز عبور نادرست است.')
    }

    if (user.status === 'DISABLED') {
      throw new ApiError(403, 'حساب کاربری شما غیرفعال شده است. با مدیر سامانه تماس بگیرید.')
    }
    if (user.status === 'SUSPENDED') {
      throw new ApiError(403, 'حساب کاربری شما موقتاً تعلیق شده است.')
    }

    // فعال‌سازی خودکار کاربر دعوت‌شده در نخستین ورود
    let status = user.status
    if (status === 'INVITED') {
      await db.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } })
      status = 'ACTIVE'
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'UPDATE',
        entityType: 'USER',
        entityId: user.id,
        entityTitle: user.name,
        details: 'فعال‌سازی خودکار حساب در نخستین ورود',
      })
    }

    const userAgent = req.headers.get('user-agent') ?? undefined
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await createSession(user.id, userAgent)

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'LOGIN',
      entityType: 'SESSION',
      entityId: user.id,
      entityTitle: user.name,
    })

    return ok({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, status },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
