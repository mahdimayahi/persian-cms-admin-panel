/**
 * موتور اجرای بسته انتشار + الزام «اتصال نسخه» + قرارداد مالکیت اجرا
 *
 * قواعد کلیدی:
 * - هر قلم هنگام افزودن به بسته به یک ArticleVersion مشخص متصل می‌شود؛ شماره نسخه = جایگاه نسخه
 *   در ترتیب صعودی زمان ثبت (یک‌مبنا) و «آخرین نسخه» = آخرین عضو این ترتیب.
 * - اگر نسخه‌ای انتخاب نشده باشد یا مقاله هیچ نسخه‌ای نداشته باشد، هنگام افزودن قلم یک
 *   «اسنپ‌شات خودکار» از وضعیت زندهٔ مقاله ثبت می‌شود و همان نسخه متصل می‌گردد.
 * - «گارد نسخه» پیش از هر اجرا: نسخهٔ تأییدشده (approvedVersionId و در نبود آن versionId)
 *   باید همان آخرین نسخهٔ مقاله باشد و وضعیت مقاله هم APPROVED (یا PUBLISHED = قبلاً منتشرشده).
 *   در صورت مغایرت، اجرا آغاز نمی‌شود؛ تأیید بسته باطل و وضعیت به «در بررسی» بازمی‌گردد.
 * - «مالکیت اجرا»: ساخت OperationLog(RUNNING) → claim اتمی بسته با ثبت runOpId → گارد مالکیت
 *   درون تراکنش هر قلم → نهایی‌سازی مشروط به مالکیت. اجرای قدیمی که مالکیتش را از دست داده
 *   (reclaim اجرای معلق پس از قطع پردازشگر) در نخستین گارد متوقف می‌شود و دیگر نمی‌تواند بنویسد.
 * - شکست یک قلم هرگز پشت موفقیت کل پنهان نمی‌شود: نتیجهٔ هر قلم ثبت و وضعیت نهایی بسته
 *   می‌تواند PUBLISHED | PARTIAL | FAILED باشد.
 * - «تلاش مجدد» فقط قلم‌های FAILED را دوباره اجرا می‌کند؛ قلم‌های موفق قبلی SKIPPED ثبت می‌شوند.
 */
import { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api-utils'
import { logActivity, notifyUser } from '@/lib/audit'

export type BundleItemResult = {
  itemId: string
  articleId: string
  title: string
  result: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  message: string
}

export type ExecuteResult = {
  status: 'PUBLISHED' | 'PARTIAL' | 'FAILED'
  results: BundleItemResult[]
  opId: string
}

export type BundleActor = { id?: string; name: string }

/** برچسب فارسی وضعیت مقاله برای پیام‌های خطا */
export function articleStatusFa(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'پیش‌نویس'
    case 'IN_REVIEW':
      return 'در بررسی'
    case 'NEEDS_REVISION':
      return 'نیازمند اصلاح'
    case 'APPROVED':
      return 'تأییدشده'
    case 'PUBLISHED':
      return 'منتشرشده'
    case 'ARCHIVED':
      return 'بایگانی‌شده'
    default:
      return status
  }
}

// ─── نسخه‌ها و اتصال نسخه به اقلام ────────────────────────────────

/** فهرست نسخه‌های مقاله با ترتیب صعودی (شماره‌گذاری یک‌مبنا بر اساس همین ترتیب) */
export async function listArticleVersionsAsc(articleId: string) {
  return db.articleVersion.findMany({
    where: { articleId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, content: true, excerpt: true, editorName: true, note: true, createdAt: true },
  })
}

/** نگاشت شناسه نسخه → شماره نسخه (یک‌مبنا) از روی ترتیب صعودی */
export function versionNumberMap(ascVersions: { id: string }[]): Map<string, number> {
  const map = new Map<string, number>()
  ascVersions.forEach((v, i) => map.set(v.id, i + 1))
  return map
}

/**
 * حل اتصال نسخه برای یک قلم:
 * - versionIdInput برابر 'current' یا خالی، یا مقاله بدون نسخه → ثبت اسنپ‌شات خودکار از وضعیت
 *   زندهٔ مقاله (یادداشت «ثبت خودکار هنگام افزودن به بسته») و اتصال نسخهٔ تازه.
 * - در غیر این صورت نسخهٔ داده‌شده اعتبارسنجی می‌شود (باید متعلق به همان مقاله باشد).
 */
