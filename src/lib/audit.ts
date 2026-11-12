/**
 * ثبت تاریخچه فعالیت (Audit Log) و اعلان‌های درون‌پنلی
 * قواعد: رمز/توکن ثبت نمی‌شود؛ ثبت activity هرگز مسیر اصلی را ناموفق نمی‌کند.
 */
import { db } from '@/lib/db'

export async function logActivity(input: {
  userId?: string | null
  userName?: string
  action: string
  entityType: string
  entityId?: string | null
  entityTitle?: string | null
  details?: string | null
}) {
  try {
    await db.activityLog.create({
      data: {
        userId: input.userId ?? null,
        userName: input.userName ?? 'سیستم',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityTitle: input.entityTitle ?? null,
        details: input.details ?? null,
      },
    })
  } catch (e) {
    console.error('[activity-log] failed', e)
  }
}

export async function notifyUsers(
  roles: string[],
  input: { type: string; title: string; body?: string; link?: string; excludeUserId?: string }
) {
  try {
    const users = await db.user.findMany({
      where: { role: { in: roles }, status: { in: ['ACTIVE', 'INVITED'] }, ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}) },
      select: { id: true },
    })
    if (users.length === 0) return
    await db.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        link: input.link ?? null,
      })),
    })
  } catch (e) {
    console.error('[notify] failed', e)
  }
}

export async function notifyUser(userId: string, input: { type: string; title: string; body?: string; link?: string }) {
  try {
    await db.notification.create({
      data: { userId: userId, type: input.type, title: input.title, body: input.body ?? '', link: input.link ?? null },
    })
  } catch (e) {
    console.error('[notifyUser] failed', e)
  }
}
