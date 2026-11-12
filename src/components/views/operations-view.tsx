'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  ListRestart,
  Loader2,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingSpinner, PageHeader, StatusBadge } from '@/components/shared/ui-bits'
import { apiGet, apiPost } from '@/lib/client/api'
import { downloadCsv, faDateTime, timeAgo, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { cn } from '@/lib/utils'

type OpType = 'BUNDLE_PUBLISH' | 'MEDIA_UPLOAD' | 'CSV_EXPORT' | 'OTHER'
type OpStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'

type OpError = { item: string; reason: string }

type OpRow = {
  id: string
  type: OpType
  title: string
  status: OpStatus
  totalItems: number
  doneItems: number
  failedItems: number
  initiatorName: string
  resultSummary: string
  errors: OpError[]
  relatedId: string | null
  createdAt: string
  finishedAt: string | null
}

type OperationsResponse = { items: OpRow[] }

type BundleSummary = { id: string; title: string; status: string }

type BundlePublishResponse = BundleSummary & {
  execution: {
    status: 'PUBLISHED' | 'PARTIAL' | 'FAILED'
    results: { articleId: string; title: string; result: 'SUCCESS' | 'FAILED'; message: string }[]
  }
}

const OP_TYPE_LABELS: Record<OpType, string> = {
  BUNDLE_PUBLISH: 'انتشار بسته',
  MEDIA_UPLOAD: 'بارگذاری رسانه',
  CSV_EXPORT: 'خروجی CSV',
  OTHER: 'سایر',
}

const OP_STATUS_META: Record<OpStatus, { label: string; colorClass: string; bgClass: string }> = {
  RUNNING: { label: 'در حال اجرا', colorClass: 'text-teal-700 dark:text-teal-300', bgClass: 'bg-teal-100 dark:bg-teal-950' },
  SUCCESS: { label: 'موفق', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  PARTIAL: { label: 'ناقص', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  FAILED: { label: 'ناموفق', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
}

/** کاشی خلاصه وضعیت — به سبک KpiCard داشبورد */
function OpTile({
  label,
  count,
  icon: Icon,
  tile,
}: {
  label: string
  count: number
  icon: React.ElementType
  tile: string
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <div className={cn('rounded-xl p-2', tile)} aria-hidden>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-[26px] font-bold leading-8 tabular-nums">{toFa(count)}</p>
    </div>
  )
}

export function OperationsView() {
  const can = useCan()
  const canPublish = can('articles.publish')

  const [items, setItems] = React.useState<OpRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [retryingId, setRetryingId] = React.useState<string | null>(null)
  const [openErrors, setOpenErrors] = React.useState<Record<string, boolean>>({})

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<OperationsResponse>('/api/operations')
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت عملیات‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  /** نوسازی بی‌صدا برای نظرخواهی دوره‌ای (بدون فلش حالت بارگذاری) */
  const poll = React.useCallback(async () => {
    try {
      const res = await apiGet<OperationsResponse>('/api/operations')
      setItems(res.items)
    } catch {
      // نوسازی خودکار بی‌صدا است؛ خطا نمایش داده نمی‌شود
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  /** تازه‌سازی هر ۱۵ ثانیه تا وقتی عملیاتی در حال اجرا وجود دارد */
  const hasRunning = React.useMemo(() => (items ?? []).some((op) => op.status === 'RUNNING'), [items])

  React.useEffect(() => {
    if (!hasRunning) return
    const t = window.setInterval(() => {
      void poll()
    }, 15_000)
    return () => window.clearInterval(t)
  }, [hasRunning, poll])

  const retry = async (op: OpRow) => {
    if (!op.relatedId) return
    setRetryingId(op.id)
    try {
      await apiGet<BundleSummary>(`/api/bundles/${op.relatedId}`)
      const res = await apiPost<BundlePublishResponse>(`/api/bundles/${op.relatedId}`)
      toast.success(
        res.execution.status === 'PUBLISHED'
          ? 'همه اجزا منتشر شدند.'
          : 'اجرا شد؛ نتیجه در همین صفحه به‌روز می‌شود.',
      )
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'اجرای مجدد عملیات ناموفق بود.')
    } finally {
      setRetryingId(null)
    }
  }

  const toggleErrors = (id: string) => {
    setOpenErrors((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const downloadErrors = (op: OpRow) => {
    downloadCsv(
      `operation-${op.id}-errors.csv`,
      ['مورد', 'دلیل'],
      op.errors.map((er) => [er.item, er.reason]),
    )
  }

  if (loading && items === null) return <LoadingSpinner label="در حال بارگذاری مرکز عملیات…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (items === null) return null

  const counts = {
    running: items.filter((op) => op.status === 'RUNNING').length,
    success: items.filter((op) => op.status === 'SUCCESS').length,
    partial: items.filter((op) => op.status === 'PARTIAL').length,
    failed: items.filter((op) => op.status === 'FAILED').length,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="مرکز عملیات"
        description="وضعیت عملیات طولانی، نتیجه و تلاش مجدد موارد شکست‌خورده"
        icon={<ListRestart className="h-5 w-5" />}
        actions={
          <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            به‌روزرسانی
          </Button>
        }
      />

      {/* ── خلاصه وضعیت ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <OpTile label="در حال اجرا" count={counts.running} icon={Loader2} tile="bg-teal-500/10 text-teal-600 dark:text-teal-400" />
        <OpTile label="موفق" count={counts.success} icon={CheckCircle2} tile="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
        <OpTile label="ناقص" count={counts.partial} icon={AlertTriangle} tile="bg-amber-500/10 text-amber-600 dark:text-amber-500" />
        <OpTile label="ناموفق" count={counts.failed} icon={XCircle} tile="bg-rose-500/10 text-rose-600 dark:text-rose-400" />
      </div>

      {/* ── فهرست عملیات ────────────────────────────────────── */}
      <div className="max-w-4xl space-y-3">
        {items.length === 0 ? (
          <EmptyState
            title="هنوز عملیاتی ثبت نشده است"
            description="عملیات‌هایی مانند انتشار بسته یا بارگذاری دسته‌ای رسانه اینجا گزارش می‌شوند."
            icon={<ListRestart className="h-8 w-8" />}
          />
        ) : (
          items.map((op) => {
            const meta = OP_STATUS_META[op.status]
            const pct = op.totalItems > 0 ? Math.min(100, Math.round((op.doneItems / op.totalItems) * 100)) : 0
            const errorsOpen = !!openErrors[op.id]
            const canRetry =
              op.type === 'BUNDLE_PUBLISH' && (op.status === 'PARTIAL' || op.status === 'FAILED') && !!op.relatedId && canPublish

            return (
              <Card key={op.id} className="rounded-2xl p-4 shadow-xs">
                <div className="space-y-2.5">
                  {/* ردیف ۱: نوع، عنوان و وضعیت */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="secondary">{OP_TYPE_LABELS[op.type]}</Badge>
                      <p className="truncate text-sm font-medium">{op.title}</p>
                    </div>
                    <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                  </div>

                  {/* ردیف ۲: نوار پیشرفت */}
                  {op.totalItems > 0 ? (
                    <div className="space-y-1.5">
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`پیشرفت ${op.title}`}
                      >
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-primary to-chart-3 transition-[width] duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {toFa(op.doneItems)} از {toFa(op.totalItems)} جزء
                        </span>
                        {op.failedItems > 0 ? (
                          <span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">
                            {toFa(op.failedItems)} ناموفق
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* ردیف ۳: نتیجه و متادیتا */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {op.resultSummary ? <span className="text-sm">{op.resultSummary}</span> : null}
                    <span>آغازگر: {op.initiatorName}</span>
                    <span>{timeAgo(op.createdAt)}</span>
                    {op.finishedAt ? <span>پایان: {faDateTime(op.finishedAt)}</span> : null}
                  </div>

                  {/* خطاها: جمع‌شونده + دانلود گزارش */}
                  {op.errors.length > 0 ? (
                    <div className="space-y-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleErrors(op.id)}
                          className="gap-1.5 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
                          aria-expanded={errorsOpen}
                        >
                          <ChevronDown className={cn('h-4 w-4 transition-transform', errorsOpen && 'rotate-180')} aria-hidden />
                          مشاهده خطاها ({toFa(op.errors.length)})
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => downloadErrors(op)} className="gap-1.5">
                          <Download className="h-3.5 w-3.5" aria-hidden />
                          دانلود گزارش خطا
                        </Button>
                      </div>
                      {errorsOpen ? (
                        <ul className="space-y-2">
                          {op.errors.map((er, idx) => (
                            <li
                              key={`${op.id}-err-${idx}`}
                              className="rounded-lg border border-rose-200 bg-rose-500/5 px-3 py-2 dark:border-rose-900"
                            >
                              <p className="text-sm font-medium">{er.item}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{er.reason}</p>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {/* تلاش مجدد انتشار بسته */}
                  {canRetry ? (
                    <div className="pt-1">
                      <Button size="sm" onClick={() => retry(op)} disabled={retryingId !== null} className="gap-1.5">
                        {retryingId === op.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <RotateCcw className="h-4 w-4" aria-hidden />
                        )}
                        تلاش مجدد
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