export async function resolveItemVersion(
  article: { id: string; title: string; content: string; excerpt: string },
  versionIdInput: unknown,
  actor: BundleActor
): Promise<{ versionId: string; versionNumber: number; created: boolean }> {
  const versions = await listArticleVersionsAsc(article.id)
  const wantCurrent =
    versionIdInput === undefined || versionIdInput === null || versionIdInput === '' || versionIdInput === 'current'

  if (wantCurrent || versions.length === 0) {
    const snapshot = await db.articleVersion.create({
      data: {
        articleId: article.id,
        title: article.title,
        content: article.content,
        excerpt: article.excerpt,
        editorId: actor.id ?? 'system',
        editorName: actor.name,
        note: 'ثبت خودکار هنگام افزودن به بسته',
      },
      select: { id: true },
    })
    return { versionId: snapshot.id, versionNumber: versions.length + 1, created: true }
  }

  const id = String(versionIdInput)
  const idx = versions.findIndex((v) => v.id === id)
  if (idx === -1) throw new ApiError(400, 'نسخه انتخاب‌شده معتبر نیست.')
  return { versionId: id, versionNumber: idx + 1, created: false }
}

// ─── گارد نسخه و ابطال تأیید ─────────────────────────────────────

/** مشکل گارد نسخه برای یک قلم */
export type GuardProblem = {
  itemId: string
  articleId: string
  articleTitle: string
  reason: string
}

/**
 * گارد نسخه پیش از اجرا:
 * برای هر قلم، نسخهٔ هدف (approvedVersionId و در نبود آن versionId) باید آخرین نسخهٔ مقاله باشد
 * و وضعیت مقاله هم باید APPROVED یا PUBLISHED (قبلاً منتشرشده) باشد.
 * هر مغایرت به‌معنای «تغییر نسخه پس از تأیید» است و اجرای کل بسته را متوقف می‌کند.
 */
export async function verifyApprovalVersionGuard(bundleId: string): Promise<GuardProblem[]> {
  const bundle = await db.publishBundle.findUnique({
    where: { id: bundleId },
    include: { items: { include: { article: { select: { id: true, title: true, status: true } } } } },
  })
  if (!bundle) throw new ApiError(404, 'بسته یافت نشد.')

  const problems: GuardProblem[] = []
  for (const item of bundle.items) {
    const targetId = item.approvedVersionId ?? item.versionId
    if (!targetId) {
      problems.push({
        itemId: item.id,
        articleId: item.articleId,
        articleTitle: item.article.title,
        reason: 'نسخه‌ای برای این قلم ثبت نشده است؛ نسخه را مشخص و بسته را دوباره تأیید کنید.',
      })
      continue
    }
    const versions = await listArticleVersionsAsc(item.articleId)
    const latest = versions[versions.length - 1]
    if (!latest || latest.id !== targetId) {
      const approvedNum = versions.findIndex((v) => v.id === targetId) + 1
      problems.push({
        itemId: item.id,
        articleId: item.articleId,
        articleTitle: item.article.title,
        reason:
          approvedNum > 0
            ? `تغییر نسخه پس از تأیید؛ نسخه تأییدشده: نسخه ${approvedNum}، نسخه فعلی مقاله: نسخه ${versions.length}.`
            : 'نسخهٔ ثبت‌شده برای این قلم حذف شده است؛ نسخه را دوباره انتخاب و بسته را تأیید کنید.',
      })
      continue
    }
    const st = item.article.status
    if (st !== 'APPROVED' && st !== 'PUBLISHED') {
      problems.push({
        itemId: item.id,
        articleId: item.articleId,
        articleTitle: item.article.title,
        reason: `وضعیت مقاله پس از تأیید تغییر کرده است (${articleStatusFa(st)})؛ انتشار ممکن نیست.`,
      })
    }
  }
  return problems
}

/**
 * ابطال تأیید بسته: وضعیت به «در بررسی» بازمی‌گردد، زمان‌بندی پاک و اسنپ‌شات تأیید اقلام خالی می‌شود.
 * تغییر اقلام/نسخه پس از تأیید یا شکست گارد نسخه از این مسیر عبور می‌کند و مسئول بسته مطلع می‌شود.
 */
