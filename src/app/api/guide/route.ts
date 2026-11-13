/**
 * راهنمای نقش‌محور (Onboarding Guide)
 * GET  /api/guide — وضعیت پیشرفت راهنمای کاربر جاری (رکورد به‌صورت خودکار ساخته می‌شود)
 * POST /api/guide — ثبت رویداد / رد کردن / بازنشانی راهنما
 *
 * قاعدهٔ کلیدی: گام راهنما فقط با «رویداد موفق واقعی» تکمیل می‌شود و
 * تنها وقتی مجوز مؤثر نقش کاربر آن گام را اجازه دهد.
 * اولویت پردازش بدنه: reset > dismiss > event
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody } from '@/lib/api-utils'
import { Permission, ROLE_PERMISSIONS, type Role } from '@/lib/permissions'

/** نسخهٔ محتوای راهنما — با تغییر محتوا افزایش داده می‌شود */
export const GUIDE_VERSION = '1'

/** مالک محتوای راهنما (برای نمایش و نگهداری مستندات) */
export const GUIDE_OWNER = 'تیم مستندات'

/** نگاشت رویداد سامانه → گام راهنما + مجوز لازم برای آن گام */
const EVENT_STEPS: Record<string, { step: string; perm: Permission }> = {
  'article.first_draft_saved': { step: 'first_draft', perm: 'articles.create' },
  'article.content_completed': { step: 'content_complete', perm: 'articles.create' },
  'article.sent_to_review': { step: 'sent_review', perm: 'articles.create' },
  'article.reviewed': { step: 'review_done', perm: 'articles.review' },
  'article.revision_requested': { step: 'review_done', perm: 'articles.review' },
  'article.approved': { step: 'approve_version', perm: 'articles.review' },
  'bundle.published': { step: 'first_bundle', perm: 'articles.publish' },
  'user.created': { step: 'invite_teammate', perm: 'users.manage' },
  'roles.updated': { step: 'permissions_set', perm: 'users.manage' },
  'settings.saved': { step: 'settings_reviewed', perm: 'settings.manage' },
}

/** خواندن امن JSON آرایهٔ گام‌ها */
function parseSteps(raw: string): string[] {
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}

/** شکل پاسخ GET: گام‌های انجام‌شده، وضعیت رد کردن و نسخه */
function toShape(progress: { stepsDone: string; dismissedAt: Date | null; version: string }) {
  return {
    stepsDone: parseSteps(progress.stepsDone),
    dismissedAt: progress.dismissedAt ? progress.dismissedAt.toISOString() : null,
    version: progress.version,
  }
}

/** یافتن یا ساختن رکورد پیشرفت راهنما برای کاربر */
async function ensureProgress(userId: string) {
  const existing = await db.guideProgress.findUnique({ where: { userId } })
  if (existing) return existing
  try {
    return await db.guideProgress.create({ data: { userId, stepsDone: '[]', version: GUIDE_VERSION } })
  } catch {
    // مسابقهٔ هم‌زمان: رکورد توسط درخواست موازی ساخته شده است
    const rec = await db.guideProgress.findUnique({ where: { userId } })
    if (rec) return rec
    throw new ApiError(500, 'خطا در ذخیرهٔ پیشرفت راهنما.')
  }
}

export async function GET() {
  try {
    const user = await requireAuth()
    const progress = await ensureProgress(user.id)
    return ok(toShape(progress))
  } catch (err) {
    return handleApiError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const body = await parseBody<{ event?: unknown; dismiss?: unknown; reset?: unknown }>(req)

    // مجوزهای مؤثر از نقش کاربر — نقش تازه از دیتابیس خوانده می‌شود
    const dbUser = await db.user.findUnique({ where: { id: session.id }, select: { role: true } })
    const perms: Permission[] = dbUser ? (ROLE_PERMISSIONS[dbUser.role as Role] ?? []) : []

    // ۱) بازنشانی: پاک کردن گام‌ها و رد کردن؛ نسخهٔ راهنما حفظ می‌شود
    if (body.reset === true) {
      await ensureProgress(session.id)
      const updated = await db.guideProgress.update({
        where: { userId: session.id },
        data: { stepsDone: '[]', dismissedAt: null },
      })
      return ok(toShape(updated))
    }

    // ۲) رد کردن راهنما
    if (body.dismiss === true) {
      await ensureProgress(session.id)
      const updated = await db.guideProgress.update({
        where: { userId: session.id },
        data: { dismissedAt: new Date() },
      })
      return ok(toShape(updated))
    }

    // ۳) ثبت رویداد — گام فقط با رویداد شناخته‌شده و مجوز مؤثر نقش تکمیل می‌شود (ایدمپوتنت)
    const progress = await ensureProgress(session.id)
    const stepsDone = parseSteps(progress.stepsDone)
    const newlyDone: string[] = []

    if (typeof body.event === 'string') {
      const mapped = EVENT_STEPS[body.event]
      // رویداد ناشناخته: بدون خطا، فقط وضعیت فعلی برگردانده می‌شود
      if (mapped && perms.includes(mapped.perm) && !stepsDone.includes(mapped.step)) {
        stepsDone.push(mapped.step)
        newlyDone.push(mapped.step)
        await db.guideProgress.update({
          where: { userId: session.id },
          data: { stepsDone: JSON.stringify(stepsDone) },
        })
      }
    }

    return ok({
      stepsDone,
      newlyDone,
      dismissedAt: progress.dismissedAt ? progress.dismissedAt.toISOString() : null,
      version: progress.version,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
