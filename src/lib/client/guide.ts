/**
 * کمک‌تابع سمت کلاینت برای راهنمای شروع کار.
 * رویدادها fire-and-forget ارسال می‌شوند — هیچ‌گاه جریان اصلی فراخواننده را قطع نمی‌کنند.
 * سرور گام را فقط با مجوز مؤثر و رویداد شناخته‌شده ثبت می‌کند (ایدمپوتنت).
 */
import { apiPost } from './api'

/** شکل پاسخ /api/guide — همان شکل GET */
type GuideProgress = {
  stepsDone: string[]
  newlyDone?: string[]
  dismissedAt: string | null
  version: string
}

/**
 * ثبت یک رویداد راهنما در سرور و اطلاع‌رسانی به کامپوننت‌های باز راهنما.
 * نمونهٔ فراخوانی: void notifyGuideEvent('article.first_draft_saved')
 */
export async function notifyGuideEvent(event: string): Promise<void> {
  try {
    const res = await apiPost<GuideProgress>('/api/guide', { event })
    // کامپوننت‌های باز راهنما (چک‌لیست داشبورد/حساب من) با شنیدن این رویداد نوسازی می‌شوند
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<GuideProgress>('guide-progress', { detail: res }))
    }
  } catch {
    // راهنما هرگز نباید کاری که کاربر انجام داده را با خطا مزاحم کند — خطا نادیده گرفته می‌شود
  }
}
