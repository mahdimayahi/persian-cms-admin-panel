/**
 * سویت ۳ — قرارداد مالکیت اجرای بسته و توقف worker قدیمی
 * سناریو: worker اول claim می‌کند، «مکث» می‌کند (heartbeat منقضی) → worker دوم بازیابی و اجرا
 * می‌کند → worker اول «ادامه» می‌دهد و باید در نخستین گارد بدون هیچ نوشتنی متوقف شود.
 */
import { assert, assertEquals, check } from '../checks'
import type { Fixture } from '../fixture'
import type { PrismaClient } from '@prisma/client'
import { Api } from '../http'

type Ctx = { prisma: PrismaClient; fixture: Fixture; admin: Api }

export async function runWorkerOwnershipSuite(ctx: Ctx) {
  const { prisma, fixture, admin } = ctx
  const bundleRunner = await import('@/lib/bundle-runner')
  const { claimBundleRun, touchRunOwnership, finalizeBundleRun, OwnershipLostError, executeBundle } = bundleRunner

  let bundleIdForScenario = ''

  console.log('\n▶ سویت: مالکیت اجرای بسته — claim موازی و توقف worker قدیمی')

  await check('دو claim واقعاً موازی روی یک بسته → دقیقاً یکی مالک می‌شود (runOpId ثبت)', async () => {
    // بستهٔ تازه با یک قلم سالم
    const art = (await prisma.article.findUnique({ where: { id: fixture.articles.artBulkClean.id } }))!
    // این مقاله در سویت قبلی PUBLISHED شده؛ برای این تست دوباره APPROVED می‌شود
    await prisma.article.update({ where: { id: art.id }, data: { status: 'APPROVED' } })
    const versions = await prisma.articleVersion.findMany({
      where: { articleId: art.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const latest = versions[versions.length - 1]
    const bundle = await prisma.publishBundle.create({
      data: {
        title: 'بستهٔ claim موازی',
        status: 'APPROVED',
        createdById: fixture.users.admin.id,
        createdByName: fixture.users.admin.name,
        approvedAt: new Date(),
      },
    })
    await prisma.bundleItem.create({
      data: { bundleId: bundle.id, articleId: art.id, versionId: latest.id, approvedVersionId: latest.id },
    })

    const opA = await prisma.operationLog.create({
      data: { type: 'BUNDLE_PUBLISH', title: 'claim A', status: 'RUNNING', relatedId: bundle.id, startedAt: new Date(), heartbeatAt: new Date() },
    })
    const opB = await prisma.operationLog.create({
      data: { type: 'BUNDLE_PUBLISH', title: 'claim B', status: 'RUNNING', relatedId: bundle.id, startedAt: new Date(), heartbeatAt: new Date() },
    })

    const [a, b] = await Promise.all([
      claimBundleRun(bundle.id, opA.id, ['APPROVED', 'SCHEDULED']),
      claimBundleRun(bundle.id, opB.id, ['APPROVED', 'SCHEDULED']),
    ])
    assertEquals([a, b].filter(Boolean).length, 1, 'دقیقاً یک claim باید موفق شود')

    const fresh = (await prisma.publishBundle.findUnique({ where: { id: bundle.id } }))!
    assertEquals(fresh.status, 'PUBLISHING')
    const winner = a ? opA.id : opB.id
    const loser = a ? opB.id : opA.id
    assertEquals(fresh.runOpId, winner, 'runOpId باید مالک را ثبت کند')
    const loserLog = (await prisma.operationLog.findUnique({ where: { id: loser } }))!
    assertEquals(loserLog.status, 'FAILED', 'opLog بازنده باید بسته شود (بدون RUNNING سرگردان)')

    // پاک‌سازی وضعیت برای ادامهٔ سناریوی اصلی همین سویت
    await prisma.publishBundle.update({ where: { id: bundle.id }, data: { status: 'APPROVED', runOpId: null } })
    bundleIdForScenario = bundle.id
  })

  await check('سناریوی مکث/ادامه: worker قدیمی پس از واگذاری مالکیت در نخستین گارد متوقف می‌شود', async () => {
    assert(!!bundleIdForScenario, 'بستهٔ سناریو باید آماده باشد')
    const bundleId = bundleIdForScenario
    const art = fixture.articles.artBulkClean

    // ── worker اول: opLog + claim + یک ضربان سالم ──
    const opLog1 = await prisma.operationLog.create({
      data: { type: 'BUNDLE_PUBLISH', title: 'worker قدیمی', status: 'RUNNING', relatedId: bundleId, startedAt: new Date(), heartbeatAt: new Date() },
    })
    const claimed = await claimBundleRun(bundleId, opLog1.id, ['APPROVED', 'SCHEDULED'])
    assertEquals(claimed, true)
    await touchRunOwnership(opLog1.id) // مالک فعال است — نباید خطا دهد

    // ── «مکث» worker اول: heartbeat را ۱۲۰ ثانیه عقب می‌بریم (بیش از آستانهٔ ۹۰ ثانیه) ──
    await prisma.operationLog.update({
      where: { id: opLog1.id },
      data: { heartbeatAt: new Date(Date.now() - 120_000) },
    })

    // ── worker دوم: اجرای واقعی executeBundle — بازیابی اجرای معلق + claim + انتشار ──
    const result = await executeBundle(bundleId, { name: 'هارنس worker دوم' })
    assertEquals(result.status, 'PUBLISHED', 'worker دوم باید کامل اجرا کند')

    const afterRun = (await prisma.article.findUnique({ where: { id: art.id } }))!
    assertEquals(afterRun.status, 'PUBLISHED', 'مقاله باید توسط worker دوم منتشر شده باشد')
    const bundleAfter = (await prisma.publishBundle.findUnique({ where: { id: bundleId } }))!
    assertEquals(bundleAfter.status, 'PUBLISHED')
    assert(bundleAfter.runOpId !== opLog1.id, 'مالکیت باید به worker دوم منتقل شده باشد')

    // opLog1 باید توسط reclaim FAILED اعلام شده باشد
    const staleLog = (await prisma.operationLog.findUnique({ where: { id: opLog1.id } }))!
    assertEquals(staleLog.status, 'FAILED')
    assert(staleLog.resultSummary.includes('متوقف'), 'علت توقف باید در opLog ثبت شود')
    // worker قدیمی هیچ operationItem ثبت نکرده است
    const orphanItems = await prisma.operationItem.count({ where: { operationId: opLog1.id } })
    assertEquals(orphanItems, 0, 'worker مرده نباید نتیجهٔ قلم ثبت کرده باشد')

    // ── «ادامهٔ» worker اول: هر تلاش نوشتن باید رد شود ──
    let touched = false
    try {
      await touchRunOwnership(opLog1.id)
      touched = true
    } catch (e) {
      assert(e instanceof OwnershipLostError, 'خطای مالکیت باید OwnershipLostError باشد')
    }
    assertEquals(touched, false, 'touch پس از واگذاری مالکیت باید OwnershipLostError بدهد')

    // تلاش worker قدیمی برای بازنویسی وضعیت بسته → نادیده گرفته می‌شود
    const finalized = await finalizeBundleRun(bundleId, opLog1.id, { status: 'FAILED' })
    assertEquals(finalized, false, 'finalize بدون مالکیت باید false بدهد')

    const bundleFinal = (await prisma.publishBundle.findUnique({ where: { id: bundleId } }))!
    assertEquals(bundleFinal.status, 'PUBLISHED', 'وضعیت بسته نباید توسط worker قدیمی بازنویسی شود')
    const articleFinal = (await prisma.article.findUnique({ where: { id: art.id } }))!
    assertEquals(articleFinal.status, 'PUBLISHED', 'وضعیت مقاله نباید توسط worker قدیمی تغییر کند')
  })

  await check('touchRunOwnership برای opLog ناموجود → OwnershipLostError', async () => {
    let threw = false
    try {
      await touchRunOwnership('nonexistent-op-id')
    } catch (e) {
      threw = e instanceof OwnershipLostError
    }
    assertEquals(threw, true)
  })

  await check('finalize بدون مالکیت روی بستهٔ ناموجود → false (بدون نوشتن)', async () => {
    const finalized = await finalizeBundleRun('nonexistent-bundle', 'nonexistent-op', { status: 'PUBLISHED' })
    assertEquals(finalized, false)
  })

  console.log('  — تلاش مجدد بستهٔ نیمه‌ناموفق (بدون اجرای دوبارهٔ موفق‌ها) —')

  await check('retryOnly: قلم موفق قبلی SKIPPED و publishedAt دست‌نخورده؛ قلم ناموفق اجرا می‌شود', async () => {
    const artA = fixture.articles.artRetryA // PUBLISHED با نتیجهٔ SUCCESS
    const artB = fixture.articles.artRetryB // APPROVED با نتیجهٔ FAILED
    const beforeA = (await prisma.article.findUnique({ where: { id: artA.id } }))!
    const publishedAtBefore = beforeA.publishedAt
    assert(publishedAtBefore, 'publishedAt قبلی باید موجود باشد')

    const result = await executeBundle(fixture.bundleRetry.id, { name: 'هارنس retry' }, { retryOnly: true })
    assertEquals(result.status, 'PUBLISHED', 'پس از تلاش مجدد موفق، وضعیت نهایی PUBLISHED است')

    const results = result.results
    assertEquals(results.filter((r) => r.result === 'SKIPPED').length, 1, 'قلم موفق قبلی باید SKIPPED شود')
    assertEquals(results.filter((r) => r.result === 'SUCCESS').length, 1, 'قلم ناموفق قبلی باید اجرا شود')

    const afterA = (await prisma.article.findUnique({ where: { id: artA.id } }))!
    assertEquals(
      afterA.publishedAt?.getTime(),
      publishedAtBefore.getTime(),
      'publishedAt مقالهٔ موفق قبلی نباید دوباره نوشته شود (بدون اجرای تکراری)'
    )
    assertEquals(afterA.status, 'PUBLISHED')

    const afterB = (await prisma.article.findUnique({ where: { id: artB.id } }))!
    assertEquals(afterB.status, 'PUBLISHED', 'قلم ناموفق قبلی باید در تلاش مجدد منتشر شود')

    const opLog = (await prisma.operationLog.findUnique({ where: { id: result.opId } }))!
    assertEquals(opLog.status, 'SUCCESS')
    assert(opLog.retryOfId !== null, 'تلاش مجدد باید به اجرای قبلی اشاره کند')
  })
}
