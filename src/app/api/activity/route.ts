/**
 * تاریخچه فعالیت سامانه (Audit Log)
 * GET /api/activity — با جستجو و فیلتر (مجوز activity.view)
 * فیلترها: q (عنوان موجودیت یا نام کاربر)، action (دقیق)، entityType (دقیق)
 */
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, handleApiError, requirePermission, getPaginationParams } from '@/lib/api-utils'

/** فهرست اقدام‌های قابل فیلتر برای دراپ‌داون */
const ACTIVITY_ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'CREATE',
  'UPDATE',
  'DELETE',
  'PUBLISH',
  'UNPUBLISH',
  'ARCHIVE',
  'SUBMIT_REVIEW',
  'APPROVE',
  'REJECT',
  'CHANGE_PASSWORD',
  'RESET_PASSWORD',
  'REVOKE_SESSIONS',
  'UPLOAD',
  'RESTORE',
  'MODERATE',
] as const

export async function GET(req: NextRequest) {
  try {
    await requirePermission('activity.view')
    const { searchParams } = new URL(req.url)
    const { page, pageSize, skip, take } = getPaginationParams(searchParams)

    const q = searchParams.get('q')?.trim() || ''
    const action = searchParams.get('action')?.trim() || ''
    const entityType = searchParams.get('entityType')?.trim() || ''

    const where: Prisma.ActivityLogWhereInput = {}
    if (q) {
      where.OR = [{ entityTitle: { contains: q } }, { userName: { contains: q } }]
    }
    if (action) {
      where.action = action
    }
    if (entityType) {
      where.entityType = entityType
    }

    const [items, total] = await Promise.all([
      db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      db.activityLog.count({ where }),
    ])

    return ok({ items, total, page, pageSize, actions: ACTIVITY_ACTIONS })
  } catch (err) {
    return handleApiError(err)
  }
}
