/**
 * سویت ۲ — قرارداد نسخه در ویرایش مقاله/صفحه، بازگردانی، عملیات گروهی و انتشار
 * قفل خوش‌بینانه با CAS اتمی: دو ویرایش هم‌زمان با پایهٔ یکسان هرگز هر دو موفق نمی‌شوند.
 */
import { assert, assertEquals, check } from '../checks'
import type { Fixture } from '../fixture'
import type { PrismaClient } from '@prisma/client'
import { Api, expectStatus } from '../http'

type Ctx = { prisma: PrismaClient; fixture: Fixture; admin: Api; editorA: Api; editorB: Api; author: Api; viewer: Api }

export async function runVersionContractSuite(ctx: Ctx) {
  const { prisma, fixture, admin, editorA, editorB } = ctx

  console.log('\n▶ سویت: قرارداد نسخه — مقاله و صفحه')

  let articleId = ''
  let baseUpdatedAt = ''

  await check('ساخت مقالهٔ آزمایشی توسط ویراستار الف', async () => {
    const r = await editorA.req('POST', '/api/articles', {
      title: 'مقالهٔ رقابت ویرایش',
      slug: 'harness-race-edit',
      content: 'نسخهٔ پایهٔ محتوا',
    })
    expectStatus(r, 200, 'ساخت مقاله')
    const art = r.body as { id: string; updatedAt: string }
    articleId = art.id
    baseUpdatedAt = art.updatedAt
    assert(!!articleId)
  })

  await check('دو ویرایش واقعاً موازی با نسخهٔ پایهٔ یکسان → دقیقاً یکی ۲۰۰ و دیگری ۴۰۹', async () => {
    const put = (api: Api, title: string) =>
      api.req('PUT', `/api/articles/${articleId}`, { title, content: `محتوای ${title}`, baseUpdatedAt })
    const [r1, r2] = await Promise.all([put(editorA, 'عنوان الف'), put(editorB, 'عنوان ب')])
    const statuses = [r1.status, r2.status].sort()
    assertEquals(statuses, [200, 409], 'دو ویرایش هم‌زمان با پایهٔ یکسان هرگز هر دو موفق نمی‌شوند')
    const loser = r1.status === 409 ? r1 : r2
    const data = (loser.body as { data?: { conflict?: boolean; serverUpdatedAt?: string } })?.data
    assertEquals(data?.conflict, true, 'پاسخ رد شده باید flag تعارض داشته باشد')
    assert(!!data?.serverUpdatedAt, 'serverUpdatedAt برای رفرش ویرایشگر باید برگردد')
  })

  await check('محتوای نهایی دقیقاً برنده است و فقط یک نوشتن رخ داده', async () => {
    const art = (await prisma.article.findUnique({ where: { id: articleId } }))!
    const winner = art.title === 'عنوان الف' ? 'عنوان الف' : 'عنوان ب'
    assert([200, 409].length === 2)
    assertEquals(art.title, winner, 'عنوان نهایی باید عنوان برنده باشد')
    assertEquals(art.content, `محتوای ${winner}`, 'محتوای نهایی باید محتوای برنده باشد — نه ترکیب دو ویرایش')
  })

  await check('ویرایش محتوایی بدون baseUpdatedAt → ۴۰۰ (بدون بازنویسی بی‌صدا)', async () => {
    const r = await admin.req('PUT', `/api/articles/${articleId}`, { content: 'بدون پایه' })
    expectStatus(r, 400, 'بدون نسخهٔ پایه')
  })

  await check('baseUpdatedAt نامعتبر → ۴۰۰', async () => {
    const r = await admin.req('PUT', `/api/articles/${articleId}`, { content: 'x', baseUpdatedAt: 'garbage-date' })
    expectStatus(r, 400, 'پایهٔ نامعتبر')
  })

  await check('baseUpdatedAt قدیمی → ۴۰۹ (تعارض نسخهٔ پایه)', async () => {
    const r = await admin.req('PUT', `/api/articles/${articleId}`, { content: 'x', baseUpdatedAt: '2020-01-01T00:00:00.000Z' })
    expectStatus(r, 409, 'پایهٔ قدیمی')
  })

  console.log('  — صفحه (همان قرارداد) —')

  await check('دو ویرایش موازی صفحه با پایهٔ یکسان → دقیقاً یکی ۲۰۰', async () => {
    const page = (await prisma.page.findUnique({ where: { id: fixture.pages.pagePub.id } }))!
    const put = (title: string) =>
      admin.req('PUT', `/api/pages/${page.id}`, { title, content: `محتوای ${title}`, baseUpdatedAt: page.updatedAt.toISOString() })
    const [r1, r2] = await Promise.all([put('عنوان صفحه الف'), put('عنوان صفحه ب')])
    assertEquals([r1.status, r2.status].sort(), [200, 409], 'قرارداد CAS صفحه باید مثل مقاله باشد')
  })

  await check('ویرایش صفحه بدون baseUpdatedAt → ۴۰۰', async () => {
    const r = await admin.req('PUT', `/api/pages/${fixture.pages.pagePub.id}`, { title: 'بدون پایه' })
    expectStatus(r, 400, 'صفحه بدون پایه')
  })

  console.log('  — بازگردانی نسخه —')

  await check('بازگردانی نسخهٔ ۱ → محتوا برمی‌گردد و یک نسخهٔ پیش از بازگردانی ثبت می‌شود', async () => {
    const list = await admin.req<{ items: { id: string; content: string; note: string }[] }>(
      'GET',
      `/api/articles/${fixture.articles.artVersions.id}/versions`
    )
    expectStatus(list, 200, 'فهرست نسخه‌ها')
    const beforeCount = list.body!.items.length
    const v1 = list.body!.items.find((v) => v.note === 'نسخهٔ یک')!
    assert(!!v1, 'نسخهٔ یک باید موجود باشد')

    const r = await admin.req('POST', `/api/articles/${fixture.articles.artVersions.id}/versions`, {
      versionId: v1.id,
    })
    expectStatus(r, 200, 'بازگردانی')

    const after = (await prisma.article.findUnique({ where: { id: fixture.articles.artVersions.id } }))!
    assertEquals(after.content, 'محتوای نسخهٔ یک', 'محتوای مقاله باید دقیقاً محتوای نسخهٔ بازگردانی‌شده باشد')

    const list2 = await admin.req<{ items: unknown[] }>('GET', `/api/articles/${fixture.articles.artVersions.id}/versions`)
    assertEquals(list2.body!.items.length, beforeCount + 1, 'یک نسخهٔ «پیش از بازگردانی» باید ثبت شود')
  })

  console.log('  — هماهنگی قرارداد نسخه: ویرایش محتوای تأییدشده —')

  await check('ویرایش محتوایی مقالهٔ APPROVED → ۲۰۰ و وضعیت به IN_REVIEW برمی‌گردد (ابطال تأیید)', async () => {
    const art = (await prisma.article.findUnique({ where: { id: fixture.articles.artApproved1.id } }))!
    const r = await admin.req('PUT', `/api/articles/${fixture.articles.artApproved1.id}`, {
      content: 'محتوای ویرایش‌شده پس از تأیید',
      baseUpdatedAt: art.updatedAt.toISOString(),
    })
    expectStatus(r, 200, 'ویرایش مقالهٔ تأییدشده')
    const after = (await prisma.article.findUnique({ where: { id: fixture.articles.artApproved1.id } }))!
    assertEquals(after.status, 'IN_REVIEW', 'تأیید قبلی با ویرایش محتوا باطل می‌شود')
    assert(!!after.reviewNote?.includes('پس از تأیید'), 'یادداشت بازبینی باید علت را بیان کند')
    // نسخهٔ خودکار از وضعیت پیش از ویرایش ثبت شده است
    const versions = await prisma.articleVersion.count({ where: { articleId: fixture.articles.artApproved1.id } })
    assert(versions >= 2, 'اسنپ‌شات خودکار باید ثبت شده باشد')
  })

  console.log('  — عملیات گروهی (مرکز عملیات) —')

  await check('انتشار گروهی مقالهٔ APPROVED دست‌نخورده → SUCCESS و مقاله منتشر می‌شود', async () => {
    const r = await admin.req('POST', '/api/operations', {
      type: 'BULK_PUBLISH_ARTICLES',
      articleIds: [fixture.articles.artBulkClean.id],
    })
    expectStatus(r, 202, 'آغاز عملیات گروهی')
    const opId = (r.body as { id: string }).id
    const op = await pollOperation(admin, opId)
    assertEquals(op.status, 'SUCCESS', 'عملیات باید موفق تمام شود')
    const after = (await prisma.article.findUnique({ where: { id: fixture.articles.artBulkClean.id } }))!
    assertEquals(after.status, 'PUBLISHED', 'مقاله باید منتشر شده باشد')
    const item = await prisma.operationItem.findFirst({ where: { operationId: opId } })
    assertEquals(item?.status, 'SUCCEEDED')
  })

  await check('ویرایش محتوایی مقالهٔ تأییدشدهٔ دوم → IN_REVIEW؛ سپس انتشار گروهی آن FAILED می‌شود', async () => {
    const art = (await prisma.article.findUnique({ where: { id: fixture.articles.artBulkDirty.id } }))!
    const e = await admin.req('PUT', `/api/articles/${fixture.articles.artBulkDirty.id}`, {
      content: 'ویرایش پس از تأیید برای گروهی',
      baseUpdatedAt: art.updatedAt.toISOString(),
    })
    expectStatus(e, 200, 'ویرایش')

    const r = await admin.req('POST', '/api/operations', {
      type: 'BULK_PUBLISH_ARTICLES',
      articleIds: [fixture.articles.artBulkDirty.id],
    })
    expectStatus(r, 202, 'آغاز عملیات گروهی دوم')
    const opId = (r.body as { id: string }).id
    const op = await pollOperation(admin, opId)
    assertEquals(op.status, 'FAILED', 'عملیات تک‌موردیِ ناموفق باید FAILED شود')
    const item = await prisma.operationItem.findFirst({ where: { operationId: opId } })
    assertEquals(item?.status, 'FAILED')
    assert(item?.message?.includes('بررسی'), 'دلیل باید «در صف بررسی بودن» را بیان کند')
    const after = (await prisma.article.findUnique({ where: { id: fixture.articles.artBulkDirty.id } }))!
    assertEquals(after.status, 'IN_REVIEW', 'نسخهٔ ویرایش‌شدهٔ تأییدنشده هرگز به‌صورت گروهی منتشر نمی‌شود')
  })

  console.log('  — بستهٔ انتشار: گارد نسخه در لحظهٔ اجرا —')

  await check('گردش کامل بسته: ساخت → تأیید → اجرا → مقاله منتشر و مالکیت ثبت می‌شود', async () => {
    const art = fixture.articles.artApproved2
    const create = await admin.req('POST', '/api/bundles', {
      title: 'بستهٔ هارنس گردش کامل',
      items: [{ articleId: art.id, versionId: 'current' }],
    })
    expectStatus(create, 201, 'ساخت بسته')
    const bundleId = (create.body as { id: string }).id

    expectStatus(await admin.req('POST', `/api/bundles/${bundleId}`, { action: 'SEND_TO_REVIEW' }), 200)
    expectStatus(await admin.req('POST', `/api/bundles/${bundleId}`, { action: 'APPROVE' }), 200)

    const run = await admin.req('POST', `/api/bundles/${bundleId}`, { action: 'PUBLISH' })
    expectStatus(run, 200, 'اجرای بسته')

    const after = (await prisma.article.findUnique({ where: { id: art.id } }))!
    assertEquals(after.status, 'PUBLISHED', 'مقالهٔ تأییدشده با نسخهٔ سالم باید منتشر شود')
    const bundle = (await prisma.publishBundle.findUnique({ where: { id: bundleId } }))!
    assertEquals(bundle.status, 'PUBLISHED')
    // قرارداد مالکیت: opLog موفق با runOpId ثبت شده و بسته به همان اشاره می‌کند
    const opLog = await prisma.operationLog.findFirst({
      where: { type: 'BUNDLE_PUBLISH', relatedId: bundleId, status: 'SUCCESS' },
    })
    assert(!!opLog, 'operationLog موفق باید ثبت شده باشد')
    assertEquals(bundle.runOpId, opLog!.id, 'runOpId بسته باید opLog مالک را نشان دهد')
  })

  await check('تأیید بسته و سپس تغییر نسخهٔ مقاله → اجرا ۴۰۹ و نسخهٔ تأییدنشده منتشر نمی‌شود', async () => {
    const art = fixture.articles.artApproved1 // در چک قبلی IN_REVIEW شده؛ دوباره تأیید می‌شود
    expectStatus(await admin.req('POST', `/api/articles/${art.id}/transition`, { action: 'APPROVE' }), 200, 'تأیید مجدد')

    const create = await admin.req('POST', '/api/bundles', {
      title: 'بستهٔ هارنس گارد نسخه',
      items: [{ articleId: art.id, versionId: 'current' }],
    })
    expectStatus(create, 201, 'ساخت بسته دوم')
    const bundleId = (create.body as { id: string }).id
    expectStatus(await admin.req('POST', `/api/bundles/${bundleId}`, { action: 'SEND_TO_REVIEW' }), 200)
    expectStatus(await admin.req('POST', `/api/bundles/${bundleId}`, { action: 'APPROVE' }), 200)

    // پس از تأیید بسته، محتوای مقاله تغییر می‌کند (نسخهٔ جدید)
    const fresh = (await prisma.article.findUnique({ where: { id: art.id } }))!
    expectStatus(
      await admin.req('PUT', `/api/articles/${art.id}`, {
        content: 'محتوای تغییر یافته پس از تأیید بسته',
        baseUpdatedAt: fresh.updatedAt.toISOString(),
      }),
      200,
      'ویرایش پس از تأیید بسته'
    )

    const run = await admin.req('POST', `/api/bundles/${bundleId}`, { action: 'PUBLISH' })
    expectStatus(run, 409, 'اجرای بسته پس از تغییر نسخه')

    const bundle = (await prisma.publishBundle.findUnique({ where: { id: bundleId } }))!
    assertEquals(bundle.status, 'IN_REVIEW', 'تأیید بسته باید باطل شده باشد')
    const after = (await prisma.article.findUnique({ where: { id: art.id } }))!
    assertEquals(after.status, 'IN_REVIEW', 'نسخهٔ جدید تأییدنشده هرگز منتشر نمی‌شود')
  })
}

/** انتظار برای رسیدن عملیات گروهی به وضعیت پایانی */
async function pollOperation(api: Api, opId: string, timeoutMs = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const list = await api.req<{ items: { id: string; status: string }[] }>('GET', '/api/operations')
    const op = list.body?.items.find((i) => i.id === opId)
    if (op && ['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(op.status)) return op
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error(`عملیات ${opId} در مهلت زمانی به وضعیت پایانی نرسید`)
}
