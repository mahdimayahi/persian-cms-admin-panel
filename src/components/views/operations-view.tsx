'use client'

/**
 * مرکز عملیات — پیگیری عملیات‌های ناهمگام سمت سرور: صف و اجرا، نتیجهٔ تک‌تک
 * موارد (GET /api/operations/[id])، تلاش مجدد موارد ناموفق، لغو حین اجرا و
 * دانلود گزارش CSV. نظرسنجی ۵ ثانیه‌ای تا وقتی عملیات فعالی وجود دارد.
 */

import * as React from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
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

type OpType =
  | 'BULK_PUBLISH_ARTICLES'
  | 'BULK_UNPUBLISH_ARTICLES'
  | 'BUNDLE_PUBLISH'
  | 'MEDIA_UPLOAD'
  | 'CSV_EXPORT'
  | 'OTHER'

type OpStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED'
type ItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'

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
  retryOfId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

type OperationItem = {
  id: string
  refType: string
  refId: string
  label: string
  status: ItemStatus
  message: string | null
}

type OpDetail = { operation: OpRow; items: OperationItem[] }

type OperationsResponse = { items: OpRow[] }

type StatusMeta = { label: string; colorClass: string; bgClass: string }

const SLATE_META: Omit<StatusMeta, 'label'> = {
  colorClass: 'text-slate-700 dark:text-slate-300',
  bgClass: 'bg-slate-100 dark:bg-slate-800',
}

