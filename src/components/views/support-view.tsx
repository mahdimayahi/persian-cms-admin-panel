'use client'

import * as React from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, LifeBuoy } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  EmptyState,
  ErrorState,
  LoadingSpinner,
  PageHeader,
  StatusBadge,
} from '@/components/shared/ui-bits'
import { apiGet } from '@/lib/client/api'
import { faDateTime, timeAgo, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'

/**
 * کمک‌تابع محلی برای endpointهایی که فقط PATCH را می‌پذیرند
 * (کتابخانه api کلاینت متد PATCH ندارد) — با همان قرارداد خطای apiGet
 */
async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(b.error || 'خطا')
  }
  return res.json() as Promise<T>
}

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'

type Ticket = {
  id: string
  code: string
  userName: string
  userEmail: string
  page: string
  steps: string
  errorInfo: string | null
  userAgent: string | null
  status: TicketStatus
  createdAt: string
  resolvedAt: string | null
  resolvedByName: string | null
}

const PAGE_SIZE = 20

const STATUS_META: Record<TicketStatus, { label: string; colorClass: string; bgClass: string }> = {
  OPEN: {
    label: 'باز',
    colorClass: 'text-amber-700 dark:text-amber-400',
    bgClass: 'bg-amber-100 dark:bg-amber-950/60',
  },
  IN_PROGRESS: {
    label: 'در حال بررسی',
    colorClass: 'text-teal-700 dark:text-teal-400',
    bgClass: 'bg-teal-100 dark:bg-teal-950/60',
  },
  RESOLVED: {
    label: 'حل‌شده',
    colorClass: 'text-emerald-700 dark:text-emerald-400',
    bgClass: 'bg-emerald-100 dark:bg-emerald-950/60',
  },
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'همه' },
  { value: 'OPEN', label: 'باز' },
  { value: 'IN_PROGRESS', label: 'در حال بررسی' },
  { value: 'RESOLVED', label: 'حل‌شده' },
]

export function SupportView() {
  const can = useCan()
  const canManage = can('users.manage')

  const [items, setItems] = React.useState<Ticket[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState('all')
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // جلوگیری از تداخل پاسخ‌های درخواست‌های همزمان (صفحه‌بندی/فیلتر سریع)
  const seqRef = React.useRef(0)

  // غیرفعال‌سازی دکمه‌های همان گزارش در حین تغییر وضعیت
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      sp.set('page', String(page))
      sp.set('pageSize', String(PAGE_SIZE))
      if (status !== 'all') sp.set('status', status)
      const res = await apiGet<{ items: Ticket[]; total: number }>(`/api/support?${sp.toString()}`)
      if (seq !== seqRef.current) return
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : 'خطا در دریافت گزارش‌های پشتیبانی')
    } finally {
      if (seq === seqRef.current) {
        setLoaded(true)
        setLoading(false)
      }
    }
  }, [page, status])

  React.useEffect(() => {
    load()
  }, [load])

  const changeStatus = async (t: Ticket, next: 'IN_PROGRESS' | 'RESOLVED') => {
    setBusyId(t.id)
    try {
      await apiPatch(`/api/support/${t.id}`, { status: next })
      toast.success(
        next === 'RESOLVED' ? `گزارش ${t.code} حل‌شده علامت خورد.` : `بررسی گزارش ${t.code} آغاز شد.`
      )
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تغییر وضعیت گزارش ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (!loaded && loading) return <LoadingSpinner label="در حال بارگذاری گزارش‌های پشتیبانی…" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="گزارش‌های پشتیبانی"
        description="گزارش مشکلات کاربران با شناسه قابل‌ردگیری و اطلاعات فنی غیرحساس"
        icon={<LifeBuoy className="h-5 w-5" />}
      />

      {/* فیلتر وضعیت */}
      <div className="sm:max-w-xs">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="فیلتر وضعیت گزارش‌ها" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          title="گزارشی ثبت نشده است"
          description="به‌محض ثبت گزارش جدید توسط کاربران، در همین‌جا با شناسه قابل‌ردگیری نمایش داده می‌شود."
        />
      ) : (
        <>
          <div className="space-y-3">
            {items.map((t) => {
              const meta = STATUS_META[t.status]
              return (
                <div key={t.id} className="rounded-2xl border bg-card p-4 space-y-3 shadow-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono" dir="ltr">
                      {t.code}
                    </Badge>
                    <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                    <span className="text-sm font-medium">{t.userName}</span>
                    <span dir="ltr" className="text-xs text-muted-foreground truncate max-w-[220px]">
                      {t.userEmail}
                    </span>
                    <span className="text-xs text-muted-foreground ms-auto whitespace-nowrap">
                      {timeAgo(t.createdAt)}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-xs text-muted-foreground">صفحه: {t.page}</p>
                    <p className="text-sm leading-6 whitespace-pre-line">{t.steps}</p>
                    {t.errorInfo ? (
                      <pre
                        dir="ltr"
                        className="rounded-lg bg-muted/50 p-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words"
                      >
                        {t.errorInfo}
                      </pre>
                    ) : null}
                    {t.userAgent ? (
                      <p
                        dir="ltr"
                        className="text-[11px] text-muted-foreground line-clamp-1"
                        title={t.userAgent}
                      >
                        {t.userAgent}
                      </p>
                    ) : null}
                  </div>

                  {t.status === 'RESOLVED' ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      حل‌شده توسط {t.resolvedByName ?? '—'} · {faDateTime(t.resolvedAt)}
                    </p>
                  ) : canManage ? (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      {t.status === 'OPEN' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === t.id}
                          onClick={() => changeStatus(t, 'IN_PROGRESS')}
                          aria-label={`آغاز بررسی گزارش ${t.code}`}
                        >
                          در حال بررسی
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        disabled={busyId === t.id}
                        onClick={() => changeStatus(t, 'RESOLVED')}
                        aria-label={`علامت‌گذاری گزارش ${t.code} به‌عنوان حل‌شده`}
                        className="gap-1.5"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        حل‌شده
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* صفحه‌بندی */}
          <div className="flex flex-wrap items-center justify-between gap-3 py-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              مجموع {toFa(total)} گزارش · صفحه {toFa(page)} از {toFa(totalPages)}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="صفحه قبل"
              >
                <ChevronRight className="h-4 w-4" />
                قبلی
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="صفحه بعد"
              >
                بعدی
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
