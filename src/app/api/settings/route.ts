/**
 * تنظیمات عمومی سامانه
 * GET /api/settings — مشاهده تنظیمات (مجوز settings.view)
 * PUT /api/settings — به‌روزرسانی تنظیمات (مجوز settings.manage)
 * تنظیمات به‌صورت { [key]: value } و همه مقادیر به‌صورت رشته ذخیره می‌شوند
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'

/** کلیدهای مجاز تنظیمات */
const ALLOWED_KEYS = [
  'siteName',
  'siteDescription',
  'contactEmail',
  'defaultLanguage',
  'timezone',
  'postsPerPage',
  'allowComments',
  'maintenanceMode',
] as const

type SettingKey = (typeof ALLOWED_KEYS)[number]

/** خواندن همه تنظیمات به‌صورت شیء کلید/مقدار */
async function loadSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany()
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}

/** نرمال‌سازی مقدار به رشته؛ در صورت نامعتبر بودن null برمی‌گرداند */
function normalizeValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return null
}

export async function GET() {
  try {
    await requirePermission('settings.view')
    return ok(await loadSettings())
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission('settings.manage')
    const body = await parseBody<{ values?: unknown }>(req)

    const values = body.values
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new ApiError(400, 'مقادیر تنظیمات نامعتبر است.')
    }
    const raw = values as Record<string, unknown>

    // نام سامانه الزامی است
    vString(raw.siteName, 'نام سامانه', { required: true, max: 100 })

    // فقط کلیدهای مجاز ذخیره می‌شوند
    for (const key of ALLOWED_KEYS as readonly SettingKey[]) {
      if (!(key in raw)) continue
      const value = normalizeValue(raw[key])
      if (value === null) continue
      await db.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }

    await logActivity({
      userId: actor.id,
      userName: actor.name,
      action: 'UPDATE',
      entityType: 'SETTINGS',
      entityTitle: 'تنظیمات سامانه',
      details: 'به‌روزرسانی تنظیمات عمومی',
    })

    return ok(await loadSettings())
  } catch (err) {
    return handleApiError(err)
  }
}
