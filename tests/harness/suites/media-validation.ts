/**
 * سویت ۶ — راستی‌آزمایی رسانه: فایل جعلی/خراب رد می‌شود و هرگز ذخیره نمی‌شود
 * (رسانه در جدول Media با data پایه۶۴ ذخیره می‌شود؛ «عدم ذخیره» = عدم ساخت سطر)
 */
import { assert, assertEquals, check } from '../checks'
import type { Fixture } from '../fixture'
import type { PrismaClient } from '@prisma/client'
import { Api, expectStatus } from '../http'

type Ctx = { prisma: PrismaClient; fixture: Fixture; admin: Api }

/** PNG واقعی ۱×۱ پیکسل */
const VALID_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function formWith(bytes: Uint8Array, name: string, mime: string): FormData {
  const fd = new FormData()
  fd.append('file', new Blob([bytes as BlobPart], { type: mime }), name)
  return fd
}

export async function runMediaValidationSuite(ctx: Ctx) {
  const { prisma, admin } = ctx

  console.log('\n▶ سویت: رسانه — magic bytes و سلامت فایل')

  await check('فایل متنی با MIME جعلی image/png → ۴۱۵ و بدون سطر در DB', async () => {
    const before = await prisma.media.count()
    const fake = new TextEncoder().encode('this is definitely not a png image, just plain text')
    const r = await admin.req('POST', '/api/media', undefined, {
      form: formWith(fake, 'fake-image.png', 'image/png'),
    })
    expectStatus(r, 415, 'فایل جعلی')
    const after = await prisma.media.count()
    assertEquals(after, before, 'فایل جعلی نباید ذخیره شود')
  })

  await check('PNG خراب (امضای درست + بدنهٔ ناقص) → ۴۱۵ و بدون سطر در DB', async () => {
    const before = await prisma.media.count()
    // امضای PNG درست + ۴۰۰ بایت آشغال — sharp باید شکست بخورد
    const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const junk = new Uint8Array(400).fill(0x41)
    const corrupt = new Uint8Array([...sig, ...junk])
    const r = await admin.req('POST', '/api/media', undefined, {
      form: formWith(corrupt, 'corrupt-image.png', 'image/png'),
    })
    expectStatus(r, 415, 'فایل خراب')
    const after = await prisma.media.count()
    assertEquals(after, before, 'فایل خراب نباید ذخیره شود')
  })

  await check('PNG واقعی ۱×۱ → پذیرفته می‌شود، سطر DB ساخته می‌شود و data پایه۶۴ کامل است', async () => {
    const before = await prisma.media.count()
    const bytes = Uint8Array.from(atob(VALID_PNG_B64), (c) => c.charCodeAt(0))
    const r = await admin.req<{ id?: string }>('POST', '/api/media', undefined, {
      form: formWith(bytes, 'valid-1x1.png', 'image/png'),
    })
    assertEquals(r.status >= 200 && r.status < 300, true, `PNG سالم باید پذیرفته شود (وضعیت: ${r.status}) — بدنه: ${JSON.stringify(r.body)?.slice(0, 300)}`)
    const after = await prisma.media.count()
    assertEquals(after, before + 1, 'دقیقاً یک سطر رسانه باید ساخته شود')
    const row = await prisma.media.findFirst({ orderBy: { createdAt: 'desc' } })
    assert(row !== null, 'سطر رسانه باید موجود باشد')
    assertEquals(row.mimeType, 'image/png', 'نوع ذخیره‌شده از محتوای واقعی تعیین می‌شود')
    assert(row.data.length > 0, 'دادهٔ فایل باید ذخیره شده باشد')
    assert(row.id !== null && row.id !== undefined)
  })

  await check('MIME غیرمجاز (متن ساده) → ۴۱۵ پیش از خواندن محتوا', async () => {
    const before = await prisma.media.count()
    const txt = new TextEncoder().encode('plain text file')
    const r = await admin.req('POST', '/api/media', undefined, {
      form: formWith(txt, 'note.txt', 'text/plain'),
    })
    expectStatus(r, 415, 'نوع غیرمجاز')
    assertEquals(await prisma.media.count(), before)
  })

  await check('درخواست بدون فایل → ۴۰۰', async () => {
    const fd = new FormData()
    fd.append('altText', 'بدون فایل')
    const r = await admin.req('POST', '/api/media', undefined, { form: fd })
    expectStatus(r, 400, 'بدون فایل')
  })
}
