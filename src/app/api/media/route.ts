/**
 * API رسانه
 * GET  /api/media — فهرست فایل‌ها با جست‌وجو و صفحه‌بندی (بدون فیلد سنگین data)
 * POST /api/media — بارگذاری فایل (multipart/form-data با فیلد file و اختیاری altText)
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ApiError,
  ok,
  handleApiError,
  requirePermission,
  vString,
  slugify,
  getPaginationParams,
} from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { MAX_UPLOAD_SIZE, ALLOWED_MIME_TYPES } from '@/lib/constants'

export const runtime = 'nodejs'

/** فیلدهای عمومی رسانه؛ فیلد data (base64) هرگز در پاسخ فهرست/ایجاد برنمی‌گردد */
const mediaSelect = {
  id: true,
  filename: true,
  originalName: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  altText: true,
  uploadedById: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.MediaSelect

/** نگاشت نوع فایل به پسوند ایمن */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

/**
 * تشخیص نوع واقعی فایل از امضای باینری (magic bytes).
 * ادعای MIME کلاینت قابل جعل است؛ نوع ذخیره‌شده فقط بر اساس محتوای واقعی تعیین می‌شود.
 */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null
  const hex = buf.subarray(0, 12).toString('hex')
  const ascii = buf.subarray(0, 12).toString('latin1')
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp'
  if (ascii.startsWith('%PDF-')) return 'application/pdf'
  return null
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('media.view')
    const sp = req.nextUrl.searchParams
    const { page, pageSize, skip, take } = getPaginationParams(sp)

    const q = sp.get('q')?.trim() ?? ''
    const mimeTypeParam = sp.get('mimeType')?.trim() ?? ''

    const where: Prisma.MediaWhereInput = {}
    if (q) where.OR = [{ originalName: { contains: q } }, { altText: { contains: q } }]
    if (mimeTypeParam) {
      // تطبیق پیشوندی: «image» با همه تصاویر (image/*) مطابقت دارد
      where.mimeType = { startsWith: mimeTypeParam.includes('/') ? mimeTypeParam : `${mimeTypeParam}/` }
    }

    const [items, total] = await Promise.all([
      db.media.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, select: mediaSelect }),
      db.media.count({ where }),
    ])

    return ok({ items, total, page, pageSize })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('media.upload')

    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') throw new ApiError(400, 'فایلی ارسال نشده است.')

    if (file.size > MAX_UPLOAD_SIZE) {
      throw new ApiError(413, 'حجم فایل نباید بیش از ۵ مگابایت باشد.')
    }

    const mimeType = file.type || ''
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new ApiError(415, 'نوع فایل مجاز نیست. فرمت‌های مجاز: PNG، JPEG، WebP، GIF، PDF')
    }

    const rawName = typeof file.name === 'string' && file.name.trim() !== '' ? file.name : 'فایل بدون نام'
    const originalName = vString(rawName, 'نام فایل', { max: 200 })

    const buffer = Buffer.from(await file.arrayBuffer())

    // راستی‌آزمایی نوع واقعی فایل: ادعای MIME باید با امضای باینری محتوا مطابقت داشته باشد
    // (فایل غیرتصویری با MIME جعلی تصویر اینجا رد می‌شود و هرگز ذخیره نمی‌شود)
    const sniffed = sniffMime(buffer)
    if (!sniffed || sniffed !== mimeType) {
      throw new ApiError(415, 'محتوای فایل با نوع اعلام‌شده مطابقت ندارد یا نوع آن پشتیبانی نمی‌شود.')
    }

    // استخراج ابعاد تصویر و راستی‌آزمایی سلامت فایل:
    // تصویر خراب/بریده‌شده باید کامل شکست بخورد و بدون ذخیره‌سازی رد شود
    let width: number | null = null
    let height: number | null = null
    if (mimeType.startsWith('image/')) {
      try {
        const sharp = (await import('sharp')).default
        const meta = await sharp(buffer).metadata()
        if (!meta.width || !meta.height) throw new Error('تصویر فاقد ابعاد معتبر است')
        width = meta.width
        height = meta.height
      } catch {
        throw new ApiError(415, 'فایل تصویری معتبر نیست یا خراب است.')
      }
    }

    // ساخت نام امن فایل روی سرور
    const dotIndex = originalName.lastIndexOf('.')
    const baseName = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName
    const ext =
      dotIndex > 0 && dotIndex < originalName.length - 1
        ? originalName.slice(dotIndex + 1).toLowerCase()
        : MIME_EXT[mimeType] || 'bin'
    const filename = `${Date.now()}-${slugify(baseName)}.${ext}`

    const altText = vString(form.get('altText'), 'متن جایگزین', { max: 300 })

    const media = await db.media.create({
      data: {
        filename,
        originalName,
        mimeType,
        size: file.size,
        width,
        height,
        altText,
        data: buffer.toString('base64'),
        uploadedById: user.id,
      },
      select: mediaSelect,
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPLOAD',
      entityType: 'MEDIA',
      entityId: media.id,
      entityTitle: originalName,
      details: 'بارگذاری فایل جدید',
    })

    return ok(media)
  } catch (err) {
    return handleApiError(err)
  }
}
