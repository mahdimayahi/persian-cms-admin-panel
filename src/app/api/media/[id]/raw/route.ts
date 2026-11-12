/**
 * API سرو محتوای فایل رسانه
 * GET /api/media/[id]/raw — بازگرداندن باینری فایل با هدر Content-Type مناسب (ویژه پنل مدیریت)
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, requirePermission } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('media.view')
    const { id } = await params

    const media = await db.media.findUnique({ where: { id }, select: { data: true, mimeType: true } })
    if (!media) throw new ApiError(404, 'فایل یافت نشد.')

    const buf = Buffer.from(media.data, 'base64')

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': media.mimeType,
        'Content-Length': String(buf.byteLength),
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
