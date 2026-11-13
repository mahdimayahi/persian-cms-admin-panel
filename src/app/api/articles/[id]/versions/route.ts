/**
 * API نسخه‌های مقاله
 * GET  /api/articles/[id]/versions — فهرست نسخه‌های ثبت‌شده (به‌همراه عنوان و زمان به‌روزرسانی فعلی مقاله)
 * POST /api/articles/[id]/versions — بازگردانی نسخه قبلی { versionId }
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('articles.view')
    const { id } = await params
    const article = await db.article.findUnique({
      where: { id },
      select: { id: true, title: true, updatedAt: true },
    })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    const versions = await db.articleVersion.findMany({
      where: { articleId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        articleId: true,
        title: true,
        content: true,
        excerpt: true,
        editorName: true,
        note: true,
        createdAt: true,
      },
    })

    return ok({ items: versions, title: article.title, updatedAt: article.updatedAt })
  } catch (err) {
    return handleApiError(err)
  }
}

interface RestoreBody {
  versionId?: unknown
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requirePermission('articles.view')
    const article = await db.article.findUnique({ where: { id } })
    if (!article) throw new ApiError(404, 'مقاله یافت نشد.')

    // همان منطق مالکیت ویرایش مقاله
    const canEditAny = roleHasPermission(user.role, 'articles.edit.any')
    if (!canEditAny) {
      if (!roleHasPermission(user.role, 'articles.edit.own') || article.authorId !== user.id) {
        throw new ApiError(403, 'شما فقط مجاز به ویرایش مقالات خودتان هستید.')
      }
      if (article.status === 'PUBLISHED' || article.status === 'ARCHIVED') {
        throw new ApiError(403, 'برای ویرایش مقاله منتشرشده باید از مدیر محتوا درخواست کنید.')
      }
    }

    const body = await parseBody<RestoreBody>(req)
    const versionId = vString(body.versionId, 'شناسه نسخه', { required: true, max: 100 })

    const version = await db.articleVersion.findUnique({ where: { id: versionId } })
    if (!version || version.articleId !== id) throw new ApiError(404, 'نسخه یافت نشد.')

    await db.$transaction(async (tx) => {
      // نخست وضعیت فعلی مقاله به‌عنوان نسخه ثبت می‌شود (سابقه پیش از بازگردانی)
      await tx.articleVersion.create({
        data: {
          articleId: id,
          title: article.title,
          content: article.content,
          excerpt: article.excerpt,
          editorId: user.id,
          editorName: user.name,
          note: 'ثبت خودکار پیش از بازگردانی',
        },
      })
      // سپس مقاله به مقادیر نسخه انتخاب‌شده بازگردانده می‌شود
      await tx.article.update({
        where: { id },
        data: { title: version.title, content: version.content, excerpt: version.excerpt },
      })
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'RESTORE',
      entityType: 'ARTICLE',
      entityId: id,
      entityTitle: article.title,
      details: 'بازگردانی نسخه قبلی',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
