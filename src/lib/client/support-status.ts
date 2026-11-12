'use client'

/**
 * نگاشت مشترک وضعیت گزارش‌های پشتیبانی — برچسب فارسی و رنگ (بدون آبی/نیلی)
 * وضعیت‌های پنج‌گانه: NEW | IN_PROGRESS | NEED_INFO | RESOLVED | CLOSED
 * ردیف‌های قدیمی با وضعیت OPEN مانند NEW نمایش داده می‌شوند.
 */

export const SUPPORT_STATUSES = ['NEW', 'IN_PROGRESS', 'NEED_INFO', 'RESOLVED', 'CLOSED'] as const

export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

export type SupportStatusMeta = { label: string; colorClass: string; bgClass: string }

export const SUPPORT_STATUS_META: Record<SupportStatus, SupportStatusMeta> = {
  NEW: {
    label: 'دریافت‌شده',
    colorClass: 'text-emerald-700 dark:text-emerald-400',
    bgClass: 'bg-emerald-100 dark:bg-emerald-950/60',
  },
  IN_PROGRESS: {
    label: 'در حال بررسی',
    colorClass: 'text-amber-700 dark:text-amber-400',
    bgClass: 'bg-amber-100 dark:bg-amber-950/60',
  },
  NEED_INFO: {
    label: 'نیازمند اطلاعات بیشتر',
    colorClass: 'text-violet-700 dark:text-violet-400',
    bgClass: 'bg-violet-100 dark:bg-violet-950/60',
  },
  RESOLVED: {
    label: 'حل‌شده',
    colorClass: 'text-teal-700 dark:text-teal-400',
    bgClass: 'bg-teal-100 dark:bg-teal-950/60',
  },
  CLOSED: {
    label: 'بسته‌شده',
    colorClass: 'text-slate-700 dark:text-slate-400',
    bgClass: 'bg-slate-100 dark:bg-slate-950/60',
  },
}

/** نرمال‌سازی وضعیت برای نمایش (OPEN→NEW؛ مقادیر ناشناخته مانند NEW) */
export function normalizeSupportStatus(status: string): SupportStatus {
  const mapped = status === 'OPEN' ? 'NEW' : status
  return ((SUPPORT_STATUSES as readonly string[]).includes(mapped) ? mapped : 'NEW') as SupportStatus
}

/** اطلاعات نمایشی وضعیت با نرمال‌سازی خودکار — برای StatusBadge */
export function supportStatusInfo(status: string): SupportStatusMeta {
  return SUPPORT_STATUS_META[normalizeSupportStatus(status)]
}