export async function invalidateApproval(
  bundle: { id: string; title: string; ownerId: string | null; createdById: string },
  reason: string,
  actor: BundleActor
): Promise<void> {
  await db.publishBundle.update({
    where: { id: bundle.id },
    data: {
      status: 'IN_REVIEW',
      approvedAt: null,
      approvedById: null,
      approvedByName: null,
      scheduledAt: null,
    },
  })
  await db.bundleItem.updateMany({ where: { bundleId: bundle.id }, data: { approvedVersionId: null } })
  await db.bundleHistory.create({
    data: {
      bundleId: bundle.id,
      kind: 'APPROVAL_INVALIDATED',
      message: reason,
      userId: actor.id ?? null,
      userName: actor.name,
    },
  })
  const notifyId = bundle.ownerId ?? bundle.createdById
  if (notifyId) {
    await notifyUser(notifyId, {
      type: 'APPROVAL_INVALIDATED',
      title: 'تأیید بسته باطل شد',
      body: `بسته «${bundle.title}»: ${reason}`,
      link: '#/bundles',
    })
  }
}

// ─── اجرای بسته و قرارداد مالکیت ─────────────────────────────────

/** آستانهٔ مرگ پردازشگر برای اجرای معلق بسته — هماهنگ با STALE_MS در operations */
const BUNDLE_STALE_MS = 90_000

/**
 * خطای «مالکیت اجرا از دست رفت»: پس از آن این پردازشگر حق هیچ نوشتنی ندارد
 * (reclaim اجرای معلق opLog را FAILED کرده و پردازشگر تازه مالک شده است).
 */
export class OwnershipLostError extends Error {
  constructor() {
    super('مالکیت اجرا از دست رفت؛ پردازشگر قدیمی متوقف شد و اجازهٔ نوشتن ندارد.')
    this.name = 'OwnershipLostError'
  }
}

/** کلاینت اصلی یا کلاینت تراکنش Prisma */
type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * claim اتمی مالکیت اجرا: بسته فقط از وضعیت‌های مجاز به PUBLISHING با ثبت runOpId برده می‌شود.
 * دو درخواست موازی: دقیقاً یکی count=۱ می‌گیرد (مالک)؛ دیگری false می‌بیند و رد می‌شود.
 * در صورت false، opLog ایجادشده همان‌جا بسته می‌شود تا RUNNING سرگردان باقی نماند.
 */
export async function claimBundleRun(bundleId: string, opLogId: string, allowedFrom: string[]): Promise<boolean> {
  const claim = await db.publishBundle.updateMany({
    where: { id: bundleId, status: { in: allowedFrom } },
    data: { status: 'PUBLISHING', runOpId: opLogId },
  })
  if (claim.count !== 1) {
    await db.operationLog
      .updateMany({
        where: { id: opLogId, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          resultSummary: 'دریافت مالکیت اجرا ناموفق بود؛ اجرای هم‌زمان دیگری پیشی گرفت.',
        },
      })
      .catch(() => undefined)
    return false
  }
  return true
}

/**
 * ضربان قلب + گارد زنده‌ماندن مالکیت: اتمی روی OperationLog (id + RUNNING).
 * count=۰ یعنی reclaim این اجرا را FAILED کرده — پردازشگر قدیمی باید فوراً بدون نوشتن متوقف شود.
 * درون تراکنش هر قلم فراخوانی می‌شود تا هیچ نوشتنی بعد از از دست رفتن مالکیت رخ ندهد.
 */
export async function touchRunOwnership(opLogId: string, client?: DbClient): Promise<void> {
  const c = client ?? db
  const touch = await c.operationLog.updateMany({
    where: { id: opLogId, status: 'RUNNING' },
    data: { heartbeatAt: new Date() },
  })
  if (touch.count === 0) throw new OwnershipLostError()
}

/**
 * نهایی‌سازی وضعیت بسته — فقط اگر هنوز مالک اجرا باشیم (runOpId + وضعیت PUBLISHING).
 * worker قدیمی که مالکیت را از دست داده با این گارد هرگز نمی‌تواند وضعیت بسته را بازنویسی کند.
 */
export async function finalizeBundleRun(
  bundleId: string,
  opLogId: string,
  data: { status: string; publishedAt?: Date }
): Promise<boolean> {
  const res = await db.publishBundle.updateMany({
    where: { id: bundleId, runOpId: opLogId, status: 'PUBLISHING' },
    data: { status: data.status, ...(data.publishedAt ? { publishedAt: data.publishedAt } : {}) },
  })
  return res.count === 1
}

