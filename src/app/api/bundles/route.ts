/**
 * بسته‌های انتشار (بسته انتشار — کمپین)
 * GET  /api/bundles — فهرست بسته‌ها (ابتدا بسته‌های زمان‌بندی‌شدهٔ رسیده به‌صورت تنبل اجرا می‌شوند)
 * POST /api/bundles — ایجاد بسته جدید { title, note?, items: [{ articleId, versionId?: 'current'|id, label? }] }
 *
 * هر قلم هنگام ایجاد به یک نسخه مشخص متصل می‌شود؛ اگر نسخه‌ای انتخاب نشده باشد یا مقاله
 * نسخه‌ای نداشته باشد، اسنپ‌شات خودکار از وضعیت زندهٔ مقاله ثبت و متصل می‌گردد.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { runDueScheduledBundles, resolveItemVersion } from '@/lib/bundle-runner'
import { runBundleReadiness } from '@/lib/bundle-readiness'

export async function GET(_req: NextRequest) {
  try {
    await requirePermission('articles.view')

    // اجرای تنبل بسته‌های زمان‌بندی‌شده‌ای که موعدشان رسیده است (با گارد نسخه)
    let executed = 0
    try {
      executed = await runDueScheduledBundles()
    } catch (e) {
      console.error('[bundles] lazy execution failed', e)
    }

    const bundles = await db.publishBundle.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: { select: { id: true, result: true, articleId: true } } },
    })

    return ok({
      items: bundles.map((b) => ({
        id: b.id,
        title: b.title,
        note: b.note,
        status: b.status,
        ownerId: b.ownerId,
        ownerName: b.ownerName,
        scheduledAt: b.scheduledAt,
        timezone: b.timezone,
        publishedAt: b.publishedAt,
        approvedAt: b.approvedAt,
        approvedByName: b.approvedByName,
        readinessState: b.readinessState,
        itemsTotal: b.items.length,
        itemsPublished: b.items.filter((it) => it.result === 'SUCCESS').length,
        itemsFailed: b.items.filter((it) => it.result === 'FAILED').length,
        createdByName: b.createdByName,
        createdAt: b.createdAt,
      })),
      executedDue: executed,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

interface CreateItemInput {
  articleId?: unknown
  versionId?: unknown
  label?: unknown
}

interface CreateBundleBody {
  title?: unknown
  note?: unknown
  items?: unknown
  articleIds?: unknown // سازگاری با شکل قدیمی: آرایهٔ شناسه مقاله (اتصال به نسخهٔ فعلی)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.create')
    const body = await parseBody<CreateBundleBody>(req)

    const title = vString(body.title, 'عنوان بسته', { required: true, min: 3, max: 150 })
    const note = body.note ? vString(body.note, 'توضیح', { max: 500 }) : ''

    // ورودی اقلام: آرایهٔ ساختاریافته یا آرایهٔ قدیمی شناسه مقاله‌ها
    let itemInputs: CreateItemInput[] = []
    if (Array.isArray(body.items)) {
      itemInputs = body.items.filter((it): it is CreateItemInput => !!it && typeof it === 'object')
    } else if (Array.isArray(body.articleIds)) {
      itemInputs = body.articleIds
        .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
        .map((articleId) => ({ articleId }))
    }
    if (itemInputs.length === 0) {
      throw new ApiError(400, 'حداقل یک مقاله به بسته اضافه کنید.')
    }

    // حذف تکراری‌ها بر اساس شناسه مقاله (محدودیت یکتایی bundleId+articleId)
    const seen = new Set<string>()
    itemInputs = itemInputs.filter((it) => {
      const id = typeof it.articleId === 'string' ? it.articleId.trim() : ''
      if (!id || seen.has(id)) return false
      seen.add(id)
      it.articleId = id
      return true
    })
    if (itemInputs.length === 0) throw new ApiError(400, 'فهرست مقالات نامعتبر است.')

    const articles = await db.article.findMany({
      where: { id: { in: Array.from(seen) } },
      select: { id: true, title: true, slug: true, status: true, content: true, excerpt: true },
    })
    if (articles.length !== seen.size) {
      throw new ApiError(400, 'یکی از مقالات انتخاب‌شده یافت نشد.')
    }
    const articleMap = new Map(articles.map((a) => [a.id, a]))

    // اتصال نسخهٔ هر قلم (در صورت نیاز اسنپ‌شات خودکار ثبت می‌شود)
    const itemData: { articleId: string; versionId: string; versionNumber: number; label: string; snapshotStatus: string }[] = []
    for (const it of itemInputs) {
      const article = articleMap.get(String(it.articleId))!
      const label = it.label ? vString(it.label, 'نقش قلم', { max: 120 }) : ''
      const bound = await resolveItemVersion(article, it.versionId ?? 'current', user)
      itemData.push({
        articleId: article.id,
        versionId: bound.versionId,
        versionNumber: bound.versionNumber,
        label,
        snapshotStatus: article.status,
      })
    }

    const bundle = await db.publishBundle.create({
      data: {
        title,
        note,
        createdById: user.id,
        createdByName: user.name,
        items: { create: itemData },
      },
      select: { id: true, title: true, status: true },
    })

    await db.bundleHistory.create({
      data: {
        bundleId: bundle.id,
        kind: 'CREATED',
        message: `بسته با ${itemData.length} قلم ایجاد شد و هر قلم به نسخه مشخصی متصل شد.`,
        userId: user.id,
        userName: user.name,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'PUBLISH_BUNDLE',
      entityId: bundle.id,
      entityTitle: title,
      details: `بسته انتشار با ${itemData.length} جزء ایجاد شد`,
    })

    // بررسی اولیهٔ آمادگی برای نمایش وضعیت (غیرمسدودکننده)
    try {
      await runBundleReadiness(bundle.id, user)
    } catch (e) {
      console.error('[bundles] initial readiness failed', e)
    }

    return ok(bundle, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