const OP_STATUS_META: Record<OpStatus, StatusMeta> = {
  QUEUED: { label: 'در صف', ...SLATE_META },
  RUNNING: { label: 'در حال اجرا', colorClass: 'text-teal-700 dark:text-teal-300', bgClass: 'bg-teal-100 dark:bg-teal-950' },
  SUCCESS: { label: 'موفق', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  PARTIAL: { label: 'ناقص', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  FAILED: { label: 'ناموفق', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
  CANCEL_REQUESTED: {
    label: 'درخواست لغو',
    colorClass: 'text-rose-700/80 dark:text-rose-300/80',
    bgClass: 'bg-rose-50 dark:bg-rose-950/60',
  },
  CANCELLED: { label: 'لغوشده', ...SLATE_META },
}

const OP_TYPE_LABELS: Record<OpType, string> = {
  BULK_PUBLISH_ARTICLES: 'انتشار گروهی مقالات',
  BULK_UNPUBLISH_ARTICLES: 'لغو انتشار گروهی مقالات',
  BUNDLE_PUBLISH: 'انتشار بسته',
  MEDIA_UPLOAD: 'بارگذاری رسانه',
  CSV_EXPORT: 'خروجی CSV',
  OTHER: 'سایر',
}

const ITEM_STATUS_META: Record<ItemStatus, StatusMeta> = {
  PENDING: { label: 'در انتظار', ...SLATE_META },
  SUCCEEDED: { label: 'موفق', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  FAILED: { label: 'ناموفق', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
  SKIPPED: { label: 'ردشده', colorClass: 'text-muted-foreground', bgClass: 'bg-muted' },
  CANCELLED: { label: 'لغوشده', ...SLATE_META },
}

/** مقاوم به مقدار غیرمنتظرهٔ وضعیت/نوع از سرور */
function opStatusMeta(status: string): StatusMeta {
  return (OP_STATUS_META as Record<string, StatusMeta>)[status] ?? { label: status, ...SLATE_META }
}
function itemStatusMeta(status: string): StatusMeta {
  return (ITEM_STATUS_META as Record<string, StatusMeta>)[status] ?? { label: status, ...SLATE_META }
}
function opTypeLabel(type: string): string {
  return (OP_TYPE_LABELS as Record<string, string>)[type] ?? type
}

const isActiveStatus = (s: OpStatus) => s === 'QUEUED' || s === 'RUNNING' || s === 'CANCEL_REQUESTED'
const isRetryableStatus = (s: OpStatus) => s === 'PARTIAL' || s === 'FAILED'
const isCancellableStatus = (s: OpStatus) => s === 'QUEUED' || s === 'RUNNING'

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
  const [actionBusyId, setActionBusyId] = React.useState<string | null>(null)
  const [reportBusyId, setReportBusyId] = React.useState<string | null>(null)

  // جزئیات هر عملیات (تنبل — هنگام باز شدن دریافت می‌شود)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [details, setDetails] = React.useState<Record<string, OpDetail>>({})
  const [detailLoading, setDetailLoading] = React.useState<Record<string, boolean>>({})
  const [detailErrors, setDetailErrors] = React.useState<Record<string, string | null>>({})
  const expandedRef = React.useRef<Record<string, boolean>>({})
  const detailsRef = React.useRef<Record<string, OpDetail>>({})

  const normalize = (rows: OpRow[]): OpRow[] =>
    rows.map((op) => ({
      ...op,
      errors: Array.isArray(op.errors) ? op.errors : [],
      retryOfId: op.retryOfId ?? null,
      relatedId: op.relatedId ?? null,
    }))

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<OperationsResponse>('/api/operations')
      setItems(normalize(res.items))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت عملیات‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  /** دریافت تنبل جزئیات یک عملیات (silent = بدون فلش حالت بارگذاری) */
  const fetchDetail = React.useCallback(async (id: string, silent: boolean) => {
    if (!silent) setDetailLoading((prev) => ({ ...prev, [id]: true }))
    setDetailErrors((prev) => ({ ...prev, [id]: null }))
    try {
      const res = await apiGet<OpDetail>(`/api/operations/${id}`)
      detailsRef.current = { ...detailsRef.current, [id]: { ...res, items: Array.isArray(res.items) ? res.items : [] } }
      setDetails(detailsRef.current)
    } catch (e) {
      setDetailErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : 'خطا در دریافت جزئیات عملیات',
      }))
    } finally {
      if (!silent) setDetailLoading((prev) => ({ ...prev, [id]: false }))
    }
  }, [])

  /** نوسازی بی‌صدا برای نظرخواهی دوره‌ای (بدون فلش حالت بارگذاری) */
  const poll = React.useCallback(async () => {
    try {
      const res = await apiGet<OperationsResponse>('/api/operations')
      setItems(normalize(res.items))
      // جزئیات بازِ عملیات‌های فعال هم بی‌صدا به‌روز شود
      const activeIds = new Set(res.items.filter((op) => isActiveStatus(op.status)).map((op) => op.id))
      const openIds = Object.keys(expandedRef.current).filter((id) => expandedRef.current[id] && detailsRef.current[id])
      for (const id of openIds) {
        if (activeIds.has(id)) void fetchDetail(id, true)
      }
    } catch {
      // نوسازی خودکار بی‌صدا است؛ خطا نمایش داده نمی‌شود
    }
  }, [fetchDetail])

  React.useEffect(() => {
    load()
  }, [load])

  /** تازه‌سازی هر ۵ ثانیه تا وقتی عملیات فعالی (در صف/در حال اجرا/درخواست لغو) وجود دارد */
  const hasActive = React.useMemo(() => (items ?? []).some((op) => isActiveStatus(op.status)), [items])

  React.useEffect(() => {
    if (!hasActive) return
    const t = window.setInterval(() => {
      void poll()
    }, 5_000)
    return () => window.clearInterval(t)
  }, [hasActive, poll])

  const toggleDetail = (op: OpRow) => {
    const opening = !expandedRef.current[op.id]
    const next = { ...expandedRef.current, [op.id]: opening }
    expandedRef.current = next
    setExpanded(next)
    if (opening) {
      if (detailsRef.current[op.id]) void fetchDetail(op.id, true)
      else void fetchDetail(op.id, false)
    }
  }

  const retryOp = async (op: OpRow) => {
    setActionBusyId(op.id)
    try {
      await apiPost<{ id: string }>(`/api/operations/${op.id}/retry`)
      toast.success('عملیات تلاش مجدد ایجاد شد و در صف اجراست.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ایجاد تلاش مجدد ناموفق بود.')
    } finally {
      setActionBusyId(null)
    }
  }

  const cancelOp = async (op: OpRow) => {
    setActionBusyId(op.id)
    try {
      const res = await apiPost<{ ok: boolean; status: string }>(`/api/operations/${op.id}/cancel`)
      toast.success(
        res.status === 'CANCELLED' ? 'عملیات لغو شد.' : 'درخواست لغو ثبت شد؛ عملیات در نخستین گام متوقف می‌شود.'
      )
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'لغو عملیات ناموفق بود.')
    } finally {
      setActionBusyId(null)
    }
  }

  /** گزارش CSV از آیتم‌های عملیات؛ برای عملیات‌های قدیمی بدون آیتم → خطاها */
  const downloadReport = async (op: OpRow) => {
    setReportBusyId(op.id)
    try {
      let itemRows: (string | number)[][] = []
      const cached = detailsRef.current[op.id]
      if (cached) {
        itemRows = cached.items.map((it) => [it.label, itemStatusMeta(it.status).label, it.message ?? ''])
      } else {
        try {
          const res = await apiGet<OpDetail>(`/api/operations/${op.id}`)
          detailsRef.current = { ...detailsRef.current, [op.id]: res }
          setDetails(detailsRef.current)
          itemRows = res.items.map((it) => [it.label, itemStatusMeta(it.status).label, it.message ?? ''])
        } catch {
          // دریافت جزئیات ممکن نشد — به خطاهای ثبت‌شدهٔ عملیات برمی‌گردیم
        }
      }
      if (itemRows.length === 0) {
        itemRows = op.errors.map((er) => [er.item, 'ناموفق', er.reason])
      }
      if (itemRows.length === 0) {
        toast.info('موردی برای گزارش وجود ندارد.')
        return
      }
      downloadCsv(`operation-${op.id}-report.csv`, ['مورد', 'وضعیت', 'پیام'], itemRows)
    } finally {
      setReportBusyId(null)
    }
  }

  if (loading && items === null) return <LoadingSpinner label="در حال بارگذاری مرکز عملیات…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (items === null) return null

  const counts = {
    queued: items.filter((op) => op.status === 'QUEUED').length,
    running: items.filter((op) => op.status === 'RUNNING').length,
    success: items.filter((op) => op.status === 'SUCCESS').length,
    partial: items.filter((op) => op.status === 'PARTIAL').length,
    failed: items.filter((op) => op.status === 'FAILED').length,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="مرکز عملیات"
        description="پیگیری عملیات‌های ناهمگام؛ نتیجهٔ تک‌تک موارد، تلاش مجدد موارد ناموفق و لغو حین اجرا"
        icon={<ListRestart className="h-5 w-5" />}
        actions={
          <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            به‌روزرسانی
          </Button>
        }
      />

      {/* ── خلاصه وضعیت ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
        <OpTile label="در صف" count={counts.queued} icon={Clock} tile="bg-slate-500/10 text-slate-600 dark:text-slate-400" />
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
            description="عملیات‌هایی مانند انتشار گروهی مقالات اینجا با نتیجهٔ تک‌تک موارد گزارش می‌شوند."
            icon={<ListRestart className="h-8 w-8" />}
          />
        ) : (
          items.map((op) => {
            const meta = opStatusMeta(op.status)
            const pct = op.totalItems > 0 ? Math.min(100, Math.round((op.doneItems / op.totalItems) * 100)) : 0
            const isOpen = !!expanded[op.id]
            const canRetry = isRetryableStatus(op.status) && canPublish
            const canCancel = isCancellableStatus(op.status) && canPublish
            const canDownload = op.errors.length > 0 || op.totalItems > 0

            return (
              <Card key={op.id} className="rounded-2xl p-4 shadow-xs">
                <div className="space-y-2.5">
                  {/* ردیف ۱: نوع، عنوان، نشان تلاش مجدد و وضعیت */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="secondary">{opTypeLabel(op.type)}</Badge>
                      {op.retryOfId ? (
                        <Badge variant="outline" className="gap-1 text-[11px]">
                          <RotateCcw className="h-3 w-3" aria-hidden />
                          تلاش مجدد عملیات قبلی
                        </Badge>
                      ) : null}
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
                          {toFa(op.doneItems)} از {toFa(op.totalItems)} مورد
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

                  {/* ردیف ۴: اقدام‌ها */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleDetail(op)}
                      className="gap-1.5"
                      aria-expanded={isOpen}
                      aria-label={`جزئیات ${op.title}`}
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                      جزئیات{op.totalItems > 0 ? ` (${toFa(op.totalItems)})` : ''}
                    </Button>
                    {canRetry ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryOp(op)}
                        disabled={actionBusyId !== null}
                        className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:border-amber-800 dark:text-amber-300"
                      >
                        {actionBusyId === op.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        )}
                        تلاش مجدد
                      </Button>
                    ) : null}
                    {canCancel ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cancelOp(op)}
                        disabled={actionBusyId !== null}
                        className="gap-1.5 border-rose-300 text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-rose-900"
                      >
                        {actionBusyId === op.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Ban className="h-3.5 w-3.5" aria-hidden />
                        )}
                        لغو
                      </Button>
                    ) : null}
                    {canDownload ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void downloadReport(op)}
                        disabled={reportBusyId === op.id}
                        className="gap-1.5"
                        aria-label={`دانلود گزارش ${op.title}`}
                      >
                        {reportBusyId === op.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        )}
                        دانلود گزارش
                      </Button>
                    ) : null}
                  </div>

                  {/* جزئیات عملیات: آیتم‌ها؛ عملیات‌های قدیمی بدون آیتم → خطاها */}
                  {isOpen ? (
                    <div className="rounded-xl border bg-muted/20 p-3" aria-live="polite">
                      {detailLoading[op.id] && !details[op.id] ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground" role="status">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          در حال دریافت جزئیات…
                        </div>
                      ) : detailErrors[op.id] && !details[op.id] ? (
                        <div className="flex items-center justify-between gap-2 text-sm text-destructive">
                          <span>{detailErrors[op.id]}</span>
                          <Button size="sm" variant="outline" onClick={() => fetchDetail(op.id, false)}>
                            تلاش مجدد
                          </Button>
                        </div>
                      ) : details[op.id] ? (
                        details[op.id].items.length > 0 ? (
                          <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">نتیجهٔ تک‌تک موارد این عملیات:</p>
                            <ul className="max-h-72 divide-y overflow-y-auto pe-1">
                              {details[op.id].items.map((it) => {
                                const im = itemStatusMeta(it.status)
                                return (
                                  <li key={it.id} className="flex items-start justify-between gap-3 py-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{it.label}</p>
                                      {it.message ? (
                                        <p className="mt-0.5 text-xs text-muted-foreground">{it.message}</p>
                                      ) : null}
                                    </div>
                                    <StatusBadge label={im.label} colorClass={im.colorClass} bgClass={im.bgClass} />
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        ) : op.errors.length > 0 ? (
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
                        ) : (
                          <p className="py-2 text-center text-sm text-muted-foreground">موردی برای نمایش وجود ندارد.</p>
                        )
                      ) : null}
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
