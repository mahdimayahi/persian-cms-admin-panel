/**
 * عملیات روی یک بسته انتشار
 * GET   /api/bundles/[id] — جزئیات کامل بسته
 * PATCH /api/bundles/[id] — به‌روزرسانی { title?, note?, articleIds?, scheduledAt? (''|null = لغو زمان‌بندی), action?: 'CANCEL' }
 * POST  /api/bundles/[id] — انتشار فوری بسته (مجوز articles.publish)
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'
import { executeBundle } from '@/lib/bundle-runner'

async function loadBundle(id: string) {
  const bundle = await db.publishBundle.findUnique({
    where: { id },
    include: { items: { include: { article: { select: { id: true, title: true, status: true } } } } },
  })
  if (!bundle) throw new ApiError(404, 'بسته یافت نشد.')
  return bundle
}

function serialize(bundle: NonNullable<Awaited<ReturnType<typeof loadBundle>>>) {
  return {
    id: bundle.id,
    title: bundle.title,
    note: bundle.note,
    status: bundle.status,
    scheduledAt: bundle.scheduledAt,
    publishedAt: bundle.publishedAt,
    createdByName: bundle.createdByName,
    createdAt: bundle.createdAt,
    items: bundle.items.map((it) => ({
      id: it.id,
      articleId: it.articleId,
      title: it.article.title,
      status: it.article.status,
      snapshotStatus: it.snapshotStatus,
      result: it.result,
      message: it.message,
    })),
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('articles.view')
    const { id } = await params
    const bundle = await loadBundle(id)
    return ok(serialize(bundle))
  } catch (err) {
    return handleApiError(err)
  }
}

interface UpdateBundleBody {
  title?: unknown
  note?: unknown
  articleIds?: unknown
  scheduledAt?: unknown
  action?: unknown
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.create')
    const bundle = await loadBundle(id)

    if (bundle.status === 'PUBLISHING') throw new ApiError(409, 'بسته در حال انتشار است و قابل تغییر نیست.')
    if (['PUBLISHED', 'PARTIAL', 'FAILED'].includes(bundle.status) && !roleHasPermission(user.role, 'articles.publish')) {
      throw new ApiError(403, 'بسته منتشرشده فقط توسط مدیر انتشار قابل تغییر است.')
    }

    const body = await parseBody<UpdateBundleBody>(req)
    const data: Record<string, unknown> = {}

    if (body.action === 'CANCEL') {
      if (!['DRAFT', 'SCHEDULED'].includes(bundle.status)) {
        throw new ApiError(400, 'فقط بسته پیش‌نویس یا زمان‌بندی‌شده قابل لغو است.')
      }
      data.status = 'CANCELLED'
      data.scheduledAt = null
    } else {
      if (body.title !== undefined) data.title = vString(body.title, 'عنوان بسته', { required: true, min: 3, max: 150 })
      if (body.note !== undefined) data.note = vString(body.note, 'توضیح', { max: 500 })

      if (Array.isArray(body.articleIds)) {
        const ids = Array.from(new Set(body.articleIds.filter((a): a is string => typeof a === 'string' && a.trim() !== '')))
        if (ids.length === 0) throw new ApiError(400, 'حداقل یک مقاله لازم است.')
        const articles = await db.article.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } })
        if (articles.length !== ids.length) throw new ApiError(400, 'یکی از مقالات یافت نشد.')
        await db.$transaction(async (tx) => {
          await tx.bundleItem.deleteMany({ where: { bundleId: id } })
          await tx.bundleItem.createMany({
            data: articles.map((a) => ({ bundleId: id, articleId: a.id, snapshotStatus: a.status })),
          })
        })
      }

      if (body.scheduledAt !== undefined) {
        if (body.scheduledAt === null || body.scheduledAt === '') {
          data.scheduledAt = null
          if (bundle.status === 'SCHEDULED') data.status = 'DRAFT'
        } else {
          const d = new Date(String(body.scheduledAt))
          if (Number.isNaN(d.getTime())) throw new ApiError(400, 'زمان انتشار نامعتبر است.')
          if (!roleHasPermission(user.role, 'articles.publish')) {
            throw new ApiError(403, 'زمان‌بندی انتشار نیاز به مجوز انتشار دارد.')
          }
          data.scheduledAt = d
          data.status = 'SCHEDULED'
        }
      }
    }

    await db.publishBundle.update({ where: { id }, data })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'PUBLISH_BUNDLE',
      entityId: id,
      entityTitle: (data.title as string) ?? bundle.title,
      details: body.action === 'CANCEL' ? 'لغو بسته' : 'به‌روزرسانی بسته انتشار',
    })

    const updated = await loadBundle(id)
    return ok(serialize(updated))
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.publish')
    const bundle = await loadBundle(id)

    if (bundle.status === 'PUBLISHING') throw new ApiError(409, 'بسته در حال انتشار است.')
    if (['PUBLISHED', 'PARTIAL'].includes(bundle.status)) {
      throw new ApiError(400, 'این بسته قبلاً منتشر شده است. برای انتشار مجدد، بسته جدیدی بسازید.')
    }

    const result = await executeBundle(id, { id: user.id, name: user.name })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'PUBLISH',
      entityType: 'PUBLISH_BUNDLE',
      entityId: id,
      entityTitle: bundle.title,
      details: `نتیجه انتشار بسته: ${result.status}`,
    })

    const updated = await loadBundle(id)
    return ok({ ...serialize(updated), execution: result })
  } catch (err) {
    return handleApiError(err)
  }
}
