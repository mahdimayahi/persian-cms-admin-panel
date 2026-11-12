/**
 * بسته‌های انتشار (کمپین)
 * GET  /api/bundles — فهرست بسته‌ها (ابتدا بسته‌های زمان‌بندی‌شده رسیده اجرا می‌شوند)
 * POST /api/bundles — ایجاد بسته جدید { title, note?, articleIds[] }
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'
import { runDueScheduledBundles } from '@/lib/bundle-runner'

export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('articles.view')

    // اجرای تنبل بسته‌های زمان‌بندی‌شده‌ای که موعدشان رسیده است
    let executed = 0
    try {
      executed = await runDueScheduledBundles()
    } catch (e) {
      console.error('[bundles] lazy execution failed', e)
    }

    const bundles = await db.publishBundle.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { article: { select: { id: true, title: true, status: true } } },
        },
      },
    })

    return ok({
      items: bundles.map((b) => ({
        id: b.id,
        title: b.title,
        note: b.note,
        status: b.status,
        scheduledAt: b.scheduledAt,
        publishedAt: b.publishedAt,
        createdByName: b.createdByName,
        createdAt: b.createdAt,
        items: b.items.map((it) => ({
          id: it.id,
          articleId: it.articleId,
          title: it.article.title,
          status: it.article.status,
          snapshotStatus: it.snapshotStatus,
          result: it.result,
          message: it.message,
        })),
      })),
      executedDue: executed,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

interface CreateBundleBody {
  title?: unknown
  note?: unknown
  articleIds?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.create')
    const body = await parseBody<CreateBundleBody>(req)

    const title = vString(body.title, 'عنوان بسته', { required: true, min: 3, max: 150 })
    const note = body.note ? vString(body.note, 'توضیح', { max: 500 }) : ''

    if (!Array.isArray(body.articleIds) || body.articleIds.length === 0) {
      throw new ApiError(400, 'حداقل یک مقاله به بسته اضافه کنید.')
    }
    const ids = Array.from(new Set(body.articleIds.filter((a): a is string => typeof a === 'string' && a.trim() !== '')))
    if (ids.length === 0) throw new ApiError(400, 'فهرست مقالات نامعتبر است.')

    const articles = await db.article.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, status: true },
    })
    if (articles.length !== ids.length) {
      throw new ApiError(400, 'یکی از مقالات انتخاب‌شده یافت نشد.')
    }

    const bundle = await db.publishBundle.create({
      data: {
        title,
        note,
        createdById: user.id,
        createdByName: user.name,
        items: {
          create: articles.map((a) => ({ articleId: a.id, snapshotStatus: a.status })),
        },
      },
      include: { items: { include: { article: { select: { id: true, title: true, status: true } } } } },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'CREATE',
      entityType: 'PUBLISH_BUNDLE',
      entityId: bundle.id,
      entityTitle: title,
      details: `بسته انتشار با ${articles.length} جزء ایجاد شد`,
    })

    return ok(
      {
        ...bundle,
        items: bundle.items.map((it) => ({
          id: it.id,
          articleId: it.articleId,
          title: it.article.title,
          status: it.article.status,
          snapshotStatus: it.snapshotStatus,
          result: it.result,
          message: it.message,
        })),
      },
      { status: 201 }
    )
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requirePermission('articles.view')
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id') ?? ''
    if (!id) throw new ApiError(400, 'شناسه بسته الزامی است.')

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
