/**
 * موتور مرکز عملیات — اجرای عملیات‌های دسته‌ای به‌صورت نامتزامن
 * ساختار: OperationLog (QUEUED → RUNNING → SUCCESS/PARTIAL/FAILED/CANCELLED) + OperationItem برای تک‌تک موارد
 * ویژگی‌ها: ضربان قلب پردازشگر (heartbeat)، لغو نرم (cancelRequested)،
 * تلاش مجدد فقط موارد ناموفق، پاک‌سازی عملیات سرگردان پردازشگرِ قطع‌شده (sweep)
 */
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api-utils'
import { logActivity, notifyUser } from '@/lib/audit'

export type OperationType = 'BULK_PUBLISH_ARTICLES' | 'BULK_UNPUBLISH_ARTICLES'

/** آستانهٔ تشخیص قطع پردازشگر: ۹۰ ثانیه بدون ضربان قلب */
const STALE_MS = 90_000

const OPERATION_TITLES: Record<OperationType, string> = {
  BULK_PUBLISH_ARTICLES: 'انتشار گروهی مقالات',
  BULK_UNPUBLISH_ARTICLES: 'لغو انتشار گروهی مقالات',
}

interface OperationActor {
  id: string
  name: string
}

/** دلیل فارسی مسدود بودن انتشار مقاله (هم‌راستا با متن‌های bundle-runner) */
function publishBlockReason(status: string): string {
  if (status === 'DRAFT') return 'مقاله هنوز پیش‌نویس است و برای انتشار باید تأیید شود.'
  if (status === 'IN_REVIEW') return 'مقاله در صف بررسی است؛ ابتدا تأیید شود.'
  if (status === 'NEEDS_REVISION') return 'مقاله نیازمند اصلاح است.'
  return 'مقاله بایگانی‌شده است و قابل انتشار نیست.'
}

/**
 * آغاز عملیات دسته‌ای مقالات:
 * اعتبارسنجی وجود مقاله‌ها → ساخت OperationLog(QUEUED) + آیتم‌های PENDING → اجرای نامتزامن
 * شناسهٔ عملیات را برمی‌گرداند (پاسخ 202 فوراً داده می‌شود؛ منتظر اجرا نمی‌مانیم)
 */
export async function startBulkArticleOperation(
  type: OperationType,
  articleIds: string[],
  actor: OperationActor
): Promise<string> {
  const uniqueIds = Array.from(new Set(articleIds))

  // اعتبارسنجی وجود مقاله‌ها — فقط موارد موجود وارد عملیات می‌شوند
  const articles = await db.article.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, title: true, status: true },
  })
  if (articles.length === 0) {
    throw new ApiError(400, 'هیچ مقالهٔ معتبری برای این عملیات یافت نشد.')
  }

  const op = await db.operationLog.create({
    data: {
      type,
      title: OPERATION_TITLES[type],
      status: 'QUEUED',
      totalItems: articles.length,
      initiatorId: actor.id,
      initiatorName: actor.name,
    },
  })

  await db.operationItem.createMany({
    data: articles.map((a) => ({
      operationId: op.id,
      refType: 'ARTICLE',
      refId: a.id,
      label: a.title,
      status: 'PENDING',
    })),
  })

  // اجرای نامتزامن — بدون await؛ خطاها درون runOperation مدیریت می‌شوند
  void runOperation(op.id).catch((e) => console.error('[operations] run failed', e))

  return op.id
}

