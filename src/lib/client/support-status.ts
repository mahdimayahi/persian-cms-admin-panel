'use client'

/**
 * نگاشت مشترک وضعیت گزارش‌های پشتیبانی — برچسب فارسی و رنگ (توکن‌های معنایی)
 * وضعیت‌های پنج‌گانه: NEW | IN_PROGRESS | NEED_INFO | RESOLVED | CLOSED
 * ردیف‌های قدیمی با وضعیت OPEN مانند NEW نمایش داده می‌شوند.
 */

export const SUPPORT_STATUSES = ['NEW', 'IN_PROGRESS', 'NEED_INFO', 'RESOLVED', 'CLOSED'] as const

export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

export type SupportStatusMeta = { label: string; colorClass: string; bgClass: string }

export const SUPPORT_STATUS_META: Record<SupportStatus, SupportStatusMeta> = {
  NEW: {
    label: 'دریافت‌شده',
    colorClass: 'text-info',
    bgClass: 'bg-info/10',
  },
  IN_PROGRESS: {
    label: 'در حال بررسی',
    colorClass: 'text-warning',
    bgClass: 'bg-warning/10',
  },
  NEED_INFO: {
    label: 'نیازمند اطلاعات بیشتر',
    colorClass: 'text-warning',
    bgClass: 'bg-warning/15',
  },
  RESOLVED: {
    label: 'حل‌شده',
    colorClass: 'text-success',
    bgClass: 'bg-success/10',
  },
  CLOSED: {
    label: 'بسته‌شده',
    colorClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
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
