/**
 * مرکز سلامت و کیفیت محتوا
 * GET    /api/health — پویش کامل مشکلات (بدون موارد نادیده‌گرفته‌شده)
 * POST   /api/health — نادیده‌گرفتن یک مورد با دلیل { issueKey, reason }
 * DELETE /api/health?issueKey=... — لغو نادیده‌گرفتن
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { scanHealthIssues } from '@/lib/health-scan'

export async function GET() {
  try {
    await requirePermission('articles.view')
    const [scan, ignoredRows] = await Promise.all([
      scanHealthIssues(),
      db.healthIgnore.findMany({ orderBy: { createdAt: 'desc' } }),
    ])
    const ignoredKeys = new Set(ignoredRows.map((i) => i.issueKey))
    const active = scan.filter((i) => !ignoredKeys.has(i.key))

    const counts = {
      HIGH: active.filter((i) => i.severity === 'HIGH').length,
      MEDIUM: active.filter((i) => i.severity === 'MEDIUM').length,
      LOW: active.filter((i) => i.severity === 'LOW').length,
    }

    return ok({
      issues: active,
      counts,
      ignored: ignoredRows,
      total: active.length,
      scannedAt: new Date().toISOString(),
    })
  } catch (err) {
    return handleApiError(err)
  }
}

interface IgnoreBody {
  issueKey?: unknown
  reason?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('articles.view')
    const body = await parseBody<IgnoreBody>(req)

    const issueKey = vString(body.issueKey, 'شناسه مشکل', { required: true, max: 200 })
    const reason = vString(body.reason, 'دلیل', { required: true, min: 3, max: 300 })

    const ignore = await db.healthIgnore.upsert({
      where: { issueKey },
      create: { issueKey, reason, ignoredById: user.id, ignoredByName: user.name },
      update: { reason, ignoredById: user.id, ignoredByName: user.name },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'HEALTH_ISSUE',
      entityId: issueKey,
      entityTitle: 'نادیده‌گرفتن مشکل سلامت محتوا',
      details: `دلیل: ${reason}`,
    })

    return ok(ignore, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requirePermission('articles.view')
    const { searchParams } = new URL(req.url)
    const issueKey = searchParams.get('issueKey') ?? ''
    if (!issueKey) throw new ApiError(400, 'شناسه مشکل الزامی است.')

    await db.healthIgnore.deleteMany({ where: { issueKey } })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: 'HEALTH_ISSUE',
      entityId: issueKey,
      entityTitle: 'لغو نادیده‌گرفتن مشکل سلامت محتوا',
      details: 'مورد دوباره در فهرست بررسی قرار گرفت',
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