/** اجرای عملیات: پردازش ترتیبی آیتم‌ها با لغو نرم و ضربان قلب در هر گام */
async function runOperation(opId: string): Promise<void> {
  const now = new Date()
  await db.operationLog
    .update({ where: { id: opId }, data: { status: 'RUNNING', startedAt: now, heartbeatAt: now } })
    .catch(() => undefined)

  const meta = await db.operationLog.findUnique({
    where: { id: opId },
    select: { type: true, initiatorId: true, initiatorName: true },
  })
  if (!meta) return

  const actor: OperationActor = { id: meta.initiatorId ?? 'system', name: meta.initiatorName || 'سیستم' }

  const items = await db.operationItem.findMany({
    where: { operationId: opId },
    orderBy: { createdAt: 'asc' },
  })

  // آیا لغو در میانهٔ اجرا دیده شد؟ (مبنای تمایز PARTIAL از CANCELLED/SUCCESS)
  let wasCancelled = false

  for (const item of items) {
    // در هر گام وضعیت لغو دوباره خوانده می‌شود
    const op = await db.operationLog.findUnique({
      where: { id: opId },
      select: { cancelRequested: true },
    })
    if (!op || op.cancelRequested) {
      wasCancelled = true
      // این مورد و همهٔ موارد باقی‌ماندهٔ معلق لغو می‌شوند
      await db.operationItem
        .updateMany({
          where: { operationId: opId, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        })
        .catch(() => undefined)
      break
    }

    // ضربان قلب: نشان دادن حیات پردازشگر پیش از شروع مورد
    await db.operationLog
      .update({ where: { id: opId }, data: { heartbeatAt: new Date() } })
      .catch(() => undefined)

    try {
      const result = await runItem(meta.type, item.refId, actor)
      await db.operationItem.update({
        where: { id: item.id },
        data: { status: result.status, message: result.message },
      })
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'خطای نامشخص در اجرای مورد.'
      await db.operationItem
        .update({ where: { id: item.id }, data: { status: 'FAILED', message } })
        .catch(() => undefined)
    }
  }

  await finishOperation(opId, wasCancelled)
}

/** اجرای یک مورد بر اساس نوع عملیات — نتیجه فقط در آیتم ثبت می‌شود؛ خطای مورد کل عملیات را نمی‌شکند */
async function runItem(
  opType: string,
  refId: string,
  actor: OperationActor
): Promise<{ status: 'SUCCEEDED' | 'FAILED'; message: string }> {
  const article = await db.article.findUnique({
    where: { id: refId },
    select: { id: true, title: true, status: true, authorId: true },
  })
  if (!article) return { status: 'FAILED', message: 'مقاله یافت نشد.' }

  if (opType === 'BULK_PUBLISH_ARTICLES') {
    // از قبل منتشرشده: موفق بدون هیچ نوشتن در مقاله
    if (article.status === 'PUBLISHED') {
      return { status: 'SUCCEEDED', message: 'از قبل منتشر شده بود.' }
    }
    if (article.status === 'APPROVED') {
      await db.article.update({
        where: { id: article.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), reviewNote: null },
      })
      // بستن کارهای باز مرتبط با مقاله (بازبینی/اصلاح)
      await db.task.updateMany({
        where: { relatedType: 'ARTICLE', relatedId: article.id, type: { in: ['REVIEW', 'REVISION'] }, status: 'OPEN' },
        data: { status: 'DONE', doneAt: new Date() },
      })
      await notifyUser(article.authorId, {
        type: 'PUBLISHED',
        title: 'مقاله شما منتشر شد',
        body: `«${article.title}» به‌صورت گروهی منتشر شد.`,
        link: '#/articles',
      })
      await logActivity({
        userId: actor.id,
        userName: actor.name,
        action: 'PUBLISH',
        entityType: 'ARTICLE',
        entityId: article.id,
        entityTitle: article.title,
        details: 'انتشار گروهی از مرکز عملیات',
      })
      return { status: 'SUCCEEDED', message: 'منتشر شد.' }
    }
    return { status: 'FAILED', message: publishBlockReason(article.status) }
  }

  if (opType === 'BULK_UNPUBLISH_ARTICLES') {
    if (article.status === 'PUBLISHED') {
      await db.article.update({
        where: { id: article.id },
        data: { status: 'DRAFT', publishedAt: null },
      })
      await logActivity({
        userId: actor.id,
        userName: actor.name,
        action: 'UNPUBLISH',
        entityType: 'ARTICLE',
        entityId: article.id,
        entityTitle: article.title,
        details: 'لغو انتشار گروهی از مرکز عملیات',
      })
      return { status: 'SUCCEEDED', message: 'لغو انتشار شد.' }
    }
    return { status: 'FAILED', message: 'مقاله منتشر نشده بود.' }
  }

  return { status: 'FAILED', message: 'نوع عملیات پشتیبانی نمی‌شود.' }
}

/** پایان عملیات: محاسبهٔ شمارنده‌ها، وضعیت نهایی، خلاصهٔ فارسی و فهرست خطاها */
async function finishOperation(opId: string, wasCancelled: boolean): Promise<void> {
  const items = await db.operationItem.findMany({
    where: { operationId: opId },
    select: { status: true, label: true, message: true },
  })

  const done = items.filter((i) => i.status === 'SUCCEEDED').length
  const failed = items.filter((i) => i.status === 'FAILED').length
  const status = wasCancelled && done > 0 ? 'PARTIAL' : wasCancelled ? 'CANCELLED' : failed === 0 ? 'SUCCESS' : done === 0 ? 'FAILED' : 'PARTIAL'

  await db.operationLog
    .update({
      where: { id: opId },
      data: {
        status,
        doneItems: done,
        failedItems: failed,
        resultSummary: `${done} مورد موفق؛ ${failed} مورد ناموفق.${wasCancelled ? ' عملیات لغو شد.' : ''}`,
        errorsJson: JSON.stringify(
          items
            .filter((i) => i.status === 'FAILED')
            .map((i) => ({ item: i.label, reason: i.message ?? '' }))
        ),
        finishedAt: new Date(),
      },
    })
    .catch(() => undefined)
}