/**
 * بازیابی اجرای معلق: اگر بسته در وضعیت PUBLISHING رها شده باشد (قطع پردازشگر)،
 * رکورد عملیات RUNNING قدیمی بسته و وضعیت بسته بر اساس نتایج ثبت‌شدهٔ اقلام بازسازی می‌شود.
 * اگر اجرای جاری زنده باشد (ضربان تازه)، خطای ۴۰۹ برمی‌گردد.
 */
async function reclaimStaleBundleRun(bundleId: string): Promise<void> {
  const bundle = await db.publishBundle.findUnique({ where: { id: bundleId }, select: { status: true } })
  if (bundle?.status !== 'PUBLISHING') return

  const lastRunning = await db.operationLog.findFirst({
    where: { type: 'BUNDLE_PUBLISH', relatedId: bundleId, status: 'RUNNING' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, heartbeatAt: true, startedAt: true },
  })
  if (lastRunning) {
    const last = lastRunning.heartbeatAt ?? lastRunning.startedAt
    if (last && Date.now() - last.getTime() <= BUNDLE_STALE_MS) {
      throw new ApiError(409, 'بسته در حال انتشار است؛ تا پایان این اجرا صبر کنید.')
    }
    await db.operationLog.update({
      where: { id: lastRunning.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        resultSummary: 'اجرا پیشین بدون پایان‌رسیدن متوقف شد (قطع پردازشگر).',
      },
    })
  }

  // بازسازی وضعیت بسته از نتایج ثبت‌شدهٔ اقلام تا claim اتمی بعدی بتواند مالکیت بگیرد
  // (runOpId اجرای مرده نیز پاک می‌شود تا شناسهٔ مالک قبلی دیگر معنا نداشته باشد)
  const items = await db.bundleItem.findMany({ where: { bundleId }, select: { result: true } })
  const succeeded = items.filter((i) => i.result === 'SUCCESS').length
  const failed = items.filter((i) => i.result === 'FAILED').length
  const restored = failed > 0 ? (succeeded > 0 ? 'PARTIAL' : 'FAILED') : 'APPROVED'
  await db.publishBundle.update({ where: { id: bundleId }, data: { status: restored, runOpId: null } })
}

/** دلیل فارسی عدم امکان انتشار بر اساس وضعیت مقاله */
function publishBlockReason(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'مقاله هنوز پیش‌نویس است و برای انتشار باید تأیید شود.'
    case 'IN_REVIEW':
      return 'مقاله در صف بررسی است؛ ابتدا تأیید شود.'
    case 'NEEDS_REVISION':
      return 'مقاله نیازمند اصلاح است.'
    case 'ARCHIVED':
      return 'مقاله بایگانی‌شده است و قابل انتشار نیست.'
    default:
      return 'وضعیت مقاله برای انتشار مناسب نیست.'
  }
}

/**
 * اجرای بسته انتشار:
 * - فقط از وضعیت APPROVED/SCHEDULED (انتشار فوری) یا PARTIAL/FAILED (تلاش مجدد) فراخوانی شود.
 * - retryOnly: فقط قلم‌های FAILED دوباره اجرا می‌شوند؛ بقیه در گزارش با SKIPPED ثبت می‌شوند.
 * - هر قلم داخل یک تراکنش اتمی منتشر می‌شود (گارد مالکیت + گارد نسخه + تغییر وضعیت — همه یا هیچ)
 *   و نتیجه‌اش روی BundleItem و OperationItem ثبت می‌گردد.
 */
