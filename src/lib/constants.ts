/**
 * ثابت‌های مشترک سامانه (بین سرور و رابط کاربری)
 */

export type ArticleStatus = 'DRAFT' | 'IN_REVIEW' | 'NEEDS_REVISION' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED'

export const ARTICLE_STATUSES: { value: ArticleStatus; label: string; color: string; bg: string }[] = [
  { value: 'DRAFT', label: 'پیش‌نویس', color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' },
  { value: 'IN_REVIEW', label: 'در انتظار بررسی', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950' },
  { value: 'NEEDS_REVISION', label: 'نیازمند اصلاح', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-950' },
  { value: 'APPROVED', label: 'تأییدشده', color: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-100 dark:bg-teal-950' },
  { value: 'PUBLISHED', label: 'منتشرشده', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950' },
  { value: 'ARCHIVED', label: 'بایگانی‌شده', color: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800' },
]

export function articleStatusInfo(status: string) {
  return ARTICLE_STATUSES.find((s) => s.value === status) ?? ARTICLE_STATUSES[0]
}

export type CommentStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export const COMMENT_STATUSES: { value: CommentStatus; label: string; color: string; bg: string }[] = [
  { value: 'PENDING', label: 'در انتظار بررسی', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950' },
  { value: 'APPROVED', label: 'تأییدشده', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950' },
  { value: 'REJECTED', label: 'ردشده', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950' },
]

export function commentStatusInfo(status: string) {
  return COMMENT_STATUSES.find((s) => s.value === status) ?? COMMENT_STATUSES[0]
}

export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'

export const USER_STATUSES: { value: UserStatus; label: string; color: string; bg: string }[] = [
  { value: 'INVITED', label: 'دعوت‌شده', color: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-100 dark:bg-sky-950' },
  { value: 'ACTIVE', label: 'فعال', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950' },
  { value: 'SUSPENDED', label: 'تعلیق‌شده', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-950' },
  { value: 'DISABLED', label: 'غیرفعال‌شده', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-950' },
]

export function userStatusInfo(status: string) {
  return USER_STATUSES.find((s) => s.value === status) ?? USER_STATUSES[0]
}

export const FORM_STATUSES: { value: 'NEW' | 'READ' | 'ARCHIVED'; label: string; color: string; bg: string }[] = [
  { value: 'NEW', label: 'جدید', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-950' },
  { value: 'READ', label: 'خوانده‌شده', color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800' },
  { value: 'ARCHIVED', label: 'بایگانی', color: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800' },
]

export function formStatusInfo(status: string) {
  return FORM_STATUSES.find((s) => s.value === status) ?? FORM_STATUSES[0]
}

/** اجازه‌های انتقال وضعیت مقاله */
export const TRANSITION_ACTIONS = ['SUBMIT_REVIEW', 'APPROVE', 'REJECT', 'PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'BACK_TO_DRAFT'] as const
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number]

export const TRANSITION_LABELS: Record<TransitionAction, string> = {
  SUBMIT_REVIEW: 'ارسال برای بازبینی',
  APPROVE: 'تأیید محتوا',
  REJECT: 'بازگشت برای اصلاح',
  PUBLISH: 'انتشار مقاله',
  UNPUBLISH: 'لغو انتشار',
  ARCHIVE: 'بایگانی',
  BACK_TO_DRAFT: 'بازگشت به پیش‌نویس',
}

/** حداکثر حجم فایل رسانه: ۵ مگابایت */
export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'] as const
