'use client'

/** قالب‌بندی فارسی: تاریخ شمسی، اعداد، حجم فایل، زمان نسبی */

const TZ = 'Asia/Tehran'

export function toFa(n: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('fa-IR', opts).format(n)
}

export function faDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeZone: TZ }).format(date)
}

export function faDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(date)
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  const diff = Date.now() - date.getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'همین حالا'
  const m = Math.floor(s / 60)
  if (m < 60) return `${toFa(m)} دقیقه پیش`
  const h = Math.floor(m / 60)
  if (h < 24) return `${toFa(h)} ساعت پیش`
  const days = Math.floor(h / 24)
  if (days < 7) return `${toFa(days)} روز پیش`
  return faDate(date)
}

export function faBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${toFa(bytes)} بایت`
  if (bytes < 1024 * 1024) return `${toFa(bytes / 1024, { maximumFractionDigits: 1 })} کیلوبایت`
  return `${toFa(bytes / (1024 * 1024), { maximumFractionDigits: 2 })} مگابایت`
}

/** کلید روز به‌صورت YYYY-MM-DD (UTC) */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** برچسب روز شمسی برای نمودار */
export function shortFaDate(d: string): string {
  const date = new Date(d + 'T12:00:00Z')
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'short', day: 'numeric', timeZone: TZ }).format(date)
}

/** پاک‌سازی متن ورودی کاربر در خروجی‌ها (ضد Formula Injection) */
export function csvSafe(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`
  return value
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (v: string | number) => {
    const s = typeof v === 'number' ? String(v) : csvSafe(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const csv = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
