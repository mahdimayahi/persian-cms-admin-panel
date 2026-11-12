/**
 * عملیات روی یک بسته انتشار
 *
 * GET    /api/bundles/[id] — جزئیات کامل بسته (اقلام با نسخه‌ها، بررسی آمادگی، سابقه، اجراها)
 * PATCH  /api/bundles/[id] — ویرایش { title?, note?, ownerId?, scheduledAt? (''|null = لغو زمان‌بندی),
 *                             addedItems?: [{ articleId, versionId?: 'current'|id, label? }],
 *                             removedItemIds?: string[],
 *                             itemUpdates?: [{ itemId, versionId?: 'current'|id, label? }] }
 * POST   /api/bundles/[id] — اقدام‌ها { action: 'READINESS' | 'SEND_TO_REVIEW' | 'APPROVE' | 'PUBLISH' | 'RETRY' | 'CANCEL' | 'CANCEL_SCHEDULE' }
 * DELETE /api/bundles/[id] — حذف بسته (سازنده یا مجوز انتشار؛ نه هنگام انتشار جاری)
 *
 * قاعدهٔ ابطال تأیید: تغییر اقلام/نسخه در وضعیت APPROVED/SCHEDULED → بازگشت خودکار به IN_REVIEW
 * + سابقهٔ APPROVAL_INVALIDATED + اعلان مسئول بسته. تغییر زمان انتشار ابطال نمی‌شود (فقط جابه‌جایی موعد).
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString, vEnum } from '@/lib/api-utils'
import { logActivity, notifyUsers, notifyUser } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'
import { executeBundle, resolveItemVersion, versionNumberMap, listArticleVersionsAsc } from '@/lib/bundle-runner'
import { runBundleReadiness, type ReadinessCheck } from '@/lib/bundle-readiness'

const BUNDLE_ACTIONS = ['READINESS', 'SEND_TO_REVIEW', 'APPROVE', 'PUBLISH', 'RETRY', 'CANCEL', 'CANCEL_SCHEDULE'] as const

/** برچسب فارسی زمان به وقت تهران (با بازگشت به ISO در محیط‌های بدون ICU کامل) */
function tehranLabel(d: Date): string {
  try {
    const s = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
    return `${s} (Asia/Tehran)`
  } catch {
    return d.toISOString()
  }
}

type DetailBundle = NonNullable<Awaited<ReturnType<typeof loadDetailBundle>>>

async function loadDetailBundle(id: string) {
  const bundle = await db.publishBundle.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { addedAt: 'asc' },
        include: { article: { select: { id: true, title: true, slug: true, status: true } } },
      },
    },
  })
  if (!bundle) throw new ApiError(404, 'بسته یافت نشد.')
  return bundle
}

/** نسخه‌های همه مقالات بسته با ترتیب صعودی (شماره‌گذاری یک‌مبنا) */
async function loadVersionsMap(articleIds: string[]) {
  const ids = Array.from(new Set(articleIds))
  const map = new Map<string, { id: string }[]>()
  if (ids.length === 0) return map
  const versions = await db.articleVersion.findMany({
    where: { articleId: { in: ids } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, articleId: true },
  })
  for (const v of versions) {
    const list = map.get(v.articleId) ?? []
    list.push({ id: v.id })
    map.set(v.articleId, list)
  }
  return map
}