/**
 * پاک‌سازی عملیات سرگردان: هر عملیات RUNNING که بیش از ۹۰ ثانیه ضربان قلب نداشته
 * (پردازشگر با بستن مرورگر/ری‌استارت سرور مرده) ناموفق اعلام و آیتم‌های معلق آن ثبت می‌شود.
 * در ابتدای همهٔ GETهای مرکز عملیات فراخوانی می‌شود تا وضعیت همیشه نهایی شود.
 */
export async function sweepStaleOperations(): Promise<void> {
  const now = Date.now()
  const running = await db.operationLog.findMany({
    where: { status: 'RUNNING' },
    select: { id: true, heartbeatAt: true, startedAt: true },
  })

  for (const op of running) {
    const last = op.heartbeatAt ?? op.startedAt
    if (last && now - last.getTime() <= STALE_MS) continue

    const pending = await db.operationItem.findMany({
      where: { operationId: op.id, status: 'PENDING' },
      select: { label: true },
    })

    await db.operationItem.updateMany({
      where: { operationId: op.id, status: 'PENDING' },
      data: { status: 'FAILED', message: 'به‌دلیل قطع پردازشگر اجرا نشد.' },
    })

    const [doneCount, failedCount] = await Promise.all([
      db.operationItem.count({ where: { operationId: op.id, status: 'SUCCEEDED' } }),
      db.operationItem.count({ where: { operationId: op.id, status: 'FAILED' } }),
    ])

    await db.operationLog.update({
      where: { id: op.id },
      data: {
        status: 'FAILED',
        doneItems: doneCount,
        failedItems: failedCount,
        resultSummary: 'پردازشگر قطع شد و عملیات ناتمام ماند.',
        errorsJson: JSON.stringify(
          pending.map((p) => ({ item: p.label, reason: 'به‌دلیل قطع پردازشگر اجرا نشد.' }))
        ),
        finishedAt: new Date(),
      },
    })
  }
}

/**
 * تلاش مجدد یک عملیات تمام‌شده: عملیات جدیدی فقط با موارد FAILED ساخته و اجرا می‌شود
 * (بدون تکرار اثرهای موفق قبلی). شناسهٔ عملیات جدید را برمی‌گرداند.
 */
export async function retryOperation(opId: string, actor: OperationActor): Promise<string> {
  const op = await db.operationLog.findUnique({ where: { id: opId } })
  if (!op) throw new ApiError(404, 'عملیات یافت نشد.')
  if (!['SUCCESS', 'PARTIAL', 'FAILED'].includes(op.status)) {
    throw new ApiError(400, 'فقط عملیات تمام‌شده قابل تلاش مجدد است.')
  }

  const failedItems = await db.operationItem.findMany({
    where: { operationId: opId, status: 'FAILED' },
    orderBy: { createdAt: 'asc' },
    select: { refType: true, refId: true, label: true },
  })
  if (failedItems.length === 0) {
    throw new ApiError(400, 'مورد ناموفقی برای تلاش مجدد وجود ندارد.')
  }

  const retry = await db.operationLog.create({
    data: {
      type: op.type,
      title: `تلاش مجدد: ${op.title}`,
      status: 'QUEUED',
      totalItems: failedItems.length,
      initiatorId: actor.id,
      initiatorName: actor.name,
      retryOfId: op.id,
    },
  })

  await db.operationItem.createMany({
    data: failedItems.map((i) => ({
      operationId: retry.id,
      refType: i.refType,
      refId: i.refId,
      label: i.label,
      status: 'PENDING',
    })),
  })

  void runOperation(retry.id).catch((e) => console.error('[operations] retry run failed', e))
  return retry.id
}

/**
 * لغو عملیات:
 * QUEUED → لغو فوری (status=CANCELLED + آیتم‌های PENDING→CANCELLED)
 * RUNNING → فقط cancelRequested=true؛ پردازشگر در گام بعدی می‌ایستد
 *           (اگر آیتم موفقی داشته باشد PARTIAL وگرنه CANCELLED می‌شود)
 * وضعیت نهایی پس از درخواست، بازخوانی و برگردانده می‌شود.
 */
export async function cancelOperation(opId: string): Promise<string> {
  const op = await db.operationLog.findUnique({
    where: { id: opId },
    select: { id: true, status: true },
  })
  if (!op) throw new ApiError(404, 'عملیات یافت نشد.')

  if (op.status === 'QUEUED') {
    await db.operationLog.update({
      where: { id: opId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    })
    await db.operationItem.updateMany({
      where: { operationId: opId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
  } else if (op.status === 'RUNNING') {
    await db.operationLog.update({
      where: { id: opId },
      data: { cancelRequested: true },
    })
  }

  const final = await db.operationLog.findUnique({ where: { id: opId }, select: { status: true } })
  return final?.status ?? op.status
}
