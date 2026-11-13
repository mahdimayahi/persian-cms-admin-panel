/**
 * سویت ۰ — طبقه‌بندی خطاهای پایگاه داده (واحد)
 * هدف: تفکیک صریح تعارض واقعی / خطای موقت / خطای داخلی بدون پنهان‌کردن علت
 */
import { check, assertEquals, assert } from '../checks'

export async function runDbErrorsSuite() {
  const { classifyPrismaError } = await import('@/lib/db-errors')

  console.log('\n▶ سویت: طبقه‌بندی کدهای خطای Prisma')

  await check('P2002 → 409 تعارض یکتایی (conflict، غیر transient، با کد)', () => {
    const c = classifyPrismaError({ code: 'P2002' })
    assert(c, 'P2002 باید طبقه‌بندی شود')
    assertEquals(c.status, 409)
    assertEquals(c.conflict, true)
    assertEquals(c.transient, false)
    assertEquals(c.code, 'P2002')
    assert(c.message.length > 10, 'پیام فارسی باید معنی‌دار باشد')
  })

  await check('P2034 → 409 رقابت نوشتن هم‌زمان (conflict + transient)', () => {
    const c = classifyPrismaError({ code: 'P2034' })
    assert(c, 'P2034 باید طبقه‌بندی شود')
    assertEquals(c.status, 409)
    assertEquals(c.conflict, true)
    assertEquals(c.transient, true)
  })

  await check('P2028 → 503 خطای موقت تراکنش (نه ۴۰۹ تعارض — علت گمراه‌کننده نیست)', () => {
    const c = classifyPrismaError({ code: 'P2028' })
    assert(c, 'P2028 باید طبقه‌بندی شود')
    assertEquals(c.status, 503)
    assertEquals(c.conflict, false, 'P2028 تعارض نسخه نیست و نباید ۴۰۹ شود')
    assertEquals(c.transient, true)
    assertEquals(c.code, 'P2028')
  })

  await check('P2024 → 503 خطای موقت ظرفیت اتصال', () => {
    const c = classifyPrismaError({ code: 'P2024' })
    assert(c)
    assertEquals(c.status, 503)
    assertEquals(c.transient, true)
    assertEquals(c.conflict, false)
  })

  await check('کد ناشناختهٔ Prisma (P9999) → null (خطای داخلی عمومی با لاگ علت)', () => {
    assertEquals(classifyPrismaError({ code: 'P9999' }), null)
  })

  await check('خطای بدون کد / غیر Prisma → null', () => {
    assertEquals(classifyPrismaError(new Error('ordinary')), null)
    assertEquals(classifyPrismaError(null), null)
    assertEquals(classifyPrismaError({ code: 'NOT_P' }), null)
  })
}