/** ساخت پاسخ کامل جزئیات بسته (اقلام + آمادگی + سابقه + اجراها) */
async function buildDetail(id: string) {
  const bundle = await loadDetailBundle(id)
  const versionsMap = await loadVersionsMap(bundle.items.map((it) => it.articleId))

  const [history, runs] = await Promise.all([
    db.bundleHistory.findMany({ where: { bundleId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.operationLog.findMany({
      where: { type: 'BUNDLE_PUBLISH', relatedId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { items: { orderBy: { createdAt: 'asc' } } },
    }),
  ])

  let readinessChecks: ReadinessCheck[] = []
  try {
    readinessChecks = JSON.parse(bundle.readinessJson || '[]') as ReadinessCheck[]
  } catch {
    readinessChecks = []
  }

  return {
    id: bundle.id,
    title: bundle.title,
    note: bundle.note,
    status: bundle.status,
    ownerId: bundle.ownerId,
    ownerName: bundle.ownerName,
    scheduledAt: bundle.scheduledAt,
    timezone: bundle.timezone,
    publishedAt: bundle.publishedAt,
    approvedAt: bundle.approvedAt,
    approvedById: bundle.approvedById,
    approvedByName: bundle.approvedByName,
    readinessState: bundle.readinessState,
    createdById: bundle.createdById,
    createdByName: bundle.createdByName,
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt,
    items: bundle.items.map((it) => {
      const versions = versionsMap.get(it.articleId) ?? []
      const nums = versionNumberMap(versions)
      return {
        id: it.id,
        articleId: it.articleId,
        articleTitle: it.article.title,
        articleStatus: it.article.status,
        slug: it.article.slug,
        label: it.label,
        versionId: it.versionId,
        versionNumber: it.versionId ? (nums.get(it.versionId) ?? null) : null,
        latestVersionNumber: versions.length > 0 ? versions.length : null,
        approvedVersionId: it.approvedVersionId,
        approvedVersionNumber: it.approvedVersionId ? (nums.get(it.approvedVersionId) ?? null) : null,
        result: it.result,
        message: it.message,
        addedAt: it.addedAt,
        snapshotStatus: it.snapshotStatus,
      }
    }),
    readiness: { state: bundle.readinessState, checks: readinessChecks },
    history,
    runs,
  }
}

// ─── GET: جزئیات بسته ────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('articles.view')
    const { id } = await params
    return ok(await buildDetail(id))
  } catch (err) {
    return handleApiError(err)
  }
}

// ─── PATCH: ویرایش بسته و اقلام ──────────────────────────────────

interface ItemMutationInput {
  articleId?: unknown
  versionId?: unknown
  label?: unknown
}

interface ItemUpdateInput {
  itemId?: unknown
  versionId?: unknown
  label?: unknown
}

interface PatchBody {
  title?: unknown
  note?: unknown
  ownerId?: unknown
  scheduledAt?: unknown
  addedItems?: unknown
  removedItemIds?: unknown
  itemUpdates?: unknown
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.create')
    const bundle = await loadDetailBundle(id)

    if (bundle.status === 'PUBLISHING') {
      throw new ApiError(409, 'بسته در حال انتشار است و قابل تغییر نیست.')
    }

    const body = await parseBody<PatchBody>(req)

    const addedItems = Array.isArray(body.addedItems)
      ? (body.addedItems.filter((it): it is ItemMutationInput => !!it && typeof it === 'object') as ItemMutationInput[])
      : []
    const removedItemIds = Array.isArray(body.removedItemIds)
      ? (body.removedItemIds.filter((v): v is string => typeof v === 'string' && v.trim() !== '') as string[])
      : []
    const itemUpdates = Array.isArray(body.itemUpdates)
      ? (body.itemUpdates.filter((it): it is ItemUpdateInput => !!it && typeof it === 'object') as ItemUpdateInput[])
      : []

    const itemMutating = addedItems.length > 0 || removedItemIds.length > 0 || itemUpdates.length > 0

    // تغییر اقلام فقط در وضعیت‌های پیش از انتشار ممکن است
    if (itemMutating && !['DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED'].includes(bundle.status)) {
      throw new ApiError(409, 'در وضعیت فعلی بسته نمی‌توان اقلام را تغییر داد. برای اصلاح، بسته جدیدی بسازید.')
    }

    // ابطال تأیید: تغییر اقلام/نسخه در وضعیت تأییدشده/زمان‌بندی‌شده → بازگشت به «در بررسی»
    const willInvalidate = itemMutating && ['APPROVED', 'SCHEDULED'].includes(bundle.status)
    if (willInvalidate) {
      await invalidateBundleApproval(bundle, `تغییر اقلام بسته پس از تأیید؛ تأیید باطل شد.`, user)
    }

    const data: Record<string, unknown> = {}
    const metaMessages: string[] = []

    if (body.title !== undefined) {
      const title = vString(body.title, 'عنوان بسته', { required: true, min: 3, max: 150 })
      if (title !== bundle.title) metaMessages.push('عنوان بسته به‌روزرسانی شد')
      data.title = title
    }
    if (body.note !== undefined) {
      const note = vString(body.note, 'توضیح', { max: 500 })
      if (note !== bundle.note) metaMessages.push('توضیح بسته به‌روزرسانی شد')
      data.note = note
    }
    if (body.ownerId !== undefined) {
      if (body.ownerId === null || body.ownerId === '') {
        if (bundle.ownerId) metaMessages.push('مسئول بسته حذف شد')
        data.ownerId = null
        data.ownerName = null
      } else {
        const owner = await db.user.findUnique({
          where: { id: String(body.ownerId) },
          select: { id: true, name: true, status: true },
        })
        if (!owner) throw new ApiError(400, 'مسئول انتخاب‌شده معتبر نیست.')
        if (owner.status !== 'ACTIVE') throw new ApiError(400, 'مسئول بسته باید کاربر فعالی باشد.')
        if (owner.id !== bundle.ownerId) metaMessages.push(`مسئول بسته به «${owner.name}» تغییر کرد`)
        data.ownerId = owner.id
        data.ownerName = owner.name
      }
    }

    // ── تغییر اقلام: افزودن ──
    const itemMessages: { kind: string; message: string }[] = []
    if (addedItems.length > 0) {
      const existingIds = new Set(bundle.items.map((it) => it.articleId))
      for (const input of addedItems) {
        const articleId = typeof input.articleId === 'string' ? input.articleId.trim() : ''
        if (!articleId) throw new ApiError(400, 'شناسه مقاله برای افزودن قلم الزامی است.')
        const article = await db.article.findUnique({
          where: { id: articleId },
          select: { id: true, title: true, status: true, content: true, excerpt: true },
        })
        if (!article) throw new ApiError(400, 'یکی از مقالات انتخاب‌شده یافت نشد.')
        if (existingIds.has(article.id)) {
          throw new ApiError(409, `مقاله «${article.title}» قبلاً در بسته وجود دارد.`)
        }
        existingIds.add(article.id)
        const label = input.label ? vString(input.label, 'نقش قلم', { max: 120 }) : ''
        const bound = await resolveItemVersion(article, input.versionId ?? 'current', user)
        await db.bundleItem.create({
          data: {
            bundleId: id,
            articleId: article.id,
            versionId: bound.versionId,
            versionNumber: bound.versionNumber,
            label,
            snapshotStatus: article.status,
          },
        })
        itemMessages.push({
          kind: 'ITEM_ADDED',
          message: `قلم «${article.title}» با نسخه ${bound.versionNumber}${
            bound.created ? ' (ثبت خودکار)' : ''
          } افزوده شد${label ? ` با نقش «${label}»` : ''}.`,
        })
      }
    }

    // ── تغییر اقلام: حذف ──
    if (removedItemIds.length > 0) {
      for (const itemId of removedItemIds) {
        const item = bundle.items.find((it) => it.id === itemId)
        if (!item) throw new ApiError(400, 'یکی از اقلام انتخاب‌شده برای حذف در این بسته یافت نشد.')
        await db.bundleItem.delete({ where: { id: item.id } })
        itemMessages.push({ kind: 'ITEM_REMOVED', message: `قلم «${item.article.title}» حذف شد.` })
      }
    }

    // ── تغییر اقلام: نسخه/نقش ──
    for (const update of itemUpdates) {
      const itemId = typeof update.itemId === 'string' ? update.itemId : ''
      if (!itemId) throw new ApiError(400, 'شناسه قلم برای به‌روزرسانی الزامی است.')
      const item = bundle.items.find((it) => it.id === itemId)
      if (!item) throw new ApiError(400, 'یکی از اقلام انتخاب‌شده برای به‌روزرسانی در این بسته یافت نشد.')

      const itemData: { versionId?: string; versionNumber?: number; label?: string } = {}

      if (update.versionId !== undefined && update.versionId !== '') {
        const article = await db.article.findUnique({
          where: { id: item.articleId },
          select: { id: true, title: true, status: true, content: true, excerpt: true },
        })
        if (!article) throw new ApiError(400, 'مقاله این قلم یافت نشد.')
        const bound = await resolveItemVersion(article, update.versionId, user)
        if (bound.versionId !== item.versionId) {
          const oldNums = versionNumberMap(await listArticleVersionsAsc(item.articleId))
          const oldNum = item.versionId ? (oldNums.get(item.versionId) ?? 0) : 0
          itemData.versionId = bound.versionId
          itemData.versionNumber = bound.versionNumber
          itemMessages.push({
            kind: 'ITEM_VERSION_SET',
            message: `نسخه قلم «${article.title}» از ${oldNum > 0 ? `نسخه ${oldNum}` : 'بدون نسخه'} به نسخه ${bound.versionNumber}${
              bound.created ? ' (ثبت خودکار)' : ''
            } تغییر کرد.`,
          })
        }
      }

      if (update.label !== undefined) {
        const label = vString(update.label, 'نقش قلم', { max: 120 })
        if (label !== item.label) {
          itemData.label = label
          itemMessages.push({
            kind: 'UPDATED',
            message: `نقش قلم «${item.article.title}» به ${label ? `«${label}»` : 'خالی'} تغییر کرد.`,
          })
        }
      }

      if (Object.keys(itemData).length > 0) {
        await db.bundleItem.update({ where: { id: item.id }, data: itemData })
      }
    }

    // ── زمان‌بندی انتشار ──
    if (body.scheduledAt !== undefined) {
      if (!roleHasPermission(user.role, 'articles.publish')) {
        throw new ApiError(403, 'زمان‌بندی انتشار نیاز به مجوز انتشار دارد.')
      }
      if (body.scheduledAt === null || body.scheduledAt === '') {
        data.scheduledAt = null
        if (bundle.status === 'SCHEDULED' && !willInvalidate) {
          data.status = 'APPROVED'
          itemMessages.push({
            kind: 'SCHEDULE_CANCELLED',
            message: 'زمان‌بندی انتشار لغو شد؛ بسته به وضعیت تأییدشده بازگشت.',
          })
        }
      } else {
        const d = new Date(String(body.scheduledAt))
        if (Number.isNaN(d.getTime())) throw new ApiError(400, 'زمان انتشار نامعتبر است.')
        const effectiveStatus = willInvalidate ? 'IN_REVIEW' : bundle.status
        if (effectiveStatus === 'IN_REVIEW') {
          throw new ApiError(409, 'ابتدا بسته را تأیید کنید؛ سپس زمان انتشار را تنظیم نمایید.')
        }
        if (!['APPROVED', 'SCHEDULED'].includes(effectiveStatus)) {
          throw new ApiError(409, 'زمان‌بندی انتشار فقط برای بسته تأییدشده مجاز است.')
        }
        data.scheduledAt = d
        data.status = 'SCHEDULED'
        itemMessages.push({ kind: 'SCHEDULE_SET', message: `زمان انتشار تنظیم شد: ${tehranLabel(d)}` })
      }
    }

    // اعمال تغییرات متادیتا/وضعیت
    if (Object.keys(data).length > 0) {
      await db.publishBundle.update({ where: { id }, data })
    }

    // ثبت سابقه
    if (metaMessages.length > 0) {
      await db.bundleHistory.create({
        data: { bundleId: id, kind: 'UPDATED', message: metaMessages.join('، ') + '.', userId: user.id, userName: user.name },
      })
    }
    for (const msg of itemMessages) {
      await db.bundleHistory.create({
        data: { bundleId: id, kind: msg.kind, message: msg.message, userId: user.id, userName: user.name },
      })
    }

    // به‌روزرسانی خودکار بررسی آمادگی پس از تغییر اقلام (غیرمسدودکننده)
    if (itemMutating) {
      try {
        await runBundleReadiness(id, user)
      } catch (e) {
        console.error('[bundles] readiness after patch failed', e)
      }
    }

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'PUBLISH_BUNDLE',
      entityId: id,
      entityTitle: (data.title as string) ?? bundle.title,
      details: itemMutating ? 'ویرایش اقلام بسته انتشار' : 'به‌روزرسانی بسته انتشار',
    })

    return ok(await buildDetail(id))
  } catch (err) {
    return handleApiError(err)
  }
}

