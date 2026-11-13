/**
 * منطق «مرکز کارهای من» — تجمیع همه چیزهایی که منتظر کاربر جاری است
 * مشترک بین /api/tasks و /api/dashboard
 *
 * بخش‌ها:
 *  - در انتظار تأیید شما (مقالات IN_REVIEW — برای بازبین‌ها)
 *  - بازبینی‌های از موعد گذشته (مقالاتی که مالک آن کاربر است)
 *  - کارهای واگذارشده (مدل Task)
 *  - مقالات متوقف‌شده در «نیازمند اصلاح» (کارهای نیمه‌تمام نویسنده)
 *  - ادامه آخرین کار (آخرین مقاله در جریان)
 */
import { db } from '@/lib/db'
import { roleHasPermission } from '@/lib/permissions'

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export type TaskRow = {
  id: string
  title: string
  description: string | null
  type: string
  priority: TaskPriority
  status: string
  dueDate: string | null
  link: string | null
  relatedType: string | null
  relatedId: string | null
  assignedToId: string
  assignedByName: string | null
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

export type TaskCenterData = {
  counts: {
    awaitingReview: number
    overdueReviews: number
    openTasks: number
    overdueTasks: number
    needsRevision: number
  }
  canReview: boolean
  awaitingReview: { id: string; title: string; updatedAt: string; author: { id: string; name: string } }[]
  overdueReviews: {
    id: string
    title: string
    reviewAt: string
    lastReviewedAt: string | null
    status: string
  }[]
  myTasks: TaskRow[]
  needsRevision: { id: string; title: string; reviewNote: string | null; updatedAt: string }[]
  lastWork: { id: string; title: string; status: string; updatedAt: string } | null
  generatedAt: string
}

/** وزن اولویت برای مرتب‌سازی */
const PRIORITY_WEIGHT: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

export async function computeTaskCenter(user: {
  id: string
  role: string
}): Promise<TaskCenterData> {
  const now = new Date()
  const canReview = roleHasPermission(user.role, 'articles.review')

  const [awaitingReview, overdueReviews, myTasksRaw, needsRevision, lastWorkRows] = await Promise.all([
    canReview
      ? db.article.findMany({
          where: { status: 'IN_REVIEW' },
          take: 10,
          orderBy: { updatedAt: 'asc' }, // قدیمی‌ترین‌ها بیشتر منتظر مانده‌اند
          select: { id: true, title: true, updatedAt: true, author: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
    db.article.findMany({
      where: {
        ownerId: user.id,
        reviewAt: { lt: now },
        status: { notIn: ['ARCHIVED'] },
      },
      take: 10,
      orderBy: { reviewAt: 'asc' },
      select: { id: true, title: true, reviewAt: true, lastReviewedAt: true, status: true },
    }),
    db.task.findMany({
      where: { assignedToId: user.id, status: 'OPEN' },
      take: 50,
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    db.article.findMany({
      where: { authorId: user.id, status: 'NEEDS_REVISION' },
      take: 8,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, reviewNote: true, updatedAt: true },
    }),
    db.article.findMany({
      where: { authorId: user.id, status: { in: ['DRAFT', 'NEEDS_REVISION', 'IN_REVIEW'] } },
      take: 1,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
  ])

  // مرتب‌سازی دستی: از موعد گذشته اول، سپس اولویت، سپس موعد
  const myTasks: TaskRow[] = myTasksRaw
    .map((t) => ({
      ...t,
      priority: t.priority as TaskPriority,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      doneAt: t.doneAt ? t.doneAt.toISOString() : null,
    }))
    .sort((a, b) => {
      const aOverdue = a.dueDate ? new Date(a.dueDate).getTime() < now.getTime() : false
      const bOverdue = b.dueDate ? new Date(b.dueDate).getTime() < now.getTime() : false
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
      const pw = (PRIORITY_WEIGHT[a.priority] ?? 1) - (PRIORITY_WEIGHT[b.priority] ?? 1)
      if (pw !== 0) return pw
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return 0
    })

  const overdueTasks = myTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now.getTime()).length

  const serializedAwaiting = awaitingReview.map((a) => ({
    id: a.id,
    title: a.title,
    updatedAt: a.updatedAt.toISOString(),
    author: a.author,
  }))

  const serializedNeedsRevision = needsRevision.map((a) => ({
    id: a.id,
    title: a.title,
    reviewNote: a.reviewNote,
    updatedAt: a.updatedAt.toISOString(),
  }))

  const lastWork = lastWorkRows[0]
    ? {
        id: lastWorkRows[0].id,
        title: lastWorkRows[0].title,
        status: lastWorkRows[0].status,
        updatedAt: lastWorkRows[0].updatedAt.toISOString(),
      }
    : null

  return {
    counts: {
      awaitingReview: serializedAwaiting.length,
      overdueReviews: overdueReviews.length,
      openTasks: myTasks.length,
      overdueTasks,
      needsRevision: serializedNeedsRevision.length,
    },
    canReview,
    awaitingReview: serializedAwaiting,
    overdueReviews: overdueReviews.map((a) => ({
      id: a.id,
      title: a.title,
      reviewAt: a.reviewAt ? a.reviewAt.toISOString() : '',
      lastReviewedAt: a.lastReviewedAt ? a.lastReviewedAt.toISOString() : null,
      status: a.status,
    })),
    myTasks,
    needsRevision: serializedNeedsRevision,
    lastWork,
    generatedAt: now.toISOString(),
  }
}

/** ثبت کار واگذارشده جدید (دستی یا خودکار) */
export async function createTask(input: {
  title: string
  description?: string | null
  type?: string
  priority?: TaskPriority
  dueDate?: Date | null
  link?: string | null
  relatedType?: string | null
  relatedId?: string | null
  assignedToId: string
  assignedById?: string | null
  assignedByName?: string | null
}) {
  return db.task.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      type: input.type ?? 'GENERAL',
      priority: input.priority ?? 'MEDIUM',
      dueDate: input.dueDate ?? null,
      link: input.link ?? null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      assignedToId: input.assignedToId,
      assignedById: input.assignedById ?? null,
      assignedByName: input.assignedByName ?? null,
    },
  })
}
