/**
 * مدیریت کاربران
 * GET  /api/users — فهرست کاربران با جستجو و فیلتر (مجوز users.view)
 * POST /api/users — ایجاد (دعوت) کاربر جدید (مجوز users.manage)
 */
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import {
  ApiError,
  ok,
  handleApiError,
  requirePermission,
  parseBody,
  vString,
  vEmail,
  vEnum,
  getPaginationParams,
} from '@/lib/api-utils'
import { logActivity, notifyUser } from '@/lib/audit'
import { ROLES } from '@/lib/permissions'
import { USER_STATUSES } from '@/lib/constants'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('users.view')
    const { searchParams } = new URL(req.url)
    const { page, pageSize, skip, take } = getPaginationParams(searchParams)

    const q = searchParams.get('q')?.trim() || ''
    const roleParam = searchParams.get('role') || ''
    const statusParam = searchParams.get('status') || ''

    const where: Prisma.UserWhereInput = {}
    if (q) {
      where.OR = [{ name: { contains: q } }, { email: { contains: q } }]
    }
    if (roleParam && (ROLES as readonly string[]).includes(roleParam)) {
      where.role = roleParam
    }
    if (statusParam && USER_STATUSES.some((s) => s.value === statusParam)) {
      where.status = statusParam
    }

    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
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
      }),
      db.user.count({ where }),
    ])

    return ok({ items, total, page, pageSize })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission('users.manage')
    const body = await parseBody<{ name?: unknown; email?: unknown; password?: unknown; role?: unknown }>(req)

    const name = vString(body.name, 'نام', { required: true, max: 100 })
    const email = vEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length < 8) {
      throw new ApiError(400, 'رمز عبور باید حداقل ۸ نویسه باشد.')
    }
    const role = vEnum(body.role, ROLES, 'نقش')

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      throw new ApiError(409, 'کاربری با این ایمیل از قبل وجود دارد.')
    }

    const user = await db.user.create({
      data: { name, email, passwordHash: hashPassword(password), role, status: 'INVITED' },
    })

    await logActivity({
      userId: actor.id,
      userName: actor.name,
      action: 'CREATE',
      entityType: 'USER',
      entityId: user.id,
      entityTitle: name,
      details: 'دعوت کاربر جدید',
    })
    await notifyUser(user.id, {
      type: 'ACCESS',
      title: 'به سامانه خوش آمدید',
      body: 'حساب شما توسط مدیر ایجاد شد.',
    })

    // هرگز passwordHash بازگردانده نمی‌شود
    return ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
        _count: { articles: 0 },
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
