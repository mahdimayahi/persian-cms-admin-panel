/**
 * سویت ۴ — گارد مجوز تنظیمات با اثبات «پایگاه داده دست‌نخورده»
 * هر رد شدن، علاوه بر کد HTTP با مقایسهٔ وضعیت واقعی DB نیز تأیید می‌شود.
 */
import { assert, assertEquals, check } from '../checks'
import type { Fixture } from '../fixture'
import type { PrismaClient } from '@prisma/client'
import { Api, expectStatus } from '../http'

type Ctx = { prisma: PrismaClient; fixture: Fixture; admin: Api; editorA: Api; editorB: Api; author: Api; viewer: Api }

export async function runSettingsRbacSuite(ctx: Ctx) {
  const { prisma, fixture, admin, author, viewer } = ctx

  console.log('\n▶ سویت: مجوز تنظیمات — PUT معتبر با نقش‌های فاقد مجوز + اثبات بی‌تغییری DB')

  const snapshotSettings = async () => {
    const r = await viewer.req('GET', '/api/settings') // VIEWER دارای settings.view است
    expectStatus(r, 200, 'خواندن تنظیمات')
    return r.body as Record<string, string>
  }

  await check('VIEWER می‌تواند تنظیمات را بخواند (settings.view)', async () => {
    const s = await snapshotSettings()
    assertEquals(s.siteName, 'سایت هارنس')
  })

  await check('VIEWER با PUT معتبر → ۴۰۳ و DB دقیقاً دست‌نخورده', async () => {
    const before = await snapshotSettings()
    const rowsBefore = await prisma.setting.findMany()
    const r = await viewer.req('PUT', '/api/settings', {
      values: { siteName: 'نام نفوذی', postsPerPage: '999', maintenanceMode: 'true' },
    })
    expectStatus(r, 403, 'PUT تنظیمات توسط بیننده')

    const after = await snapshotSettings()
    assertEquals(after, before, 'هیچ مقدار تنظیمات نباید تغییر کند')
    const rowsAfter = await prisma.setting.findMany()
    assertEquals(rowsAfter.map((x) => `${x.key}=${x.value}`).sort(), rowsBefore.map((x) => `${x.key}=${x.value}`).sort(), 'سطرهای DB نباید تغییر کنند')
    // بررسی مستقیم سطح DB — نه فقط پاسخ API
    const hacked = await prisma.setting.findUnique({ where: { key: 'siteName' } })
    assertEquals(hacked?.value, 'سایت هارنس', 'مقدار DB باید همان مقدار قبلی باشد')
  })

  await check('AUTHOR با PUT معتبر → ۴۰۳ و DB دست‌نخورده', async () => {
    const before = await snapshotSettings()
    const r = await author.req('PUT', '/api/settings', { values: { siteName: 'نام نویسنده' } })
    expectStatus(r, 403, 'PUT تنظیمات توسط نویسنده')
    assertEquals(await snapshotSettings(), before)
  })

  await check('PUT بدون بدنهٔ values → ۴۰۰ (حتی برای ADMIN)', async () => {
    const r = await admin.req('PUT', '/api/settings', { siteName: 'بدون values' })
    expectStatus(r, 400, 'بدنهٔ نامعتبر')
  })

  await check('کلید غیرمجاز در PUT admin نادیده گرفته می‌شود؛ کلید مجاز ذخیره می‌شود', async () => {
    const r = await admin.req('PUT', '/api/settings', {
      values: { siteName: 'سایت هارنس ویرایش‌شده', secretBackdoor: 'pwn', postsPerPage: '12' },
    })
    expectStatus(r, 200, 'PUT معتبر مدیر')
    const s = (await snapshotSettings()) as Record<string, string>
    assertEquals(s.siteName, 'سایت هارنس ویرایش‌شده')
    assertEquals(s.postsPerPage, '12')
    assertEquals((s as Record<string, unknown>).secretBackdoor, undefined, 'کلید غیرمجاز هرگز ذخیره نمی‌شود')
    const backdoorRow = await prisma.setting.findUnique({ where: { key: 'secretBackdoor' } })
    assertEquals(backdoorRow, null, 'در DB هم نباید سطر ساخته شود')
  })

  await check('بازگرداندن تنظیمات به وضعیت فیکسچر', async () => {
    const r = await admin.req('PUT', '/api/settings', { values: { siteName: 'سایت هارنس', postsPerPage: '10' } })
    expectStatus(r, 200, 'بازگردانی')
    const s = await snapshotSettings()
    assertEquals(s.siteName, 'سایت هارنس')
    assertEquals(s.postsPerPage, '10')
  })

  // اطمینان از این که فیکسچر دست‌نخورده مانده (بدون سطر اضافی)
  await check('تعداد سطرهای تنظیمات با فیکسچر برابر است', async () => {
    const count = await prisma.setting.count()
    assertEquals(count, 3)
    assert(!!fixture.users.viewer, 'فیکسچر باید سالم باشد')
  })
}