// ─── POST: اقدام‌های وضعیت ────────────────────────────────────────

interface ActionBody {
  action?: unknown
}

/** ابطال تأیید داخل این فایل (با پاک‌سازی اسنپ‌شات اقلام) — از موتور اجرا نیز استفاده می‌شود */
async function invalidateBundleApproval(
  bundle: { id: string; title: string; ownerId: string | null; createdById: string },
  reason: string,
  actor: { id?: string; name: string }
) {
  await db.publishBundle.update({
    where: { id: bundle.id },
    data: { status: 'IN_REVIEW', approvedAt: null, approvedById: null, approvedByName: null, scheduledAt: null },
  })
  await db.bundleItem.updateMany({ where: { bundleId: bundle.id }, data: { approvedVersionId: null } })
  await db.bundleHistory.create({
    data: { bundleId: bundle.id, kind: 'APPROVAL_INVALIDATED', message: reason, userId: actor.id ?? null, userName: actor.name },
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    let body: ActionBody = {}
    try {
      body = await parseBody<ActionBody>(req)
    } catch {
      body = {}
    }
    const action = vEnum(body.action, BUNDLE_ACTIONS, 'اقدام')

    // ── بررسی آمادگی (هر بیننده‌ای با مجوز مشاهده) ──
    if (action === 'READINESS') {
      const user = await requirePermission('articles.view')
      const readiness = await runBundleReadiness(id, user)
      return ok({ readiness, detail: await buildDetail(id) })
    }

    // ── ارسال برای بررسی ──
    if (action === 'SEND_TO_REVIEW') {
      const user = await requirePermission('articles.create')
      const bundle = await loadDetailBundle(id)
      if (bundle.status !== 'DRAFT') {
        throw new ApiError(409, 'فقط بسته پیش‌نویس برای بررسی ارسال می‌شود.')
      }
      await db.publishBundle.update({ where: { id }, data: { status: 'IN_REVIEW' } })
      await db.bundleHistory.create({
        data: { bundleId: id, kind: 'SENT_TO_REVIEW', message: 'بسته برای بررسی ارسال شد.', userId: user.id, userName: user.name },
      })
      await notifyUsers(['ADMIN', 'EDITOR'], {
        type: 'REVIEW_REQUEST',
        title: 'بسته‌ای برای بررسی ارسال شد',
        body: `بسته «${bundle.title}» توسط ${user.name} برای بررسی ارسال شد.`,
        link: '#/bundles',
        excludeUserId: user.id,
      })
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'SEND_TO_REVIEW',
        entityType: 'PUBLISH_BUNDLE',
        entityId: id,
        entityTitle: bundle.title,
        details: 'ارسال بسته برای بررسی',
      })
      return ok(await buildDetail(id))
    }

    // ── تأیید بسته (نیازمند اسنپ‌شات نسخه‌ها) ──
    if (action === 'APPROVE') {
      const user = await requirePermission('articles.review')
      const bundle = await loadDetailBundle(id)

      if (bundle.status === 'APPROVED') throw new ApiError(409, 'بسته قبلاً تأیید شده است.')
      if (bundle.status === 'SCHEDULED') {
        throw new ApiError(409, 'بسته زمان‌بندی‌شده است؛ ابتدا زمان‌بندی را لغو کنید.')
      }
      if (!['DRAFT', 'IN_REVIEW'].includes(bundle.status)) {
        throw new ApiError(409, 'این بسته در وضعیت فعلی قابل تأیید نیست.')
      }

      // ارسال خودکار برای بررسی در صورت پیش‌نویس بودن
      if (bundle.status === 'DRAFT') {
        await db.publishBundle.update({ where: { id }, data: { status: 'IN_REVIEW' } })
        await db.bundleHistory.create({
          data: { bundleId: id, kind: 'SENT_TO_REVIEW', message: 'بسته هنگام تأیید، به‌صورت خودکار برای بررسی ثبت شد.', userId: user.id, userName: user.name },
        })
      }

      // بازمحاسبه آمادگی؛ مسدود → تأیید ممنوع
      const readiness = await runBundleReadiness(id, user)
      if (readiness.state === 'BLOCKED') {
        throw new ApiError(409, 'بررسی آمادگی بسته مسدود است؛ ابتدا موارد خطا را برطرف کنید.', { readiness })
      }

      const now = new Date()
      await db.publishBundle.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: now, approvedById: user.id, approvedByName: user.name },
      })
      // اسنپ‌شات نسخهٔ تأییدشده: فقط همین نسخه‌ها در اجرا منتشر می‌شوند
      for (const item of bundle.items) {
        if (item.versionId) {
          await db.bundleItem.update({ where: { id: item.id }, data: { approvedVersionId: item.versionId } })
        }
      }
      await db.bundleHistory.create({
        data: {
          bundleId: id,
          kind: 'APPROVED',
          message:
            readiness.state === 'READY_WARNINGS'
              ? 'تأیید بسته با هشدار (نتیجهٔ بررسی آمادگی: آماده با هشدار).'
              : 'تأیید بسته پس از بررسی آمادگی.',
          userId: user.id,
          userName: user.name,
        },
      })
      const notifyId = bundle.ownerId && bundle.ownerId !== user.id ? bundle.ownerId : null
      if (notifyId) {
        await notifyUser(notifyId, {
          type: 'APPROVED',
          title: 'بسته شما تأیید شد',
          body: `بسته «${bundle.title}» توسط ${user.name} تأیید شد و آماده انتشار است.`,
          link: '#/bundles',
        })
      }
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'APPROVE',
        entityType: 'PUBLISH_BUNDLE',
        entityId: id,
        entityTitle: bundle.title,
        details: 'تأیید بسته انتشار',
      })
      return ok({ detail: await buildDetail(id), readiness })
    }

    // ── انتشار فوری ──
    if (action === 'PUBLISH') {
      const user = await requirePermission('articles.publish')
      const bundle = await loadDetailBundle(id)
      if (bundle.status === 'PUBLISHING') throw new ApiError(409, 'بسته در حال انتشار است.')
      if (bundle.status === 'IN_REVIEW') throw new ApiError(409, 'ابتدا بسته را تأیید کنید.')
      if (!['APPROVED', 'SCHEDULED'].includes(bundle.status)) {
        throw new ApiError(400, 'انتشار فقط برای بسته تأییدشده یا زمان‌بندی‌شده مجاز است.')
      }
      const execution = await executeBundle(id, { id: user.id, name: user.name })
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'PUBLISH',
        entityType: 'PUBLISH_BUNDLE',
        entityId: id,
        entityTitle: bundle.title,
        details: `نتیجهٔ انتشار بسته: ${execution.status} (${execution.results.filter((r) => r.result === 'SUCCESS').length} موفق، ${execution.results.filter((r) => r.result === 'FAILED').length} ناموفق)`,
      })
      return ok({ detail: await buildDetail(id), execution })
    }

    // ── تلاش مجدد برای موارد ناموفق ──
    if (action === 'RETRY') {
      const user = await requirePermission('articles.publish')
      const bundle = await loadDetailBundle(id)
      if (!['PARTIAL', 'FAILED'].includes(bundle.status)) {
        throw new ApiError(400, 'تلاش مجدد فقط برای بسته‌های دارای انتشار جزئی یا ناموفق مجاز است.')
      }
      const execution = await executeBundle(id, { id: user.id, name: user.name }, { retryOnly: true })
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'RETRY',
        entityType: 'PUBLISH_BUNDLE',
        entityId: id,
        entityTitle: bundle.title,
        details: `تلاش مجدد انتشار بسته: ${execution.status}`,
      })
      return ok({ detail: await buildDetail(id), execution })
    }

    // ── لغو زمان‌بندی ──
    if (action === 'CANCEL_SCHEDULE') {
      const user = await requirePermission('articles.publish')
      const bundle = await loadDetailBundle(id)
      if (bundle.status !== 'SCHEDULED') throw new ApiError(400, 'این بسته زمان‌بندی‌شده نیست.')
      await db.publishBundle.update({ where: { id }, data: { scheduledAt: null, status: 'APPROVED' } })
      await db.bundleHistory.create({
        data: { bundleId: id, kind: 'SCHEDULE_CANCELLED', message: 'زمان‌بندی انتشار لغو شد؛ بسته به وضعیت تأییدشده بازگشت.', userId: user.id, userName: user.name },
      })
      await logActivity({
        userId: user.id,
        userName: user.name,
        action: 'CANCEL_SCHEDULE',
        entityType: 'PUBLISH_BUNDLE',
        entityId: id,
        entityTitle: bundle.title,
        details: 'لغو زمان‌بندی انتشار بسته',
      })
      return ok(await buildDetail(id))
    }

    // ── لغو بسته ──
    const user = await requirePermission('articles.create')
    const bundle = await loadDetailBundle(id)
    if (!['DRAFT', 'IN_REVIEW', 'SCHEDULED'].includes(bundle.status)) {
      throw new ApiError(400, 'فقط بسته پیش‌نویس، در بررسی یا زمان‌بندی‌شده قابل لغو است.')
    }
    await db.publishBundle.update({ where: { id }, data: { status: 'CANCELLED', scheduledAt: null } })
    await db.bundleHistory.create({
      data: { bundleId: id, kind: 'CANCELLED', message: 'بسته لغو شد.', userId: user.id, userName: user.name },
    })
    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CANCEL',
      entityType: 'PUBLISH_BUNDLE',
      entityId: id,
      entityTitle: bundle.title,
      details: 'لغو بسته انتشار',
    })
    return ok(await buildDetail(id))
  } catch (err) {
    return handleApiError(err)
  }
}

// ─── DELETE: حذف بسته ────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.view')
    const bundle = await db.publishBundle.findUnique({ where: { id } })
    if (!bundle) throw new ApiError(404, 'بسته یافت نشد.')

    // فقط سازنده یا مدیر انتشار می‌تواند حذف کند
    if (bundle.createdById !== user.id && !roleHasPermission(user.role, 'articles.publish')) {
      throw new ApiError(403, 'فقط سازنده بسته یا مدیر انتشار می‌تواند آن را حذف کند.')
    }
    if (bundle.status === 'PUBLISHING') {
      throw new ApiError(409, 'بسته در حال انتشار است و قابل حذف نیست.')
    }

    await db.publishBundle.delete({ where: { id } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'DELETE',
      entityType: 'PUBLISH_BUNDLE',
      entityId: id,
      entityTitle: bundle.title,
      details: 'حذف بسته انتشار',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
