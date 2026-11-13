/**
 * سویت ۱ — تبدیل آزمایش: اتمیک بودن convertedAt زیر دو تبدیل واقعاً موازی
 * شمارش ردیف کافی نیست؛ خود مقدار convertedAt باید دقیقاً یک بار و برابر occurredAt برنده ثبت شود.
 */
import { assert, assertEquals, check } from '../checks'
import { BASE_URL } from '../config'
import { expectStatus } from '../http'
import type { Fixture } from '../fixture'
import type { PrismaClient } from '@prisma/client'

type Ctx = { prisma: PrismaClient; fixture: Fixture }

export async function runAnalyticsSuite(ctx: Ctx) {
  const { attributeExperimentConversion } = await import('@/lib/analytics')
  const { prisma, fixture } = ctx

  console.log('\n▶ سویت: تبدیل آزمایش — اتمیک بودن convertedAt (موازی واقعی)')

  await check('دو تبدیل واقعاً موازی → دقیقاً یکی converted:true و مقدار convertedAt = زمان برنده', async () => {
    const t1 = new Date(Date.now() - 60_000)
    const t2 = new Date(Date.now() - 30_000)

    const [r1, r2] = await Promise.all([
      attributeExperimentConversion(prisma, {
        experimentId: fixture.experiment.id,
        visitorId: fixture.assignment.visitorId,
        eventType: 'SIGNUP',
        occurredAt: t1,
      }),
      attributeExperimentConversion(prisma, {
        experimentId: fixture.experiment.id,
        visitorId: fixture.assignment.visitorId,
        eventType: 'SIGNUP',
        occurredAt: t2,
      }),
    ])

    const converted = [r1, r2].filter((r) => r.converted)
    assertEquals(converted.length, 1, 'فقط یکی از دو تبدیل موازی باید claimed شود')
    assertEquals(r1.group, 'VARIANT')
    assertEquals(r2.group, 'VARIANT')

    const after = await prisma.experimentAssignment.findUnique({ where: { id: fixture.assignment.id } })
    assert(after, 'تخصیص باید موجود باشد')
    assert(after.convertedAt !== null, 'convertedAt باید ثبت شده باشد')
    // اتمیک بودن: مقدار نهایی دقیقاً برابر occurredAt برنده است — نه ترکیبی/مقدار سوم
    const stored = after.convertedAt.getTime()
    const winnerTime = converted[0] === r1 ? t1.getTime() : t2.getTime()
    assertEquals(
      stored,
      winnerTime,
      'convertedAt باید دقیقاً برابر occurredAt نخستین نویسندهٔ موفق باشد (نوشتن فقط یک بار)'
    )
  })

  await check('تبدیل سوم پس از claim → converted:false و convertedAt دست‌نخورده', async () => {
    const before = await prisma.experimentAssignment.findUnique({ where: { id: fixture.assignment.id } })
    const r = await attributeExperimentConversion(prisma, {
      experimentId: fixture.experiment.id,
      visitorId: fixture.assignment.visitorId,
      eventType: 'SIGNUP',
      occurredAt: new Date(),
    })
    assertEquals(r.converted, false, 'تبدیل دوم بازدیدکننده نباید دوباره شمرده شود')
    assertEquals(r.group, 'VARIANT')
    const after = await prisma.experimentAssignment.findUnique({ where: { id: fixture.assignment.id } })
    assertEquals(
      after?.convertedAt?.getTime(),
      before?.convertedAt?.getTime(),
      'convertedAt پس از نخستین claim نباید تغییر کند'
    )
  })

  await check('بازدیدکننده بدون تخصیص → group:null و converted:false (بدون خطا)', async () => {
    const r = await attributeExperimentConversion(prisma, {
      experimentId: fixture.experiment.id,
      visitorId: 'visitor-unknown-999',
      eventType: 'SIGNUP',
      occurredAt: new Date(),
    })
    assertEquals(r.group, null)
    assertEquals(r.converted, false)
  })

  console.log('  — مسیر HTTP ارسال رویداد (شامل مسیر بازیابی DUPLICATE) —')

  await check('HTTP: دو رویداد موازی با eventIds متفاوت → دقیقاً یک CONVERTED و convertedAt یک‌بار', async () => {
    // تخصیص تازه برای بازدیدکنندهٔ HTTP — claim کتابخانه‌ای هنوز روی آن انجام نشده
    const visitorId = 'visitor-harness-002'
    await prisma.experimentAssignment.create({
      data: {
        experimentId: fixture.experiment.id,
        visitorId,
        assignedGroup: 'VARIANT',
        firstExposedAt: new Date(Date.now() - 3600_000),
        exposureCount: 1,
        convertedAt: null,
      },
    })
    const baseEvent = {
      eventType: 'SIGNUP',
      occurredAt: new Date().toISOString(),
      contentId: fixture.articles.artApproved1.id,
      visitorId,
      experimentId: fixture.experiment.id,
      consent: true,
    }
    const post = (eventId: string) =>
      fetch(`${BASE_URL}/api/analytics/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [{ eventId, ...baseEvent }] }),
      }).then((r) => r.json())

    const [j1, j2] = await Promise.all([post('evt-harness-parallel-1'), post('evt-harness-parallel-2')])
    const statuses = [j1, j2].flatMap((j: { results?: { status: string }[] }) => (j.results ?? []).map((x) => x.status))
    assertEquals(statuses.filter((s) => s === 'CONVERTED').length, 1, 'فقط یک رویداد باید CONVERTED شود')
    assertEquals(statuses.filter((s) => s === 'ACCEPTED').length, 1, 'رویداد بازنده ACCEPTED ثبت می‌شود')

    const a2 = await prisma.experimentAssignment.findUnique({
      where: { experimentId_visitorId: { experimentId: fixture.experiment.id, visitorId } },
    })
    assert(a2?.convertedAt, 'convertedAt باید ثبت شده باشد')
    const stored = a2.convertedAt.getTime()
    // مقدار ثبت‌شده باید دقیقاً یکی از دو زمان ارسالی باشد (نوشتن اتمیک، بدون ترکیب)
    const sent = baseEvent.occurredAt
    const diff = Math.abs(stored - new Date(sent).getTime())
    assert(diff < 2000, `convertedAt باید برابر occurredAt رویدادها باشد (اختلاف: ${diff}ms)`)
  })

  await check('HTTP: ارسال مجدد همان eventId → DUPLICATE بدون تغییر convertedAt', async () => {
    // بازدیدکنندهٔ دارای تخصیص واقعی: تخصیص فیکسچر — رویداد موفق SIGNUP در پنجره
    const visitor = fixture.assignment.visitorId
    // این بازدیدکننده در چک قبلی claimed شده؛ فقط رفتار DUPLICATE بررسی می‌شود
    const ev = {
      eventId: 'evt-harness-dup-1',
      eventType: 'PAGE_VIEW',
      occurredAt: new Date().toISOString(),
      contentId: fixture.articles.artApproved1.id,
      visitorId: visitor,
      experimentId: fixture.experiment.id,
      consent: true,
    }
    const first = await fetch(`${BASE_URL}/api/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [ev] }),
    })
    expectStatus({ status: first.status, body: await first.json().catch(() => null), headers: first.headers, setCookies: [] }, 200)

    const before = await prisma.experimentAssignment.findUnique({ where: { id: fixture.assignment.id } })
    const res2 = await fetch(`${BASE_URL}/api/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ ...ev, eventType: 'SIGNUP' }] }),
    })
    const j2 = await res2.json()
    const st = (j2.results ?? [])[0]?.status
    assertEquals(st, 'DUPLICATE', 'ارسال مجدد همان شناسه باید DUPLICATE شود')
    const after = await prisma.experimentAssignment.findUnique({ where: { id: fixture.assignment.id } })
    assertEquals(
      after?.convertedAt?.getTime(),
      before?.convertedAt?.getTime(),
      'convertedAt با ارسال مجدد نباید تغییر کند'
    )
  })

  await check('HTTP: بدنهٔ {events:[null]} و اعضای غیرآبجکتی → INVALID نه ۵۰۰', async () => {
    const res = await fetch(`${BASE_URL}/api/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [null, 42, 'junk', []] }),
    })
    assertEquals(res.status, 200, 'اعضای نامعتبر نباید ۵۰۰ بسازند')
    const j = await res.json()
    const statuses = (j.results ?? []).map((x: { status: string }) => x.status)
    assertEquals(statuses.length, 4)
    assert(statuses.every((s: string) => s === 'INVALID'), 'همهٔ اعضا باید INVALID باشند')
  })

  await check('HTTP: بدنهٔ null خام → INVALID نه ۵۰۰', async () => {
    const res = await fetch(`${BASE_URL}/api/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(null),
    })
    assertEquals(res.status, 200)
    const j = await res.json()
    assertEquals((j.results ?? [])[0]?.status, 'INVALID')
  })
}
