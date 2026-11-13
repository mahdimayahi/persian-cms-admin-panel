/**
 * موتور مرکز عملیات — اجرای عملیات‌های دسته‌ای به‌صورت نامتزامن
 * ساختار: OperationLog (QUEUED → RUNNING → SUCCESS/PARTIAL/FAILED/CANCELLED) + OperationItem برای تک‌تک موارد
 * ویژگی‌ها: ضربان قلب پردازشگر (heartbeat)، لغو نرم (cancelRequested)،
 * تلاش مجدد فقط موارد ناموفق، پاک‌سازی عملیات سرگردان پردازشگرِ قطع‌شده (sweep)
 *
 * قرارداد مالکیت: هر نوشتن پردازشگر پس از یک گارد اتمی «id + RUNNING» انجام می‌شود؛
 * اگر sweep عملیات را FAILED اعلام کرده باشد (قطع پردازشگر)، worker قدیمی که بعداً
 * از وقفه برمی‌گردد در نخستین گارد متوقف می‌شود و دیگر حق نوشتن ندارد.
 */
import { Prisma, PrismaClient } from '@prisma/client'
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

/** کلاینت اصلی یا کلاینت تراکنش Prisma */
type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * خطای «مالکیت عملیات از دست رفت»: پس از آن این پردازشگر حق هیچ نوشتنی ندارد
 * (sweep عملیات را FAILED اعلام کرده یا اجرای پیش از شروع لغو شده است).
 */
export class OwnershipLostError extends Error {
  constructor() {
    super('مالکیت اجرای عملیات از دست رفت؛ پردازشگر قدیمی متوقف شد.')
    this.name = 'OwnershipLostError'
  }
}

/**
 * گارد اتمی زنده‌ماندن عملیات: UPDATE شرطی روی OperationLog (id + RUNNING).
 * count=۰ یعنی عملیات دیگر مالِ این پردازشگر نیست — باید بدون نوشتن متوقف شود.
 * خود این فراخوانی ضربان قلب را نیز به‌روز می‌کند.
 */
export async function ensureOperationAlive(opId: string, client?: DbClient): Promise<void> {
  const c = client ?? db
  const touch = await c.operationLog.updateMany({
    where: { id: opId, status: 'RUNNING' },
    data: { heartbeatAt: new Date() },
  })
  if (touch.count === 0) throw new OwnershipLostError()
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

/** اجرای عملیات: پردازش ترتیبی آیتم‌ها با لغو نرم، ضربان قلب و گارد مالکیت در هر گام */
async function runOperation(opId: string): Promise<void> {
  // آغاز مشروط: اگر عملیات پیش از شروع لغو شده باشد (CANCELLED)، RUNNING سرگردان ساخته نمی‌شود
  const started = await db.operationLog
    .updateMany({
      where: { id: opId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date() },
    })
    .catch(() => ({ count: 0 }))
  if (started.count === 0) return

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

    try {
      // هر قلم در یک تراکنش اتمی: گارد مالکیت + اجرا + ثبت نتیجه — همه یا هیچ؛
      // اگر sweep عملیات را FAILED کرده باشد، worker قدیمی اینجا متوقف می‌شود.
      const after = await db.$transaction(async (tx) => {
        await ensureOperationAlive(opId, tx)
        const result = await runItem(tx, meta.type, item.refId, actor)
        await tx.operationItem.update({
          where: { id: item.id },
          data: { status: result.status, message: result.message },
        })
        return result.after
      })
      // اثرهای جانبی غیربحرانی (اعلان و ثبت فعالیت) پس از کامیت تراکنش
      if (after) await after()
    } catch (e) {
      if (e instanceof OwnershipLostError) {
        console.warn(`[operations] ownership lost for op ${opId}; stale worker aborted cleanly`)
        return // بدون نوشتن و بدون نهایی‌سازی — مالک تازه/سweep مسئول است
      }
      const message = e instanceof Error && e.message ? e.message : 'خطای نامشخص در اجرای مورد.'
      // ثبت شکست مورد نیز داخل گارد مالکیت
      try {
        await db.$transaction(async (tx) => {
          await ensureOperationAlive(opId, tx)
          await tx.operationItem.update({
            where: { id: item.id },
            data: { status: 'FAILED', message },
          })
        })
      } catch (e2) {
        if (e2 instanceof OwnershipLostError) {
          console.warn(`[operations] ownership lost for op ${opId}; stale worker aborted cleanly`)
          return
        }
        throw e2
      }
    }
  }

  await finishOperation(opId, wasCancelled)
}

/** اجرای یک مورد بر اساس نوع عملیات — نوشتن‌ها روی کلاینت تراکنش؛ اثرهای جانبی بعد از کامیت */
async function runItem(
  tx: Prisma.TransactionClient,
  opType: string,
  refId: string,
  actor: OperationActor
): Promise<{ status: 'SUCCEEDED' | 'FAILED'; message: string; after?: () => Promise<void> }> {
  const article = await tx.article.findUnique({
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
      await tx.article.update({
        where: { id: article.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), reviewNote: null },
      })
      // بستن کارهای باز مرتبط با مقاله (بازبینی/اصلاح)
      await tx.task.updateMany({
        where: { relatedType: 'ARTICLE', relatedId: article.id, type: { in: ['REVIEW', 'REVISION'] }, status: 'OPEN' },
        data: { status: 'DONE', doneAt: new Date() },
      })
      return {
        status: 'SUCCEEDED',
        message: 'منتشر شد.',
        after: async () => {
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
        },
      }
    }
    return { status: 'FAILED', message: publishBlockReason(article.status) }
  }

  if (opType === 'BULK_UNPUBLISH_ARTICLES') {
    if (article.status === 'PUBLISHED') {
      await tx.article.update({
        where: { id: article.id },
        data: { status: 'DRAFT', publishedAt: null },
      })
      return {
        status: 'SUCCEEDED',
        message: 'لغو انتشار شد.',
        after: async () => {
          await logActivity({
            userId: actor.id,
            userName: actor.name,
            action: 'UNPUBLISH',
            entityType: 'ARTICLE',
            entityId: article.id,
            entityTitle: article.title,
            details: 'لغو انتشار گروهی از مرکز عملیات',
          })
        },
      }
    }
    return { status: 'FAILED', message: 'مقاله منتشر نشده بود.' }
  }

  return { status: 'FAILED', message: 'نوع عملیات پشتیبانی نمی‌شود.' }
}

/** پایان عملیات: محاسبهٔ شمارنده‌ها، وضعیت نهایی، خلاصهٔ فارسی و فهرست خطاها — مشروط به مالکیت */
async function finishOperation(opId: string, wasCancelled: boolean): Promise<void> {
  const items = await db.operationItem.findMany({
    where: { operationId: opId },
    select: { status: true, label: true, message: true },
  })

  const done = items.filter((i) => i.status === 'SUCCEEDED').length
  const failed = items.filter((i) => i.status === 'FAILED').length
  const status = wasCancelled && done > 0 ? 'PARTIAL' : wasCancelled ? 'CANCELLED' : failed === 0 ? 'SUCCESS' : done === 0 ? 'FAILED' : 'PARTIAL'

  // نهایی‌سازی مشروط: فقط اگر عملیات هنوز RUNNING باشد (سweep/لغو پیشین حق نوشتن ما را گرفته)
  await db.operationLog
    .updateMany({
      where: { id: opId, status: 'RUNNING' },
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