export async function executeBundle(
  bundleId: string,
  actor: BundleActor,
  opts?: { retryOnly?: boolean }
): Promise<ExecuteResult> {
  const retryOnly = opts?.retryOnly === true

  const bundle = await db.publishBundle.findUnique({
    where: { id: bundleId },
    include: { items: { include: { article: { select: { id: true, title: true, status: true, authorId: true } } } } },
  })
  if (!bundle) throw new ApiError(404, 'بسته یافت نشد.')
  if (bundle.items.length === 0) throw new ApiError(400, 'بسته هیچ قلمی ندارد؛ ابتدا قلم افزوده شود.')

  // تعیین قلم‌های هدف اجرا
  let targets = bundle.items
  let retryOfId: string | null = null
  if (retryOnly) {
    const failed = bundle.items.filter((it) => it.result === 'FAILED')
    if (failed.length === 0) {
      throw new ApiError(400, 'هیچ مورد ناموفقی برای تلاش مجدد وجود ندارد.')
    }
    targets = failed
    const lastOp = await db.operationLog.findFirst({
      where: { type: 'BUNDLE_PUBLISH', relatedId: bundleId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    retryOfId = lastOp?.id ?? null
  }

  // بازیابی اجرای معلق (قطع پردازشگر) — اجرای زنده با ۴۰۹ رد می‌شود
  await reclaimStaleBundleRun(bundleId)

  // گارد نسخه پیش از هر اجرا — هیچ اجرای جزئی پس از مغایرت نسخه آغاز نمی‌شود
  const problems = await verifyApprovalVersionGuard(bundleId)
  if (problems.length > 0) {
    await invalidateApproval(
      bundle,
      'تغییر نسخه پس از تأیید؛ تأیید بسته باطل شد و برای بررسی مجدد بازگشت.',
      actor
    )
    throw new ApiError(409, 'تأیید بسته باطل شد؛ نسخه برخی قلم‌ها پس از تأیید تغییر کرده است.', {
      problems,
    })
  }

  // opLog پیش از claim ساخته می‌شود (RUNNING) و مبنای گارد مالکیت هر قلم است؛
  // اگر claim شکست بخورد، همان‌جا FAILED می‌شود تا RUNNING سرگردان باقی نماند.
  const opLog = await db.operationLog.create({
    data: {
      type: 'BUNDLE_PUBLISH',
      title: `انتشار بسته «${bundle.title}»`,
      status: 'RUNNING',
      totalItems: targets.length,
      initiatorId: actor.id ?? null,
      initiatorName: actor.name,
      relatedId: bundleId,
      retryOfId,
      startedAt: new Date(),
      heartbeatAt: new Date(),
    },
  })

  // مالکیت اتمی اجرا: فقط یک درخواست می‌تواند بسته را با ثبت runOpId به PUBLISHING ببرد؛
  // درخواست هم‌زمان دوم شمارش صفر می‌گیرد و با ۴۰۹ رد می‌شود.
  const claimed = await claimBundleRun(
    bundleId,
    opLog.id,
    retryOnly ? ['PARTIAL', 'FAILED'] : ['APPROVED', 'SCHEDULED']
  )
  if (!claimed) {
    throw new ApiError(409, 'بسته در حال اجراست یا وضعیت آن برای اجرا مجاز نیست.')
  }

  const results: BundleItemResult[] = []
  // اگر در میانهٔ اجرا مالکیت از دست برود (reclaim اجرای معلق)، حلقه بدون هیچ نوشتنی ترک می‌شود
  let ownershipLost = false

  for (const item of bundle.items) {
    const article = item.article
    const title = article.title

    // در تلاش مجدد، قلم‌های موفق قبلی اجرا نمی‌شوند — فقط در گزارش صرف‌نظر ثبت می‌شوند
    if (retryOnly && item.result !== 'FAILED') {
      const msg = 'در تلاش قبلی موفق بود.'
      results.push({ itemId: item.id, articleId: article.id, title, result: 'SKIPPED', message: msg })
      await db.operationItem.create({
        data: {
          operationId: opLog.id,
          refType: 'ARTICLE',
          refId: article.id,
          label: title,
          status: 'SKIPPED',
          message: msg,
        },
      })
      continue
    }

    try {
      // هر قلم در یک تراکنش اتمی:
      //  ۱) گارد مالکیت (touch روی opLog خودمان) — اگر reclaim شده باشد تراکنش خنثی می‌شود
      //  ۲) گارد نسخه در لحظهٔ انتشار — بازخوانی وضعیت/نسخه داخل همان تراکنش (بدون پنجرهٔ رقابت)
      //  ۳) تغییر وضعیت مقاله + بستن کارها + ثبت نتیجهٔ قلم — همه یا هیچ
      await db.$transaction(async (tx) => {
        await touchRunOwnership(opLog.id, tx)

        const fresh = await tx.article.findUnique({
          where: { id: article.id },
          select: { id: true, status: true },
        })
        if (!fresh) throw new Error('مقاله یافت نشد.')

        if (fresh.status === 'PUBLISHED') {
          const msg = 'از قبل منتشر شده بود.'
          results.push({ itemId: item.id, articleId: article.id, title, result: 'SUCCESS', message: msg })
          await tx.bundleItem.update({ where: { id: item.id }, data: { result: 'SUCCESS', message: msg } })
          return
        }

        if (fresh.status === 'APPROVED') {
          const versions = await tx.articleVersion.findMany({
            where: { articleId: article.id },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true },
          })
          const latest = versions[versions.length - 1]
          const targetId = item.approvedVersionId ?? item.versionId
          if (!targetId || !latest || latest.id !== targetId) {
            throw new Error('تغییر نسخه پس از تأیید؛ انتشار این قلم متوقف شد تا نسخهٔ تأییدنشده منتشر نشود.')
          }
          await tx.article.update({
            where: { id: article.id },
            data: { status: 'PUBLISHED', publishedAt: new Date(), reviewNote: null },
          })
          await tx.task.updateMany({
            where: { relatedType: 'ARTICLE', relatedId: article.id, type: { in: ['REVIEW', 'REVISION'] }, status: 'OPEN' },
            data: { status: 'DONE', doneAt: new Date() },
          })
          const msg = 'منتشر شد.'
          results.push({ itemId: item.id, articleId: article.id, title, result: 'SUCCESS', message: msg })
          await tx.bundleItem.update({ where: { id: item.id }, data: { result: 'SUCCESS', message: msg } })
          return
        }

        const msg = publishBlockReason(fresh.status)
        results.push({ itemId: item.id, articleId: article.id, title, result: 'FAILED', message: msg })
        await tx.bundleItem.update({ where: { id: item.id }, data: { result: 'FAILED', message: msg } })
      })

      // اعلان و فعالیت پس از کامیتِ تراکنش قلم (اثر جانبی غیربحرانی)
      const last = results[results.length - 1]
      if (last?.result === 'SUCCESS' && last.message === 'منتشر شد.') {
        await notifyUser(article.authorId, {
          type: 'PUBLISHED',
          title: 'مقاله شما منتشر شد',
          body: `«${title}» از طریق بسته انتشار «${bundle.title}» منتشر شد.`,
          link: '#/articles',
        })
        await logActivity({
          userId: actor.id ?? null,
          userName: actor.name,
          action: 'PUBLISH',
          entityType: 'ARTICLE',
          entityId: article.id,
          entityTitle: title,
          details: `انتشار از طریق بسته «${bundle.title}»`,
        })
      }
    } catch (e) {
      if (e instanceof OwnershipLostError) {
        ownershipLost = true
        console.warn(`[bundle-runner] ownership lost for bundle ${bundleId}; stale worker ${opLog.id} aborted cleanly`)
        break
      }
      const msg = e instanceof Error ? e.message : 'خطای نامشخص در انتشار.'
      // ثبت شکست قلم نیز باید داخل گارد مالکیت باشد
      try {
        await db.$transaction(async (tx) => {
          await touchRunOwnership(opLog.id, tx)
          results.push({ itemId: item.id, articleId: article.id, title, result: 'FAILED', message: msg })
          await tx.bundleItem.update({ where: { id: item.id }, data: { result: 'FAILED', message: msg } })
        })
      } catch (e2) {
        if (e2 instanceof OwnershipLostError) {
          ownershipLost = true
          console.warn(`[bundle-runner] ownership lost for bundle ${bundleId}; stale worker ${opLog.id} aborted cleanly`)
          break
        }
        throw e2
      }
    }
  }

  if (ownershipLost) {
    // پردازشگر تازه مسئول نهایی‌سازی است؛ این اجرا فقط بدون نوشتن خارج می‌شود
    return { status: 'FAILED', results, opId: opLog.id }
  }

  // ثبت نتیجهٔ تک‌تک اقلام در گزارش عملیات
  const skippedMsg = 'در تلاش قبلی موفق بود.'
  await db.operationItem.createMany({
    data: results.map((r) => ({
      operationId: opLog.id,
      refType: 'ARTICLE',
      refId: r.articleId,
      label: r.title,
      status: r.result === 'SUCCESS' ? 'SUCCEEDED' : r.result,
      message: r.message,
    })),
  })

  const successCount = results.filter((r) => r.result === 'SUCCESS').length
  const failCount = results.filter((r) => r.result === 'FAILED').length
  const skippedCount = results.filter((r) => r.result === 'SKIPPED' && r.message === skippedMsg).length

  const finalStatus: 'PUBLISHED' | 'PARTIAL' | 'FAILED' =
    failCount === 0 && successCount > 0 ? 'PUBLISHED' : successCount === 0 ? 'FAILED' : 'PARTIAL'

  const opStatus = failCount === 0 && successCount > 0 ? 'SUCCESS' : successCount > 0 ? 'PARTIAL' : 'FAILED'

  // نهایی‌سازی مشروط به مالکیت: worker قدیمی حتی اگر تا اینجا زنده مانده باشد نمی‌تواند بنویسد
  const finalized = await finalizeBundleRun(bundleId, opLog.id, {
    status: finalStatus,
    ...(successCount > 0 && !bundle.publishedAt ? { publishedAt: new Date() } : {}),
  })
  if (!finalized) {
    console.warn(`[bundle-runner] finalize skipped for bundle ${bundleId}: run ${opLog.id} no longer owns the bundle`)
    return { status: 'FAILED', results, opId: opLog.id }
  }

  // ثبت نتیجهٔ نهایی opLog نیز گارد مالکیت دارد (اگر reclaim شده باشد دست‌نخورده می‌ماند)
  await db.operationLog.updateMany({
    where: { id: opLog.id, status: 'RUNNING' },
    data: {
      status: opStatus,
      doneItems: successCount,
      failedItems: failCount,
      resultSummary: `${successCount} مورد موفق، ${failCount} مورد ناموفق${
        skippedCount > 0 ? `، ${skippedCount} مورد صرف‌نظر` : ''
      }`,
      errorsJson: JSON.stringify(
        results
          .filter((r) => r.result === 'FAILED')
          .map((r) => ({ item: r.title, reason: r.message }))
      ),
      finishedAt: new Date(),
    },
  })

  const summaryMsg = `نتیجه: ${successCount} موفق، ${failCount} ناموفق${
    skippedCount > 0 ? `، ${skippedCount} صرف‌نظر` : ''
  } — وضعیت بسته: ${
    finalStatus === 'PUBLISHED' ? 'منتشرشده' : finalStatus === 'PARTIAL' ? 'انتشار جزئی' : 'ناموفق'
  }`

  await db.bundleHistory.create({
    data: {
      bundleId,
      kind: retryOnly ? 'RETRY' : 'RUN',
      message: summaryMsg,
      userId: actor.id ?? null,
      userName: actor.name,
    },
  })

  return { status: finalStatus, results, opId: opLog.id }
}

// ─── زمان‌بند تنبل ────────────────────────────────────────────────

/**
 * اجرای بسته‌های زمان‌بندی‌شده‌ای که موعدشان رسیده است (فراخوانی تنبل هنگام دسترسی).
 * پیش از اجرا گارد نسخه بررسی می‌شود؛ در صورت مغایرت، تأیید باطل و مسئول بسته مطلع می‌شود
 * و بسته اجرا نمی‌شود (وضعیت به «در بررسی» بازمی‌گردد).
 */
export async function runDueScheduledBundles(): Promise<number> {
  const due = await db.publishBundle.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
    select: { id: true, title: true, ownerId: true, createdById: true },
    orderBy: { scheduledAt: 'asc' },
    take: 5,
  })
  let ran = 0
  for (const b of due) {
    try {
      const problems = await verifyApprovalVersionGuard(b.id)
      if (problems.length > 0) {
        await invalidateApproval(
          b,
          'تغییر نسخه پس از تأیید؛ زمان‌بندی لغو و بسته برای بررسی مجدد بازگشت.',
          { name: 'سیستم' }
        )
        continue
      }
      const res = await executeBundle(b.id, { name: 'زمان‌بندی‌شده' })
      ran++
      const notifyId = b.ownerId ?? b.createdById
      const summary = `${res.results.filter((r) => r.result === 'SUCCESS').length} مورد موفق، ${res.results.filter(
        (r) => r.result === 'FAILED'
      ).length} مورد ناموفق`
      if (notifyId) {
        await notifyUser(notifyId, {
          type: 'PUBLISHED',
          title: 'بسته زمان‌بندی‌شده اجرا شد',
          body: `بسته «${b.title}» در موعد مقرر منتشر شد (${summary}).`,
          link: '#/bundles',
        })
      }
    } catch (e) {
      console.error('[bundle-runner] scheduled execution failed', e)
    }
  }
  return ran
}
