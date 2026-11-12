/**
 * مدیریت یک کاربر مشخص
 * GET    /api/users/[id] — مشاهده کاربر (مجوز users.view)
 * PUT    /api/users/[id] — ویرایش نقش/وضعیت/نام/رمز (مجوز users.manage)
 * DELETE /api/users/[id] — حذف کاربر با پشتیبانی انتقال مقالات (مجوز users.manage)
 *
 * گاردهای مهم:
 * - جلوگیری از حذف/تضعیف حساب خودی به‌گونه‌ای که دسترسی مدیریتی از بین برود
 * - همیشه باید حداقل یک مدیر کل فعال باقی بماند
 */
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { hashPassword, SESSION_COOKIE } from '@/lib/auth'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity, notifyUser } from '@/lib/audit'
import { ROLES, ROLE_LABELS, type Role } from '@/lib/permissions'
import { USER_STATUSES } from '@/lib/constants'

/** پیام خطای «حداقل یک مدیر فعال» */
const LAST_ADMIN_MSG = 'همیشه باید حداقل یک مدیر کل فعال در سامانه وجود داشته باشد.'

/** شمارش مدیران فعال به‌جز کاربر هدف */
async function countOtherActiveAdmins(excludeId: string): Promise<number> {
  return db.user.count({
    where: { role: 'ADMIN', status: 'ACTIVE', id: { not: excludeId } },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('users.view')
    const { id } = await params

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        _count: { select: { articles: true } },
      },
    })
    if (!user) {
      throw new ApiError(404, 'کاربر یافت نشد.')
    }

    return ok({ user })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission('users.manage')
    const { id } = await params
    const body = await parseBody<{ name?: unknown; role?: unknown; status?: unknown; password?: unknown }>(req)

    const target = await db.user.findUnique({ where: { id } })
    if (!target) {
      throw new ApiError(404, 'کاربر یافت نشد.')
    }

    // ─── اعتبارسنجی فیلدهای ارسالی (همه اختیاری) ───────────────────
    let newName: string | undefined
    if (body.name !== undefined && body.name !== null && body.name !== '') {
      newName = vString(body.name, 'نام', { required: true, max: 100 })
    }

    let newRole: Role | undefined
    if (body.role !== undefined && body.role !== null && body.role !== '') {
      newRole = vEnum(body.role, ROLES, 'نقش')
    }

    let newStatus: string | undefined
    if (body.status !== undefined && body.status !== null && body.status !== '') {
      newStatus = vEnum(body.status, USER_STATUSES.map((s) => s.value), 'وضعیت')
    }

    const passwordProvided = body.password !== undefined && body.password !== null && body.password !== ''
    if (passwordProvided && typeof body.password !== 'string') {
      throw new ApiError(400, '«رمز عبور» باید متن باشد.')
    }
    if (passwordProvided && (body.password as string).length < 8) {
      throw new ApiError(400, 'رمز عبور باید حداقل ۸ نویسه باشد.')
    }

    const noChanges = newName === undefined && newRole === undefined && newStatus === undefined && !passwordProvided
    if (noChanges) {
      throw new ApiError(400, 'تغییری برای اعمال ارسال نشده است.')
    }

    // ─── گارد ۱: تغییر مخرب حساب خودی ──────────────────────────────
    if (target.id === actor.id) {
      const selfDemote = target.role === 'ADMIN' && newRole !== undefined && newRole !== 'ADMIN'
      const selfBlock = newStatus === 'DISABLED' || newStatus === 'SUSPENDED'
      if (selfDemote || selfBlock) {
        throw new ApiError(400, 'شما نمی‌توانید نقش یا وضعیت حساب خودتان را به‌گونه‌ای تغییر دهید که دسترسی مدیریتی از بین برود.')
      }
    }

    // ─── گارد ۲: حفظ حداقل یک مدیر کل فعال ─────────────────────────
    const isActiveAdmin = target.role === 'ADMIN' && target.status === 'ACTIVE'
    const willLoseAdmin =
      isActiveAdmin &&
      ((newRole !== undefined && newRole !== 'ADMIN') || (newStatus !== undefined && newStatus !== 'ACTIVE'))
    if (willLoseAdmin && (await countOtherActiveAdmins(target.id)) === 0) {
      throw new ApiError(400, LAST_ADMIN_MSG)
    }

    // ─── اعمال تغییرات ─────────────────────────────────────────────
    const data: { name?: string; role?: string; status?: string; passwordHash?: string } = {}
    const changes: string[] = []

    if (newName !== undefined && newName !== target.name) {
      data.name = newName
      changes.push(`تغییر نام به «${newName}»`)
    }
    if (newRole !== undefined && newRole !== target.role) {
      data.role = newRole
      changes.push(`تغییر نقش به «${ROLE_LABELS[newRole as Role]}»`)
    }
    if (newStatus !== undefined && newStatus !== target.status) {
      data.status = newStatus
      changes.push(`تغییر وضعیت به «${USER_STATUSES.find((s) => s.value === newStatus)?.label ?? newStatus}»`)
    }

    if (passwordProvided) {
      data.passwordHash = hashPassword(body.password as string)

      // حذف نشست‌های کاربر؛ اگر هدف خودِ درخواست‌دهنده است، نشست جاری حفظ می‌شود
      const store = await cookies()
      const currentToken = store.get(SESSION_COOKIE)?.value
      await db.session.deleteMany({
        where: {
          userId: target.id,
          ...(target.id === actor.id && currentToken ? { token: { not: currentToken } } : {}),
        },
      })
    }

    const updated = Object.keys(data).length > 0 ? await db.user.update({ where: { id: target.id }, data }) : target

    // ─── اثر جانبی تغییر وضعیت: خروج نشست‌ها و اعلان ───────────────
    const statusChangedToBlocked =
      newStatus !== undefined && newStatus !== target.status && (newStatus === 'SUSPENDED' || newStatus === 'DISABLED')
    if (statusChangedToBlocked) {
      await db.session.deleteMany({ where: { userId: target.id } })
      await notifyUser(target.id, {
        type: 'ACCESS',
        title: 'تغییر وضعیت حساب',
        body: 'وضعیت حساب شما تغییر کرد.',
      })
    }

    // ─── ثبت تاریخچه ───────────────────────────────────────────────
    if (passwordProvided) {
      await logActivity({
        userId: actor.id,
        userName: actor.name,
        action: 'RESET_PASSWORD',
        entityType: 'USER',
        entityId: target.id,
        entityTitle: updated.name,
        details: target.id === actor.id ? 'تغییر رمز عبور توسط خود کاربر' : 'بازنشانی رمز عبور کاربر',
      })
    }
    if (changes.length > 0) {
      await logActivity({
        userId: actor.id,
        userName: actor.name,
        action: 'UPDATE',
        entityType: 'USER',
        entityId: target.id,
        entityTitle: updated.name,
        details: changes.join('، '),
      })
    }

    // هرگز passwordHash بازگردانده نمی‌شود
    return ok({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        status: updated.status,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        lastLoginAt: updated.lastLoginAt,
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission('users.manage')
    const { id } = await params

    const target = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        _count: { select: { articles: true } },
      },
    })
    if (!target) {
      throw new ApiError(404, 'کاربر یافت نشد.')
    }

    // حذف حساب خودی ممنوع است
    if (target.id === actor.id) {
      throw new ApiError(400, 'حذف حساب خودتان امکان‌پذیر نیست.')
    }

    // حفظ حداقل یک مدیر کل فعال
    if (target.role === 'ADMIN' && target.status === 'ACTIVE' && (await countOtherActiveAdmins(target.id)) === 0) {
      throw new ApiError(400, LAST_ADMIN_MSG)
    }

    const transferToUserId = req.nextUrl.searchParams.get('transferToUserId')
    if (transferToUserId) {
      if (transferToUserId === target.id) {
        throw new ApiError(400, 'کاربر مقصد انتقال مقالات نمی‌تواند همان کاربر حذف‌شونده باشد.')
      }
      const transferTarget = await db.user.findUnique({ where: { id: transferToUserId }, select: { id: true } })
      if (!transferTarget) {
        throw new ApiError(404, 'کاربر مقصد برای انتقال مقالات یافت نشد.')
      }
    }

    // انتقال مقالات در صورت درخواست؛ در غیر این صورت اگر نویسنده مقاله است اجازه حذف نده
    const articleCount = target._count.articles
    if (transferToUserId) {
      await db.article.updateMany({ where: { authorId: target.id }, data: { authorId: transferToUserId } })
    } else if (articleCount > 0) {
      throw new ApiError(
        409,
        `این کاربر نویسندهٔ ${articleCount} مقاله است. ابتدا مقالات را به کاربر دیگری منتقل کنید یا مجدداً تلاش کنید.`,
        { articleCount },
      )
    }

    // حذف کاربر (نشست‌ها و اعلان‌ها خودکار حذف می‌شوند؛ تاریخچه فعالیت با SetNull حفظ می‌شود)
    try {
      await db.user.delete({ where: { id: target.id } })
    } catch (e) {
      // خطای محدودیت کلید خارجی (P2003): کاربر رسانه بارگذاری‌شده دارد
      const code = (e as { code?: string })?.code
      if (code === 'P2003') {
        throw new ApiError(409, 'این کاربر فایل رسانه‌ای بارگذاری کرده است. ابتدا فایل‌های رسانه‌ای را حذف یا منتقل کنید.')
      }
      throw e
    }

    await logActivity({
      userId: actor.id,
      userName: actor.name,
      action: 'DELETE',
      entityType: 'USER',
      entityId: target.id,
      entityTitle: target.name,
      ...(transferToUserId ? { details: 'مقالات کاربر پیش از حذف منتقل شد' } : {}),
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
