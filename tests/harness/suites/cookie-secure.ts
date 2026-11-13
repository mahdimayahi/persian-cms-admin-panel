/**
 * سویت ۵ — قرارداد کوکی نشست و اعتماد به پروکسی معکوس
 * قرارداد: تنها نخستین مقدار x-forwarded-proto (هدر پروکسی معکوس معتبر) مبنای Secure است.
 *  - اتصال HTTP مستقیم (بدون پروکسی) → کوکی بدون Secure
 *  - پروکسی با x-forwarded-proto: https → کوکی Secure
 *  - زنجیرهٔ پروکسی (https, http) → مقدار hop نخست ملاک است → Secure
 */
import { assert, assertEquals, check } from '../checks'
import { HARNESS_PASSWORD } from '../fixture'
import type { Fixture } from '../fixture'
import { Api } from '../http'

type Ctx = { fixture: Fixture }

function cookieFlags(setCookies: string[]): { hasSecure: boolean; hasHttpOnly: boolean; hasSameSiteLax: boolean; sessionCookie?: string } {
  const sessionCookie = setCookies.find((c) => c.startsWith('cms_session='))
  if (!sessionCookie) return { hasSecure: false, hasHttpOnly: false, hasSameSiteLax: false }
  const attrs = sessionCookie.split(';').map((p) => p.trim().toLowerCase())
  return {
    hasSecure: attrs.includes('secure'),
    hasHttpOnly: attrs.includes('httponly'),
    hasSameSiteLax: attrs.includes('samesite=lax'),
    sessionCookie,
  }
}

export async function runCookieSecureSuite(ctx: Ctx) {
  const { fixture } = ctx
  const adminEmail = fixture.users.admin.email

  console.log('\n▶ سویت: کوکی Secure — قرارداد اعتماد به پروکسی (x-forwarded-proto)')

  await check('ورود روی HTTP مستقیم (بدون هدر پروکسی) → کوکی بدون Secure، با HttpOnly و SameSite=Lax', async () => {
    const api = new Api('بدون پروکسی')
    const r = await api.login(adminEmail, HARNESS_PASSWORD)
    assertEquals(r.status, 200, 'ورود باید موفق شود')
    const flags = cookieFlags(r.setCookies)
    assertEquals(flags.hasSecure, false, 'روی HTTP خام Secure نباید باشد (توسعه/localhost)')
    assertEquals(flags.hasHttpOnly, true)
    assertEquals(flags.hasSameSiteLax, true)
    assert(flags.sessionCookie !== undefined, 'کوکی نشست باید ست شود')
  })

  await check('ورود با x-forwarded-proto: https (پروکسی معتبر) → کوکی Secure', async () => {
    const api = new Api('پروکسی https')
    const r = await api.login(adminEmail, HARNESS_PASSWORD, { 'x-forwarded-proto': 'https' })
    assertEquals(r.status, 200)
    const flags = cookieFlags(r.setCookies)
    assertEquals(flags.hasSecure, true, 'در استقرار HTTPS کوکی نشست باید Secure باشد')
    assertEquals(flags.hasHttpOnly, true)
    assertEquals(flags.hasSameSiteLax, true)
  })

  await check('زنجیرهٔ پروکسی (x-forwarded-proto: https, http) → مقدار hop نخست ملاک → Secure', async () => {
    const api = new Api('زنجیرهٔ پروکسی')
    const r = await api.login(adminEmail, HARNESS_PASSWORD, { 'x-forwarded-proto': 'https, http' })
    assertEquals(r.status, 200)
    const flags = cookieFlags(r.setCookies)
    assertEquals(flags.hasSecure, true, 'فقط نخستین hop خوانده می‌شود (https)')
  })

  await check('x-forwarded-proto: http روی HTTP خام → بدون Secure (مطابق قرارداد)', async () => {
    const api = new Api('پروکسی http')
    const r = await api.login(adminEmail, HARNESS_PASSWORD, { 'x-forwarded-proto': 'http' })
    assertEquals(r.status, 200)
    const flags = cookieFlags(r.setCookies)
    assertEquals(flags.hasSecure, false)
  })

  await check('رمز نادرست → ۴۰۱ با پیام یکسان (بدون افشای وجود حساب) و بدون کوکی', async () => {
    const api = new Api('رمز غلط')
    const r = await api.login(adminEmail, 'wrong-password-123', { 'x-forwarded-proto': 'https' })
    assertEquals(r.status, 401)
    assertEquals(r.setCookies.length, 0, 'در ورود ناموفق کوکی نشست نباید ست شود')
  })

  await check('کوکی نشست برای درخواست محافظت‌شده کافی است (GET /api/settings با کوکی admin)', async () => {
    const api = new Api('با کوکی')
    const r = await api.login(adminEmail, HARNESS_PASSWORD)
    assertEquals(r.status, 200)
    const s = await api.req('GET', '/api/settings')
    assertEquals(s.status, 200, 'کوکی HttpOnly نشست باید معتبر باشد')
  })
}
