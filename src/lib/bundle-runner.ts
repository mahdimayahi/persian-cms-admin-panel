/**
 * موتور اجرای بسته انتشار
 * هر جزء مستقل منتشر می‌شود؛ نتیجه هر جزء (موفق/ناموفق) ثبت می‌گردد.
 * «همه یا هیچ» تضمین نمی‌شود — به‌جای آن گزارش دقیق موفقیت/شکست ارائه می‌شود.
 */
import { db } from '@/lib/db'
import { logActivity, notifyUser } from '@/lib/audit'

export type BundleItemResult = { articleId: string; title: string; result: 'SUCCESS' | 'FAILED'; message: string }

/**
 * اجرای بسته: هر مقاله در وضعیت APPROVED منتشر می‌شود،
 * مقاله PUBLISHED موفق حساب می‌شود (قبلاً منتشر شده) و بقیه ناموفق با دلیل.
 */
export async function executeBundle(bundleId: string, actor: { id: string; name: string }): Promise<{
  status: 'PUBLISHED' | 'PARTIAL' | 'FAILED'
  results: BundleItemResult[]
}> {
  const bundle = await db.publishBundle.findUnique({
    where: { id: bundleId },
    include: { items: { include: { article: { select: { id: true, title: true, status: true, authorId: true } } } } },
  })
  if (!bundle) throw new Error('بسته یافت نشد.')

  await db.publishBundle.update({ where: { id: bundleId }, data: { status: 'PUBLISHING' } })

  const opLog = await db.operationLog.create({
    data: {
      type: 'BUNDLE_PUBLISH',
      title: `انتشار بسته «${bundle.title}»`,
      status: 'RUNNING',
      totalItems: bundle.items.length,
      initiatorId: actor.id,
      initiatorName: actor.name,
      relatedId: bundleId,
    },
  })

  const results: BundleItemResult[] = []

  for (const item of bundle.items) {
    const article = item.article
    try {
      if (article.status === 'PUBLISHED') {
        results.push({ articleId: article.id, title: article.title, result: 'SUCCESS', message: 'از قبل منتشر شده بود.' })
        await db.bundleItem.update({
          where: { id: item.id },
          data: { result: 'SUCCESS', message: 'از قبل منتشر شده بود.' },
        })
        await db.publishBundle.update({ where: { id: bundleId }, data: { publishedAt: new Date() } })
      } else if (article.status === 'APPROVED') {
        await db.article.update({
          where: { id: article.id },
          data: { status: 'PUBLISHED', publishedAt: new Date(), reviewNote: null },
        })
        results.push({ articleId: article.id, title: article.title, result: 'SUCCESS', message: 'منتشر شد.' })
        await db.bundleItem.update({ where: { id: item.id }, data: { result: 'SUCCESS', message: 'منتشر شد.' } })
        // بستن کارهای باز مرتبط و اعلان نویسنده
        await db.task.updateMany({
          where: { relatedType: 'ARTICLE', relatedId: article.id, type: { in: ['REVIEW', 'REVISION'] }, status: 'OPEN' },
          data: { status: 'DONE', doneAt: new Date() },
        })
        await notifyUser(article.authorId, {
          type: 'PUBLISHED',
          title: 'مقاله شما منتشر شد',
          body: `«${article.title}» از طریق بسته انتشار «${bundle.title}» منتشر شد.`,
          link: '#/articles',
        })
        await logActivity({
          userId: actor.id,
          userName: actor.name,
          action: 'PUBLISH',
          entityType: 'ARTICLE',
          entityId: article.id,
          entityTitle: article.title,
          details: `انتشار از طریق بسته «${bundle.title}»`,
        })
      } else {
        const label =
          article.status === 'DRAFT'
            ? 'مقاله هنوز پیش‌نویس است و برای انتشار باید تأیید شود.'
            : article.status === 'IN_REVIEW'
              ? 'مقاله در صف بررسی است؛ ابتدا تأیید شود.'
              : article.status === 'NEEDS_REVISION'
                ? 'مقاله نیازمند اصلاح است.'
                : 'مقاله بایگانی‌شده است و قابل انتشار نیست.'
        results.push({ articleId: article.id, title: article.title, result: 'FAILED', message: label })
        await db.bundleItem.update({ where: { id: item.id }, data: { result: 'FAILED', message: label } })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطای نامشخص در انتشار.'
      results.push({ articleId: article.id, title: article.title, result: 'FAILED', message: msg })
      await db.bundleItem.update({ where: { id: item.id }, data: { result: 'FAILED', message: msg } })
    }
  }

  const successCount = results.filter((r) => r.result === 'SUCCESS').length
  const failCount = results.length - successCount
  const status: 'PUBLISHED' | 'PARTIAL' | 'FAILED' =
    failCount === 0 ? 'PUBLISHED' : successCount === 0 ? 'FAILED' : 'PARTIAL'

  await db.publishBundle.update({
    where: { id: bundleId },
    data: { status, publishedAt: new Date() },
  })

  await db.operationLog.update({
    where: { id: opLog.id },
    data: {
      status: failCount === 0 ? 'SUCCESS' : successCount === 0 ? 'FAILED' : 'PARTIAL',
      doneItems: successCount,
      failedItems: failCount,
      resultSummary: `${successCount} جزء منتشر شد${failCount ? `؛ ${failCount} جزء ناموفق بود` : ''}.`,
      errorsJson: JSON.stringify(
        results.filter((r) => r.result === 'FAILED').map((r) => ({ item: r.title, reason: r.message }))
      ),
      finishedAt: new Date(),
    },
  })

  return { status, results }
}

/** اجرای بسته‌های زمان‌بندی‌شده‌ای که موعدشان رسیده (فراخوانی تنبل هنگام دسترسی) */
export async function runDueScheduledBundles(): Promise<number> {
  const due = await db.publishBundle.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
    select: { id: true },
    take: 5,
  })
  for (const b of due) {
    try {
      await executeBundle(b.id, { id: 'system', name: 'زمان‌بندی‌شده' })
    } catch (e) {
      console.error('[bundle-runner] scheduled execution failed', e)
    }
  }
  return due.length
}
