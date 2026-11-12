/**
 * ثابت‌های مشترک سامانه (بین سرور و رابط کاربری)
 */

export type ArticleStatus = 'DRAFT' | 'IN_REVIEW' | 'NEEDS_REVISION' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED'

export const ARTICLE_STATUSES: { value: ArticleStatus; label: string; color: string; bg: string }[] = [
  { value: 'DRAFT', label: 'پیش‌نویس', color: 'text-muted-foreground', bg: 'bg-muted' },
  { value: 'IN_REVIEW', label: 'در انتظار بررسی', color: 'text-warning', bg: 'bg-warning/10' },
  { value: 'NEEDS_REVISION', label: 'نیازمند اصلاح', color: 'text-warning', bg: 'bg-warning/15' },
  { value: 'APPROVED', label: 'تأییدشده', color: 'text-primary', bg: 'bg-primary/10' },
  { value: 'PUBLISHED', label: 'منتشرشده', color: 'text-success', bg: 'bg-success/10' },
  { value: 'ARCHIVED', label: 'بایگانی‌شده', color: 'text-muted-foreground', bg: 'bg-muted' },
]

export function articleStatusInfo(status: string) {
  return ARTICLE_STATUSES.find((s) => s.value === status) ?? ARTICLE_STATUSES[0]
}

export type CommentStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export const COMMENT_STATUSES: { value: CommentStatus; label: string; color: string; bg: string }[] = [
  { value: 'PENDING', label: 'در انتظار بررسی', color: 'text-warning', bg: 'bg-warning/10' },
  { value: 'APPROVED', label: 'تأییدشده', color: 'text-success', bg: 'bg-success/10' },
  { value: 'REJECTED', label: 'ردشده', color: 'text-destructive', bg: 'bg-destructive/10' },
]

export function commentStatusInfo(status: string) {
  return COMMENT_STATUSES.find((s) => s.value === status) ?? COMMENT_STATUSES[0]
}

export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'

export const USER_STATUSES: { value: UserStatus; label: string; color: string; bg: string }[] = [
  { value: 'INVITED', label: 'دعوت‌شده', color: 'text-info', bg: 'bg-info/10' },
  { value: 'ACTIVE', label: 'فعال', color: 'text-success', bg: 'bg-success/10' },
  { value: 'SUSPENDED', label: 'تعلیق‌شده', color: 'text-warning', bg: 'bg-warning/10' },
  { value: 'DISABLED', label: 'غیرفعال‌شده', color: 'text-destructive', bg: 'bg-destructive/10' },
]

export function userStatusInfo(status: string) {
  return USER_STATUSES.find((s) => s.value === status) ?? USER_STATUSES[0]
}

export const FORM_STATUSES: { value: 'NEW' | 'READ' | 'ARCHIVED'; label: string; color: string; bg: string }[] = [
  { value: 'NEW', label: 'جدید', color: 'text-success', bg: 'bg-success/10' },
  { value: 'READ', label: 'خوانده‌شده', color: 'text-muted-foreground', bg: 'bg-muted' },
  { value: 'ARCHIVED', label: 'بایگانی', color: 'text-muted-foreground', bg: 'bg-muted' },
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
