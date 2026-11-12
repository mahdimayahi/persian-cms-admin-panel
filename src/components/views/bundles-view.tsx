'use client'

import * as React from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  History,
  Info,
  ListChecks,
  Loader2,
  MinusCircle,
  PackageOpen,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  User,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SearchInput,
  StatusBadge,
} from '@/components/shared/ui-bits'
import { apiDelete, apiGet, apiPost } from '@/lib/client/api'
import { notifyGuideEvent } from '@/lib/client/guide'
import { faDate, timeAgo, toFa } from '@/lib/client/format'
import { useAppStore, useCan } from '@/store/app-store'
import { ContextHint } from '@/components/shared/context-hint'
import { cn } from '@/lib/utils'

// ─── کلاینت PATCH (کتابخانهٔ api متد PATCH ندارد — الگوی سایر ویوها) ──
async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(b.error || 'خطای غیرمنتظره در ارتباط با سرور.')
  }
  return (await res.json()) as T
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

// ─── انواع داده بر اساس قرارداد API ─────────────────────────────

type BundleStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED'

type ReadinessState = 'READY' | 'READY_WARNINGS' | 'BLOCKED' | 'UNKNOWN'

type BundleListItem = {
  id: string
  title: string
  note: string | null
  status: BundleStatus
  ownerId: string | null
  ownerName: string | null
  scheduledAt: string | null
  timezone: string | null
  publishedAt: string | null
  approvedAt: string | null
  approvedByName: string | null
  readinessState: ReadinessState
  itemsTotal: number
  itemsPublished: number
  itemsFailed: number
  createdByName: string
  createdAt: string
}

type BundlesListResponse = { items: BundleListItem[]; executedDue: number }

type BundleItem = {
  id: string
  articleId: string
  articleTitle: string
  articleStatus: string
  slug: string
  label: string
  versionId: string | null
  versionNumber: number | null
  latestVersionNumber: number | null
  approvedVersionId: string | null
  approvedVersionNumber: number | null
  result: 'SUCCESS' | 'FAILED' | 'SKIPPED' | null
  message: string | null
  addedAt: string
  snapshotStatus: string
}

type ReadinessCheck = {
  key: string
  label: string
  level: 'ERROR' | 'WARNING' | 'OK'
  detail: string
  itemIds?: string[]
}

type ReadinessResult = { state: ReadinessState; checks: ReadinessCheck[] }

type HistoryEntry = {
  id: string
  bundleId: string
  kind: string
  message: string
  userId: string | null
  userName: string
  createdAt: string
}

type RunItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'

type RunItem = {
  id: string
  refType: string
  refId: string
  label: string
  status: RunItemStatus
  message: string | null
}

type BundleRun = {
  id: string
  type: string
  title: string
  status: string
  totalItems: number
  doneItems: number
  failedItems: number
  initiatorName: string | null
  resultSummary: string
  errorsJson: string
  relatedId: string | null
  retryOfId: string | null
  cancelRequested: boolean
  startedAt: string | null
  heartbeatAt: string | null
  createdAt: string
  finishedAt: string | null
  items: RunItem[]
}

type BundleDetail = {
  id: string
  title: string
  note: string
  status: BundleStatus
  ownerId: string | null
  ownerName: string | null
  scheduledAt: string | null
  timezone: string | null
  publishedAt: string | null
  approvedAt: string | null
  approvedById: string | null
  approvedByName: string | null
  readinessState: ReadinessState
  createdById: string
  createdByName: string
  createdAt: string
  updatedAt: string
  items: BundleItem[]
  readiness: ReadinessResult
  history: HistoryEntry[]
  runs: BundleRun[]
}

type ExecuteResult = {
  status: 'PUBLISHED' | 'PARTIAL' | 'FAILED'
  results: { itemId: string; articleId: string; title: string; result: 'SUCCESS' | 'FAILED' | 'SKIPPED'; message: string }[]
  opId: string
}

type BundleAction = 'READINESS' | 'SEND_TO_REVIEW' | 'APPROVE' | 'PUBLISH' | 'RETRY' | 'CANCEL' | 'CANCEL_SCHEDULE'

type ReadinessActionResponse = { readiness: ReadinessResult; detail: BundleDetail }
type ApproveActionResponse = { detail: BundleDetail; readiness: ReadinessResult }
type PublishActionResponse = { detail: BundleDetail; execution: ExecuteResult }

type PickerArticle = { id: string; title: string; slug: string; status: string }
type ArticleListResponse = { items: PickerArticle[]; total: number; page: number; pageSize: number }

type VersionRow = {
  id: string
  title: string
  content: string
  excerpt: string
  editorName: string | null
  note: string | null
  createdAt: string
}
type VersionsResponse = { items: VersionRow[]; title: string; updatedAt: string }
type VersionsState = { loading: boolean; error: string | null; items: VersionRow[] }

type SelectedDraftItem = { articleId: string; title: string; status: string; versionId: string; label: string }

type StatusMeta = { label: string; colorClass: string; bgClass: string }

// ─── نقشهٔ رنگ وضعیت‌ها (بدون آبی/ایندیگو) ────────────────────────

const SLATE_META: Pick<StatusMeta, 'colorClass' | 'bgClass'> = {
  colorClass: 'text-slate-700 dark:text-slate-300',
  bgClass: 'bg-slate-100 dark:bg-slate-900',
}

const BUNDLE_STATUS_META: Record<BundleStatus, StatusMeta> = {
  DRAFT: { label: 'پیش‌نویس', ...SLATE_META },
  IN_REVIEW: { label: 'در بررسی', colorClass: 'text-violet-700 dark:text-violet-300', bgClass: 'bg-violet-100 dark:bg-violet-950' },
  APPROVED: { label: 'تأییدشده', colorClass: 'text-teal-700 dark:text-teal-300', bgClass: 'bg-teal-100 dark:bg-teal-950' },
  SCHEDULED: { label: 'زمان‌بندی‌شده', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  PUBLISHING: { label: 'در حال انتشار', colorClass: 'text-cyan-700 dark:text-cyan-300', bgClass: 'bg-cyan-100 dark:bg-cyan-950' },
  PUBLISHED: { label: 'منتشرشده', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  PARTIAL: { label: 'انتشار جزئی', colorClass: 'text-orange-700 dark:text-orange-300', bgClass: 'bg-orange-100 dark:bg-orange-950' },
  FAILED: { label: 'ناموفق', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
  CANCELLED: { label: 'لغوشده', colorClass: 'text-zinc-700 dark:text-zinc-300', bgClass: 'bg-zinc-100 dark:bg-zinc-900' },
}

function bundleStatusMeta(status: string): StatusMeta {
  return (
    (BUNDLE_STATUS_META as Record<string, StatusMeta>)[status] ?? { label: status, ...SLATE_META }
  )
}

const READINESS_META: Record<ReadinessState, StatusMeta> = {
  READY: { label: 'آماده', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  READY_WARNINGS: { label: 'آماده با هشدار', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  BLOCKED: { label: 'مسدود', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
  UNKNOWN: { label: 'بررسی نشده', ...SLATE_META },
}

function readinessMeta(state: string): StatusMeta {
  return (READINESS_META as Record<string, StatusMeta>)[state] ?? { label: state, ...SLATE_META }
}

const ARTICLE_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: { label: 'پیش‌نویس', ...SLATE_META },
  IN_REVIEW: { label: 'در بررسی', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  NEEDS_REVISION: { label: 'نیازمند اصلاح', colorClass: 'text-orange-700 dark:text-orange-300', bgClass: 'bg-orange-100 dark:bg-orange-950' },
  APPROVED: { label: 'تأییدشده', colorClass: 'text-teal-700 dark:text-teal-300', bgClass: 'bg-teal-100 dark:bg-teal-950' },
  PUBLISHED: { label: 'منتشرشده', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  ARCHIVED: { label: 'بایگانی‌شده', colorClass: 'text-zinc-700 dark:text-zinc-300', bgClass: 'bg-zinc-100 dark:bg-zinc-900' },
}

function articleStatusMeta(status: string): StatusMeta {
  return ARTICLE_STATUS_META[status] ?? { label: status, ...SLATE_META }
}

const RUN_STATUS_META: Record<string, StatusMeta> = {
  QUEUED: { label: 'در صف', ...SLATE_META },
  RUNNING: { label: 'در حال اجرا', colorClass: 'text-cyan-700 dark:text-cyan-300', bgClass: 'bg-cyan-100 dark:bg-cyan-950' },
  SUCCESS: { label: 'موفق', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  PARTIAL: { label: 'ناقص', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  FAILED: { label: 'ناموفق', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
  CANCEL_REQUESTED: {
    label: 'درخواست لغو',
    colorClass: 'text-rose-700/80 dark:text-rose-300/80',
    bgClass: 'bg-rose-50 dark:bg-rose-950/60',
  },
  CANCELLED: { label: 'لغوشده', colorClass: 'text-zinc-700 dark:text-zinc-300', bgClass: 'bg-zinc-100 dark:bg-zinc-900' },
}

function runStatusMeta(status: string): StatusMeta {
  return RUN_STATUS_META[status] ?? { label: status, ...SLATE_META }
}

const RUN_ITEM_STATUS_META: Record<string, StatusMeta> = {
  PENDING: { label: 'در انتظار', ...SLATE_META },
  SUCCEEDED: { label: 'موفق', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  FAILED: { label: 'ناموفق', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
  SKIPPED: { label: 'ردشده', ...SLATE_META },
  CANCELLED: { label: 'لغوشده', colorClass: 'text-zinc-700 dark:text-zinc-300', bgClass: 'bg-zinc-100 dark:bg-zinc-900' },
}

function runItemStatusMeta(status: string): StatusMeta {
  return RUN_ITEM_STATUS_META[status] ?? { label: status, ...SLATE_META }
}

const RUN_TYPE_LABELS: Record<string, string> = {
  BUNDLE_PUBLISH: 'انتشار بسته',
}

function runTypeLabel(type: string): string {
  return RUN_TYPE_LABELS[type] ?? type
}

const HISTORY_KIND_LABELS: Record<string, string> = {
  CREATED: 'ایجاد',
  ITEM_ADDED: 'افزودن قلم',
  ITEM_REMOVED: 'حذف قلم',
  ITEM_VERSION_SET: 'تغییر نسخهٔ قلم',
  SCHEDULE_SET: 'زمان‌بندی',
  SCHEDULE_CANCELLED: 'لغو زمان‌بندی',
  SENT_TO_REVIEW: 'ارسال برای بررسی',
  APPROVED: 'تأیید',
  APPROVAL_INVALIDATED: 'ابطال تأیید',
  READINESS_RUN: 'بررسی آمادگی',
  RUN: 'اجرا',
  RETRY: 'تلاش مجدد',
  CANCELLED: 'لغو',
  UPDATED: 'ویرایش',
}

function historyKindLabel(kind: string): string {
  return HISTORY_KIND_LABELS[kind] ?? kind
}

// ─── قالب‌بندی زمان (همیشه به وقت تهران) ─────────────────────────

function formatTehranDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    const s = new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
    return `${s} (Asia/Tehran)`
  } catch {
    return d.toISOString()
  }
}

/** تبدیل ISO به مقدار مناسب input[type=datetime-local] به وقت تهران */
function tehranToLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const hour = get('hour') === '24' ? '00' : get('hour')
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
  } catch {
    return ''
  }
}

/** شمارهٔ نسخه بر اساس ترتیب نزولی: نسخه‌ها جدیدترین در ابتدا — نسخه ۱ قدیمی‌ترین است */
function versionNumberOf(items: VersionRow[], index: number): number {
  return items.length - index
}

function versionOptionLabel(v: VersionRow, items: VersionRow[], index: number): string {
  const num = versionNumberOf(items, index)
  return `نسخه ${toFa(num)} — ${v.note?.trim() || 'بدون توضیح'} (${v.editorName || '—'}، ${faDate(v.createdAt)})`
}

function readinessSummaryText(r: ReadinessResult): string {
  const errors = r.checks.filter((c) => c.level === 'ERROR').length
  const warnings = r.checks.filter((c) => c.level === 'WARNING').length
  if (errors > 0) return `${toFa(errors)} خطا، ${toFa(warnings)} هشدار`
  if (warnings > 0) return `بدون خطا — ${toFa(warnings)} هشدار`
  return 'همهٔ بررسی‌ها موفق'
}

// ─── هوک‌های کمکی ────────────────────────────────────────────────

const DEBOUNCE_MS = 300

function useDebouncedValue<T>(value: T, delay = DEBOUNCE_MS): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return v
}

/** جست‌وجوی مقالات برای انتخابگرها (فقط وقتی گفت‌وگو باز است) */
function useArticleSearch(query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query.trim())
  const [results, setResults] = React.useState<PickerArticle[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const sp = new URLSearchParams({ pageSize: '20' })
    if (debounced) sp.set('q', debounced)
    apiGet<ArticleListResponse>(`/api/articles?${sp.toString()}`)
      .then((res) => {
        if (!cancelled) setResults(res.items)
      })
      .catch((e) => {
        if (!cancelled) setError(errMessage(e, 'دریافت فهرست مقالات ناموفق بود.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, enabled])

  return { results, loading, error }
}

/** نسخه‌های یک مقاله (نزولی — جدیدترین اول) */
function useVersions(articleId: string | null): VersionsState {
  const [state, setState] = React.useState<VersionsState>({ loading: false, error: null, items: [] })

  React.useEffect(() => {
    if (!articleId) {
      setState({ loading: false, error: null, items: [] })
      return
    }
    let cancelled = false
    setState({ loading: true, error: null, items: [] })
    apiGet<VersionsResponse>(`/api/articles/${articleId}/versions`)
      .then((res) => {
        if (!cancelled) setState({ loading: false, error: null, items: res.items })
      })
      .catch((e) => {
        if (!cancelled)
          setState({ loading: false, error: errMessage(e, 'دریافت نسخه‌های مقاله ناموفق بود.'), items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [articleId])

  return state
}

// ─── اجزای نمایشی مشترک ─────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  valueClass?: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 rounded-lg bg-muted p-1.5 text-muted-foreground" aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('text-sm font-medium leading-6 break-words', valueClass)}>{value}</p>
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">در حال بارگذاری فهرست بسته‌ها…</span>
      <div aria-hidden className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border p-4 space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="rounded-2xl border p-6 space-y-5" role="status" aria-live="polite" aria-hidden>
      <span className="sr-only">در حال بارگذاری جزئیات بسته…</span>
      <div aria-hidden className="space-y-5">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-9 w-full max-w-sm" />
        <div className="grid gap-4 pt-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** انتخابگر نسخه: «نسخهٔ فعلی» + نسخه‌های ثبت‌شده */
function VersionSelect({
  value,
  onValueChange,
  state,
  disabled = false,
  id,
  ariaLabel,
}: {
  value: string
  onValueChange: (v: string) => void
  state: VersionsState
  disabled?: boolean
  id?: string
  ariaLabel: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled || state.loading}>
      <SelectTrigger id={id} className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="current">نسخهٔ فعلی (ثبت خودکار)</SelectItem>
        {state.items.map((v, i) => (
          <SelectItem key={v.id} value={v.id}>
            {versionOptionLabel(v, state.items, i)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** نتیجهٔ انتشار هر قلم */
function ItemResultCell({ result, message }: { result: BundleItem['result']; message: string | null }) {
  if (result === 'SUCCESS') {
    return (
      <span className="inline-flex items-start gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          موفق
          {message ? <span className="block font-normal leading-5">{message}</span> : null}
        </span>
      </span>
    )
  }
  if (result === 'FAILED') {
    return (
      <span className="inline-flex items-start gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          ناموفق
          {message ? <span className="block font-normal leading-5">{message}</span> : null}
        </span>
      </span>
    )
  }
  if (result === 'SKIPPED') {
    return (
      <span className="inline-flex items-start gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
        <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          ردشده
          {message ? <span className="block font-normal leading-5">{message}</span> : null}
        </span>
      </span>
    )
  }
  return <span className="text-xs text-muted-foreground">در انتظار اجرا</span>
}

/** فهرست نتایج جست‌وجوی مقاله (مشترک بین گفت‌وگوها) */
function ArticleSearchList({
  results,
  loading,
  error,
  pickedIds,
  onPick,
}: {
  results: PickerArticle[]
  loading: boolean
  error: string | null
  pickedIds: string[]
  onPick: (a: PickerArticle) => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      {error ? (
        <p className="p-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          در حال جست‌وجو…
        </div>
      ) : results.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground">مقاله‌ای یافت نشد.</p>
      ) : (
        <ul className="max-h-48 divide-y overflow-y-auto">
          {results.map((a) => {
            const picked = pickedIds.includes(a.id)
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-6">{a.title}</p>
                  <p dir="ltr" className="truncate text-xs text-muted-foreground">
                    /{a.slug}
                  </p>
                </div>
                {picked ? (
                  <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    انتخاب‌شده
                  </Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1"
                    onClick={() => onPick(a)}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    افزودن
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── گفت‌وگوی ایجاد بسته ─────────────────────────────────────────

function CreateBundleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (id: string) => void
}) {
  const [title, setTitle] = React.useState('')
  const [note, setNote] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [titleError, setTitleError] = React.useState<string | null>(null)
  const [itemsError, setItemsError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [selected, setSelected] = React.useState<SelectedDraftItem[]>([])
  const [versions, setVersions] = React.useState<Record<string, VersionsState>>({})
  const search = useArticleSearch(query, open)

  // بازنشانی هنگام باز شدن
  React.useEffect(() => {
    if (open) {
      setTitle('')
      setNote('')
      setQuery('')
      setSelected([])
      setVersions({})
      setTitleError(null)
      setItemsError(null)
    }
  }, [open])

  const fetchVersions = async (articleId: string) => {
    setVersions((prev) => ({
      ...prev,
      [articleId]: { loading: true, error: null, items: prev[articleId]?.items ?? [] },
    }))
    try {
      const res = await apiGet<VersionsResponse>(`/api/articles/${articleId}/versions`)
      setVersions((prev) => ({ ...prev, [articleId]: { loading: false, error: null, items: res.items } }))
    } catch (e) {
      setVersions((prev) => ({
        ...prev,
        [articleId]: { loading: false, error: errMessage(e, 'دریافت نسخه‌ها ناموفق بود.'), items: [] },
      }))
    }
  }

  const addArticle = (a: PickerArticle) => {
    if (selected.some((s) => s.articleId === a.id)) return
    setSelected((prev) => [
      ...prev,
      { articleId: a.id, title: a.title, status: a.status, versionId: 'current', label: '' },
    ])
    void fetchVersions(a.id)
  }

  const removeArticle = (id: string) => setSelected((prev) => prev.filter((s) => s.articleId !== id))

  const updateItem = (articleId: string, patch: Partial<SelectedDraftItem>) =>
    setSelected((prev) => prev.map((s) => (s.articleId === articleId ? { ...s, ...patch } : s)))

  const submit = async () => {
    const t = title.trim()
    if (t.length < 3) {
      setTitleError('عنوان بسته باید دست‌کم ۳ نویسه باشد.')
      return
    }
    if (selected.length === 0) {
      setItemsError('حداقل یک مقاله به بسته اضافه کنید.')
      return
    }
    setSubmitting(true)
    setTitleError(null)
    setItemsError(null)
    try {
      const res = await apiPost<{ id: string; title: string; status: string }>('/api/bundles', {
        title: t,
        note: note.trim() || undefined,
        items: selected.map((s) => ({
          articleId: s.articleId,
          versionId: s.versionId,
          label: s.label.trim() || undefined,
        })),
      })
      toast.success(`بسته «${res.title}» ایجاد شد.`)
      onCreated(res.id)
      onOpenChange(false)
    } catch (e) {
      toast.error(errMessage(e, 'ایجاد بسته ناموفق بود.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>بستهٔ انتشار جدید</DialogTitle>
          <DialogDescription>مقالات مرتبط را انتخاب کنید و هر جزء را به نسخهٔ موردنظر متصل کنید.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pe-1">
          <Field label="عنوان بسته" required htmlFor="bundle-create-title" error={titleError ?? undefined}>
            <Input
              id="bundle-create-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: انتشار ویژهٔ نوروز"
              maxLength={150}
            />
          </Field>
          <Field label="توضیح" htmlFor="bundle-create-note" hint="اختیاری — حداکثر ۵۰۰ نویسه">
            <Textarea
              id="bundle-create-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="توضیح کوتاه دربارهٔ این بسته…"
              maxLength={500}
            />
          </Field>
          <Field label="اقلام بسته" required error={itemsError ?? undefined}>
            <SearchInput value={query} onChange={setQuery} placeholder="جست‌وجوی مقاله برای افزودن…" />
            <div className="mt-2">
              <ArticleSearchList
                results={search.results}
                loading={search.loading}
                error={search.error}
                pickedIds={selected.map((s) => s.articleId)}
                onPick={addArticle}
              />
            </div>
            {selected.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {selected.map((s) => {
                  const vState = versions[s.articleId] ?? { loading: false, error: null, items: [] }
                  return (
                    <li key={s.articleId} className="space-y-2.5 rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium leading-6">{s.title}</p>
                          <div className="mt-1">
                            <StatusBadge {...articleStatusMeta(s.status)} dot={false} />
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeArticle(s.articleId)}
                          aria-label={`حذف «${s.title}» از انتخاب`}
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label
                            className="text-xs font-normal text-muted-foreground"
                            htmlFor={`bundle-create-version-${s.articleId}`}
                          >
                            نسخهٔ متصل‌شده
                          </Label>
                          <VersionSelect
                            id={`bundle-create-version-${s.articleId}`}
                            ariaLabel={`نسخهٔ مقاله ${s.title}`}
                            value={s.versionId}
                            onValueChange={(v) => updateItem(s.articleId, { versionId: v })}
                            state={vState}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            className="text-xs font-normal text-muted-foreground"
                            htmlFor={`bundle-create-label-${s.articleId}`}
                          >
                            نقش قلم (اختیاری)
                          </Label>
                          <Input
                            id={`bundle-create-label-${s.articleId}`}
                            value={s.label}
                            onChange={(e) => updateItem(s.articleId, { label: e.target.value })}
                            placeholder="مثلاً: یادداشت سردبیر"
                            maxLength={120}
                          />
                        </div>
                      </div>
                      {vState.error ? (
                        <p className="text-xs text-destructive" role="alert">
                          {vState.error}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                هنوز مقاله‌ای انتخاب نشده است؛ از فهرست بالا مقالات را بیفزایید.
              </p>
            )}
            <Alert className="mt-3 text-muted-foreground">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs leading-5">
                هر جزء به نسخهٔ مشخصی از محتوا متصل می‌شود؛ تغییر بعدی محتوا تأیید بسته را نامعتبر می‌کند.
              </AlertDescription>
            </Alert>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            انصراف
          </Button>
          <Button onClick={submit} disabled={submitting || title.trim().length < 3 || selected.length === 0}>
            {submitting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            ایجاد بسته
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── گفت‌وگوی افزودن قلم به بسته ────────────────────────────────

function AddItemDialog({
  bundleId,
  open,
  onOpenChange,
  excludeIds,
  onSaved,
}: {
  bundleId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  excludeIds: string[]
  onSaved: () => void
}) {
  const [query, setQuery] = React.useState('')
  const [chosen, setChosen] = React.useState<PickerArticle | null>(null)
  const [versionId, setVersionId] = React.useState('current')
  const [label, setLabel] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const search = useArticleSearch(query, open)
  const versions = useVersions(chosen?.id ?? null)

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setChosen(null)
      setVersionId('current')
      setLabel('')
    }
  }, [open])

  const available = search.results.filter((a) => !excludeIds.includes(a.id))

  const submit = async () => {
    if (!chosen) return
    setSaving(true)
    try {
      await apiPatch<BundleDetail>(`/api/bundles/${bundleId}`, {
        addedItems: [{ articleId: chosen.id, versionId, label: label.trim() || undefined }],
      })
      toast.success(`قلم «${chosen.title}» به بسته افزوده شد.`)
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(errMessage(e, 'افزودن قلم ناموفق بود.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>افزودن قلم به بسته</DialogTitle>
          <DialogDescription>یک مقاله را جست‌وجو کنید و نسخهٔ موردنظر آن را انتخاب کنید.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pe-1">
          <SearchInput value={query} onChange={setQuery} placeholder="جست‌وجوی مقاله…" />
          <ArticleSearchList
            results={available}
            loading={search.loading}
            error={search.error}
            pickedIds={chosen ? [chosen.id] : []}
            onPick={setChosen}
          />
          {chosen ? (
            <div className="space-y-3 rounded-xl border p-3">
              <p className="text-sm font-medium leading-6">{chosen.title}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-normal text-muted-foreground" htmlFor="bundle-add-version">
                    نسخهٔ متصل‌شده
                  </Label>
                  <VersionSelect
                    id="bundle-add-version"
                    ariaLabel={`نسخهٔ مقاله ${chosen.title}`}
                    value={versionId}
                    onValueChange={setVersionId}
                    state={versions}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-normal text-muted-foreground" htmlFor="bundle-add-label">
                    نقش قلم (اختیاری)
                  </Label>
                  <Input
                    id="bundle-add-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="مثلاً: یادداشت سردبیر"
                    maxLength={120}
                  />
                </div>
              </div>
              {versions.error ? (
                <p className="text-xs text-destructive" role="alert">
                  {versions.error}
                </p>
              ) : null}
            </div>
          ) : null}
          <Alert className="text-muted-foreground">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs leading-5">
              هر جزء به نسخهٔ مشخصی از محتوا متصل می‌شود؛ تغییر بعدی محتوا تأیید بسته را نامعتبر می‌کند.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={submit} disabled={saving || !chosen}>
            {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            افزودن قلم
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── گفت‌وگوی تغییر نسخهٔ قلم ────────────────────────────────────

function VersionDialog({
  item,
  bundleId,
  open,
  onOpenChange,
  onSaved,
}: {
  item: BundleItem | null
  bundleId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [value, setValue] = React.useState('current')
  const [saving, setSaving] = React.useState(false)
  const versions = useVersions(item?.articleId ?? null)

  React.useEffect(() => {
    if (open && item) setValue(item.versionId || 'current')
  }, [open, item])

  const newerExists =
    item?.latestVersionNumber !== null &&
    item?.latestVersionNumber !== undefined &&
    item?.versionNumber !== null &&
    item?.versionNumber !== undefined &&
    item.latestVersionNumber > item.versionNumber

  const submit = async () => {
    if (!item) return
    setSaving(true)
    try {
      await apiPatch<BundleDetail>(`/api/bundles/${bundleId}`, {
        itemUpdates: [{ itemId: item.id, versionId: value }],
      })
      toast.success('نسخهٔ قلم به‌روزرسانی شد.')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(errMessage(e, 'به‌روزرسانی نسخهٔ قلم ناموفق بود.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>تغییر نسخهٔ قلم</DialogTitle>
          <DialogDescription>
            اتصال «{item?.articleTitle}» را به نسخهٔ دیگری از محتوا تغییر دهید.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {newerExists && item ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>نسخهٔ جدیدی ثبت شده است</AlertTitle>
              <AlertDescription className="text-xs leading-5">
                پس از انتخاب فعلی، نسخهٔ {toFa(item.latestVersionNumber)} ثبت شده است؛ نسخهٔ فعلی این قلم نسخهٔ{' '}
                {toFa(item.versionNumber ?? 0)} است.
              </AlertDescription>
            </Alert>
          ) : null}
          <Field
            label="نسخهٔ متصل‌شده"
            htmlFor="bundle-item-version"
            hint="انتخاب «نسخهٔ فعلی» یک اسنپ‌شات خودکار از وضعیت زندهٔ مقاله ثبت می‌کند."
          >
            <VersionSelect
              id="bundle-item-version"
              ariaLabel="انتخاب نسخهٔ قلم"
              value={value}
              onValueChange={setValue}
              state={versions}
            />
          </Field>
          {versions.error ? (
            <p className="text-xs text-destructive" role="alert">
              {versions.error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={submit} disabled={saving || versions.loading}>
            {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            ذخیرهٔ نسخه
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── ردیف فهرست بسته‌ها ──────────────────────────────────────────

function BundleListRow({
  row,
  selected,
  onSelect,
}: {
  row: BundleListItem
  selected: boolean
  onSelect: () => void
}) {
  const sm = bundleStatusMeta(row.status)
  const rm = readinessMeta(row.readinessState)
  const publishPhase =
    row.status === 'PUBLISHING' || row.status === 'PUBLISHED' || row.status === 'PARTIAL' || row.status === 'FAILED'
  const showProgress = row.itemsPublished > 0 || row.itemsFailed > 0 || publishPhase

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'w-full rounded-2xl border bg-card p-4 text-start shadow-xs transition-all hover:border-ring/50 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        selected && 'border-primary/70 ring-2 ring-primary/20'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-6 line-clamp-2">{row.title}</span>
        <StatusBadge label={sm.label} colorClass={sm.colorClass} bgClass={sm.bgClass} />
      </div>
      <div className="mt-2">
        <StatusBadge dot={false} label={rm.label} colorClass={rm.colorClass} bgClass={rm.bgClass} />
      </div>
      <div className="mt-2.5 space-y-1 text-xs text-muted-foreground">
        {row.ownerName ? <p>مسئول: {row.ownerName}</p> : null}
        {row.scheduledAt ? (
          <p className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
            <span>موعد: {formatTehranDateTime(row.scheduledAt)}</span>
          </p>
        ) : null}
        <p className="tabular-nums">
          {showProgress ? (
            <>
              {toFa(row.itemsPublished)} از {toFa(row.itemsTotal)} جزء منتشر شد
              {row.itemsFailed > 0 && (
                <span className="font-medium text-rose-600 dark:text-rose-400"> · {toFa(row.itemsFailed)} ناموفق</span>
              )}
            </>
          ) : (
            <>{toFa(row.itemsTotal)} جزء</>
          )}
        </p>
        <p>
          {row.createdByName} · {timeAgo(row.createdAt)}
        </p>
      </div>
    </button>
  )
}

// ─── ردیف بررسی آمادگی ──────────────────────────────────────────

const CHECK_LEVEL_ORDER: Record<ReadinessCheck['level'], number> = { ERROR: 0, WARNING: 1, OK: 2 }

function ReadinessCheckRow({ check }: { check: ReadinessCheck }) {
  const isError = check.level === 'ERROR'
  const isWarning = check.level === 'WARNING'
  const Icon = isError ? AlertCircle : isWarning ? AlertTriangle : CheckCircle2
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3',
        isError && 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/50',
        isWarning && 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50',
        !isError && !isWarning && 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          isError && 'text-rose-600 dark:text-rose-400',
          isWarning && 'text-amber-600 dark:text-amber-400',
          !isError && !isWarning && 'text-emerald-600 dark:text-emerald-400'
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={cn('text-sm font-medium leading-6', isError && 'text-rose-700 dark:text-rose-300')}>
          {check.label}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{check.detail}</p>
        {check.itemIds && check.itemIds.length > 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            قلم‌های مرتبط: {toFa(check.itemIds.length)}
          </p>
        ) : null}
      </div>
    </div>
  )
}

// ─── کارت هر اجرا ───────────────────────────────────────────────

function RunItemIcon({ status }: { status: RunItemStatus }) {
  if (status === 'SUCCEEDED')
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
  if (status === 'FAILED')
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
  return <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
}

function RunCard({ run, runNumber, retryOfNumber }: { run: BundleRun; runNumber: number; retryOfNumber: number | null }) {
  const meta = runStatusMeta(run.status)
  return (
    <Card className="rounded-xl shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
            <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
              {runTypeLabel(run.type)}
            </Badge>
            {run.retryOfId ? (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-[11px] font-normal text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              >
                تلاش مجدد {retryOfNumber ? `#${toFa(retryOfNumber)}` : 'اجرای قبلی'}
              </Badge>
            ) : null}
            {run.cancelRequested ? (
              <Badge
                variant="outline"
                className="border-rose-300 bg-rose-50 text-[11px] font-normal text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
              >
                درخواست لغو
              </Badge>
            ) : null}
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">اجرا {toFa(runNumber)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          <span>
            مجری: <span className="font-medium text-foreground">{run.initiatorName || '—'}</span>
          </span>
          <span>شروع: {formatTehranDateTime(run.startedAt)}</span>
          <span>پایان: {formatTehranDateTime(run.finishedAt)}</span>
          {run.resultSummary ? <span className="sm:col-span-2">{run.resultSummary}</span> : null}
        </div>
        {run.items.length > 0 ? (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-xl border">
            {run.items.map((rit) => {
              const im = runItemStatusMeta(rit.status)
              return (
                <li key={rit.id} className="flex items-start gap-2.5 p-2.5">
                  <RunItemIcon status={rit.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6 break-words">{rit.label}</p>
                    {rit.message ? (
                      <p className={cn('mt-0.5 text-xs leading-5', im.colorClass)}>{rit.message}</p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ─── بخش تاریخچهٔ بسته ──────────────────────────────────────────

function HistorySection({ history }: { history: HistoryEntry[] }) {
  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden />
        تاریخچهٔ بسته
      </h3>
      {history.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          رویدادی برای این بسته ثبت نشده است.
        </p>
      ) : (
        <ol className="max-h-80 space-y-3.5 overflow-y-auto rounded-xl border p-4">
          {history.map((h) => (
            <li key={h.id} className="flex items-start gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary/60 ring-4 ring-primary/10" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant="outline" className="text-[11px] font-normal">
                    {historyKindLabel(h.kind)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{h.userName || '—'}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {formatTehranDateTime(h.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 break-words">{h.message}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ─── رابط کاربری اصلی ───────────────────────────────────────────

export function BundlesView() {
  const can = useCan()
  const user = useAppStore((s) => s.user)

  // مجوزها — هم‌راستا با نقش‌های ADMIN/EDITOR در سرور
  const canCreate = can('articles.create') || user?.role === 'ADMIN' || user?.role === 'EDITOR'
  const canReview = can('articles.review') || user?.role === 'ADMIN' || user?.role === 'EDITOR'
  const canPublish = can('articles.publish') || user?.role === 'ADMIN' || user?.role === 'EDITOR'

  // فهرست بسته‌ها
  const [list, setList] = React.useState<BundleListItem[] | null>(null)
  const [listLoading, setListLoading] = React.useState(true)
  const [listError, setListError] = React.useState<string | null>(null)

  // انتخاب و جزئیات
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<BundleDetail | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState('summary')

  // زمان‌بندی انتشار
  const [scheduleValue, setScheduleValue] = React.useState('')

  // گفت‌وگوها
  const [createOpen, setCreateOpen] = React.useState(false)
  const [addItemOpen, setAddItemOpen] = React.useState(false)
  const [versionTarget, setVersionTarget] = React.useState<BundleItem | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<BundleItem | null>(null)
  const [publishOpen, setPublishOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const loadList = React.useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const res = await apiGet<BundlesListResponse>('/api/bundles')
      setList(res.items)
      if (res.executedDue > 0) {
        toast.info(`${toFa(res.executedDue)} بستهٔ زمان‌بندی‌شده به‌صورت خودکار اجرا شد.`)
      }
    } catch (e) {
      setListError(errMessage(e, 'خطا در دریافت فهرست بسته‌ها'))
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadDetail = React.useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setDetailLoading(true)
      setDetail(null)
    }
    setDetailError(null)
    try {
      const res = await apiGet<BundleDetail>(`/api/bundles/${id}`)
      setDetail(res)
    } catch (e) {
      setDetailError(errMessage(e, 'خطا در دریافت جزئیات بسته'))
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadList()
  }, [loadList])

  const selectBundle = (id: string) => {
    setSelectedId(id)
    setActiveTab('summary')
    setScheduleValue('')
    void loadDetail(id)
  }

  const backToList = () => {
    setSelectedId(null)
    setDetail(null)
    setDetailError(null)
  }

  const refreshDetail = () => {
    if (selectedId) void loadDetail(selectedId, true)
  }

  const refreshAfterChange = () => {
    refreshDetail()
    void loadList()
  }

  /** اعمال تغییرات با PATCH و بازخوانی جزئیات */
  const patchDetail = async (body: Record<string, unknown>, successMsg: string): Promise<boolean> => {
    if (!detail) return false
    setBusy(true)
    try {
      const res = await apiPatch<BundleDetail>(`/api/bundles/${detail.id}`, body)
      setDetail(res)
      toast.success(successMsg)
      void loadList()
      return true
    } catch (e) {
      toast.error(errMessage(e, 'ثبت تغییرات ناموفق بود.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  /** گزارش نتیجهٔ انتشار/تلاش مجدد */
  const reportExecution = (exec: ExecuteResult, action: 'PUBLISH' | 'RETRY') => {
    const okCount = exec.results.filter((r) => r.result === 'SUCCESS').length
    const failCount = exec.results.filter((r) => r.result === 'FAILED').length
    const prefix = action === 'RETRY' ? 'تلاش مجدد — ' : ''
    if (exec.status === 'PUBLISHED') {
      toast.success(`${prefix}انتشار کامل شد — ${toFa(okCount)} جزء منتشر شد.`)
    } else if (exec.status === 'PARTIAL') {
      toast.warning(`${prefix}انتشار جزئی — ${toFa(okCount)} موفق، ${toFa(failCount)} ناموفق.`)
    } else {
      toast.error(`${prefix}انتشار ناموفق بود — ${toFa(failCount)} مورد خطا داشت.`)
    }
  }

  /** اجرای اقدام‌های وضعیت بسته */
  const runBundleAction = async (action: BundleAction) => {
    if (!detail) return
    setBusy(true)
    try {
      if (action === 'READINESS') {
        const res = await apiPost<ReadinessActionResponse>(`/api/bundles/${detail.id}`, { action })
        setDetail(res.detail)
        toast.success('بررسی آمادگی انجام شد.', { description: readinessSummaryText(res.readiness) })
      } else if (action === 'APPROVE') {
        const res = await apiPost<ApproveActionResponse>(`/api/bundles/${detail.id}`, { action })
        setDetail(res.detail)
        toast.success('بسته تأیید شد و آمادهٔ انتشار است.')
      } else if (action === 'PUBLISH' || action === 'RETRY') {
        const res = await apiPost<PublishActionResponse>(`/api/bundles/${detail.id}`, { action })
        setDetail(res.detail)
        reportExecution(res.execution, action)
        // راهنما: انتشار کامل و موفق بسته (تلاش مجدد که به انتشار کامل برسد هم شمرده می‌شود)
        if (res.execution.status === 'PUBLISHED') void notifyGuideEvent('bundle.published')
      } else {
        const res = await apiPost<BundleDetail>(`/api/bundles/${detail.id}`, { action })
        setDetail(res)
        if (action === 'SEND_TO_REVIEW') toast.success('بسته برای بررسی ارسال شد.')
        if (action === 'CANCEL') toast.success('بسته لغو شد.')
        if (action === 'CANCEL_SCHEDULE') {
          toast.success('زمان‌بندی انتشار لغو شد.')
          setScheduleValue('')
        }
      }
      void loadList()
    } catch (e) {
      toast.error(errMessage(e, 'انجام عملیات ناموفق بود.'))
    } finally {
      setBusy(false)
    }
  }

  /** ذخیرهٔ زمان انتشار — ورودی datetime-local به وقت تهران (UTC+03:30) است */
  const saveSchedule = async () => {
    if (!detail) return
    if (!scheduleValue) {
      toast.error('ابتدا زمان انتشار را انتخاب کنید.')
      return
    }
    const iso = new Date(`${scheduleValue}:00+03:30`).toISOString()
    if (Number.isNaN(new Date(iso).getTime())) {
      toast.error('زمان انتخابی نامعتبر است.')
      return
    }
    await patchDetail({ scheduledAt: iso }, 'زمان انتشار ذخیره شد.')
  }

  const removeItem = async () => {
    if (!removeTarget) return
    const done = await patchDetail({ removedItemIds: [removeTarget.id] }, 'قلم از بسته حذف شد.')
    if (done) setRemoveTarget(null)
  }

  const deleteBundle = async () => {
    if (!detail) return
    setBusy(true)
    try {
      await apiDelete<{ ok: boolean }>(`/api/bundles/${detail.id}`)
      toast.success(`بسته «${detail.title}» حذف شد.`)
      setDeleteOpen(false)
      setSelectedId(null)
      setDetail(null)
      void loadList()
    } catch (e) {
      toast.error(errMessage(e, 'حذف بسته ناموفق بود.'))
    } finally {
      setBusy(false)
    }
  }

  const handleCreated = (id: string) => {
    void loadList()
    selectBundle(id)
  }

  // ── محاسبات جزئیات ──
  const status = detail?.status
  const canMutateItems =
    !!detail && canCreate && ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED'].includes(detail.status)
  const showSendToReview = !!detail && canCreate && detail.status === 'DRAFT'
  const showApprove = !!detail && canReview && detail.status === 'IN_REVIEW'
  const showPublishBtn =
    !!detail && canPublish && (detail.status === 'APPROVED' || detail.status === 'SCHEDULED')
  const showCancelBtn =
    !!detail && canCreate && ['DRAFT', 'IN_REVIEW', 'SCHEDULED'].includes(detail.status)
  const showScheduleForm = !!detail && canPublish && (status === 'APPROVED' || status === 'SCHEDULED')
  const noActionsAvailable =
    !!detail && !showSendToReview && !showApprove && !showPublishBtn && !showCancelBtn && !showScheduleForm
  const canDeleteBundle =
    !!detail && detail.status !== 'PUBLISHING' && (user?.id === detail.createdById || canPublish)
  const approveBlocked = detail?.readinessState === 'BLOCKED'
  const canApproveNow = !!detail && canReview && status === 'IN_REVIEW' && !approveBlocked

  const initialListLoading = listLoading && list === null

  return (
    <div className="space-y-6">
      <PageHeader
        title="بسته‌های انتشار"
        description="چند تغییر مرتبط را یک‌جا آماده، تأیید و منتشر کنید؛ هر جزء به نسخهٔ مشخصی از محتوا متصل می‌شود."
        icon={<PackageOpen className="h-5 w-5" />}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden />
              بستهٔ جدید
            </Button>
          ) : null
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(290px,340px)_minmax(0,1fr)]">
        {/* ── فهرست بسته‌ها ── */}
        <section aria-label="فهرست بسته‌های انتشار" className={cn('space-y-3', selectedId && 'hidden lg:block')}>
          {listError ? (
            <ErrorState message={listError} onRetry={() => void loadList()} />
          ) : initialListLoading ? (
            <ListSkeleton />
          ) : list && list.length > 0 ? (
            list.map((row) => (
              <BundleListRow
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onSelect={() => selectBundle(row.id)}
              />
            ))
          ) : (
            <EmptyState
              title="هنوز بسته‌ای ساخته نشده است"
              description="چند مقالهٔ مرتبط را در یک بسته گروه‌بندی کنید تا هماهنگ منتشر شوند."
              icon={<PackageOpen className="h-8 w-8" />}
              compact
            />
          )}
        </section>

        {/* ── جزئیات بسته ── */}
        <section aria-label="جزئیات بسته" className={cn('min-w-0', !selectedId && 'hidden lg:block')}>
          {!selectedId ? (
            <EmptyState
              title="بسته‌ای انتخاب نشده است"
              description="از فهرست بسته‌ها یک مورد را انتخاب کنید یا بستهٔ تازه‌ای بسازید."
              icon={<PackageOpen className="h-8 w-8" />}
            />
          ) : detailError ? (
            <ErrorState message={detailError} onRetry={() => void loadDetail(selectedId)} />
          ) : detailLoading && !detail ? (
            <DetailSkeleton />
          ) : detail ? (
            <Card className="rounded-2xl shadow-xs" aria-busy={busy || undefined}>
              <CardHeader className="border-b pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-ms-2 mt-0.5 shrink-0 lg:hidden"
                      onClick={backToList}
                      aria-label="بازگشت به فهرست بسته‌ها"
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Button>
                    <div className="min-w-0">
                      <CardTitle className="text-lg leading-7 break-words">{detail.title}</CardTitle>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge {...bundleStatusMeta(detail.status)} />
                        <StatusBadge dot={false} {...readinessMeta(detail.readinessState)} />
                        {detail.scheduledAt ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                            {formatTehranDateTime(detail.scheduledAt)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={refreshDetail}
                      aria-label="بازخوانی جزئیات"
                      disabled={detailLoading}
                    >
                      <RefreshCw className={cn('h-4 w-4', detailLoading && 'animate-spin')} aria-hidden />
                    </Button>
                    {canDeleteBundle ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteOpen(true)}
                        aria-label="حذف بسته"
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="h-auto w-full flex-wrap sm:w-auto">
                    <TabsTrigger value="summary" className="px-3">
                      خلاصه
                    </TabsTrigger>
                    <TabsTrigger value="items" className="gap-1.5 px-3">
                      اقلام
                      <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px] tabular-nums">
                        {toFa(detail.items.length)}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="readiness" className="px-3">
                      بررسی‌ها
                    </TabsTrigger>
                    <TabsTrigger value="runs" className="gap-1.5 px-3">
                      سابقهٔ اجرا
                      {detail.runs.length > 0 ? (
                        <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px] tabular-nums">
                          {toFa(detail.runs.length)}
                        </Badge>
                      ) : null}
                    </TabsTrigger>
                  </TabsList>

                  {/* ── ۱. خلاصه ── */}
                  <TabsContent value="summary" className="mt-5 space-y-4">
                    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                      <InfoRow
                        icon={User}
                        label="مسئول بسته"
                        value={detail.ownerName || 'تعیین نشده'}
                      />
                      <InfoRow
                        icon={CalendarClock}
                        label="زمان انتشار"
                        value={detail.scheduledAt ? formatTehranDateTime(detail.scheduledAt) : 'تنظیم نشده'}
                        valueClass={detail.scheduledAt ? 'text-amber-700 dark:text-amber-400' : undefined}
                      />
                      <InfoRow
                        icon={Rocket}
                        label="زمان انتشار واقعی"
                        value={detail.publishedAt ? formatTehranDateTime(detail.publishedAt) : '—'}
                      />
                      <InfoRow
                        icon={ShieldCheck}
                        label="تأییدکننده"
                        value={
                          detail.approvedByName
                            ? `${detail.approvedByName} — ${formatTehranDateTime(detail.approvedAt)}`
                            : 'تأیید نشده'
                        }
                      />
                      <InfoRow
                        icon={User}
                        label="ساخته‌شده توسط"
                        value={`${detail.createdByName} — ${formatTehranDateTime(detail.createdAt)}`}
                      />
                      <InfoRow
                        icon={Info}
                        label="آخرین به‌روزرسانی"
                        value={formatTehranDateTime(detail.updatedAt)}
                      />
                    </div>

                    <div className="space-y-3 rounded-xl border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">وضعیت انتشار اجزا</span>
                        <StatusBadge {...bundleStatusMeta(detail.status)} />
                      </div>
                      {(() => {
                        const total = detail.items.length
                        const published = detail.items.filter((it) => it.result === 'SUCCESS').length
                        const failed = detail.items.filter((it) => it.result === 'FAILED').length
                        const pct = total === 0 ? 0 : Math.round((published / total) * 100)
                        return (
                          <>
                            <Progress value={pct} aria-label={`پیشرفت انتشار: ${pct} درصد`} />
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {toFa(published)} از {toFa(total)} جزء منتشر شد
                              {failed > 0 && (
                                <span className="font-medium text-rose-600 dark:text-rose-400">
                                  {' '}
                                  — {toFa(failed)} ناموفق
                                </span>
                              )}
                            </p>
                          </>
                        )
                      })()}
                    </div>

                    <div className="rounded-xl border bg-muted/40 p-3">
                      <p className="mb-1 text-xs text-muted-foreground">توضیح</p>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {detail.note && detail.note.trim() !== '' ? detail.note : '—'}
                      </p>
                    </div>
                  </TabsContent>

                  {/* ── ۲. اقلام ── */}
                  <TabsContent value="items" className="mt-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {toFa(detail.items.length)} قلم در این بسته
                      </p>
                      {canMutateItems ? (
                        <Button size="sm" className="gap-1.5" onClick={() => setAddItemOpen(true)} disabled={busy}>
                          <Plus className="h-4 w-4" aria-hidden />
                          افزودن قلم
                        </Button>
                      ) : null}
                    </div>

                    <Alert className="text-muted-foreground">
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-xs leading-5">
                        هر جزء به نسخهٔ مشخصی از محتوا متصل می‌شود؛ تغییر بعدی محتوا تأیید بسته را نامعتبر می‌کند.
                        {(detail.status === 'APPROVED' || detail.status === 'SCHEDULED') &&
                          ' تغییر اقلام در وضعیت فعلی، تأیید بسته را باطل می‌کند و بسته به «در بررسی» بازمی‌گردد.'}
                      </AlertDescription>
                    </Alert>

                    {detail.items.length === 0 ? (
                      <EmptyState
                        compact
                        title="هیچ جزئی در این بسته نیست"
                        description="با «افزودن قلم» مقالات موردنظر را به بسته اضافه کنید."
                      />
                    ) : (
                      <div className="max-h-[32rem] overflow-auto rounded-xl border">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/40">
                              <TableHead className="min-w-[14rem]">عنوان</TableHead>
                              <TableHead className="min-w-[7rem]">نقش قلم</TableHead>
                              <TableHead className="min-w-[13rem]">نسخهٔ انتخاب‌شده</TableHead>
                              <TableHead className="min-w-[7rem]">وضعیت مقاله</TableHead>
                              <TableHead className="min-w-[12rem]">نتیجهٔ انتشار</TableHead>
                              {canMutateItems ? <TableHead className="text-start">عملیات</TableHead> : null}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.items.map((it) => {
                              const newerExists =
                                it.latestVersionNumber !== null &&
                                it.versionNumber !== null &&
                                it.latestVersionNumber > it.versionNumber
                              return (
                                <TableRow key={it.id}>
                                  <TableCell>
                                    <p className="text-sm font-medium leading-6">{it.articleTitle}</p>
                                    <p dir="ltr" className="mt-0.5 text-xs text-muted-foreground">
                                      /{it.slug}
                                    </p>
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {it.label ? it.label : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                  <TableCell>
                                    <div className="space-y-1.5">
                                      {it.versionNumber !== null ? (
                                        <Badge variant="secondary" className="font-normal tabular-nums">
                                          نسخهٔ {toFa(it.versionNumber)}
                                        </Badge>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">بدون نسخهٔ ثبت‌شده</span>
                                      )}
                                      {it.approvedVersionNumber !== null &&
                                      it.approvedVersionNumber !== it.versionNumber ? (
                                        <p className="text-[11px] text-muted-foreground tabular-nums">
                                          تأیید ثبت‌شده روی نسخهٔ {toFa(it.approvedVersionNumber)}
                                        </p>
                                      ) : null}
                                      {newerExists ? (
                                        <Badge
                                          variant="outline"
                                          className="border-rose-300 bg-rose-50 text-[11px] font-normal text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                                        >
                                          نسخهٔ جدیدی ({toFa(it.latestVersionNumber ?? 0)}) پس از انتخاب ثبت شده
                                        </Badge>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <StatusBadge {...articleStatusMeta(it.articleStatus)} dot={false} />
                                  </TableCell>
                                  <TableCell>
                                    <ItemResultCell result={it.result} message={it.message} />
                                  </TableCell>
                                  {canMutateItems ? (
                                    <TableCell>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 px-2 text-xs"
                                          onClick={() => setVersionTarget(it)}
                                          disabled={busy}
                                        >
                                          تغییر نسخه
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                          onClick={() => setRemoveTarget(it)}
                                          disabled={busy}
                                        >
                                          حذف از بسته
                                        </Button>
                                      </div>
                                    </TableCell>
                                  ) : null}
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── ۳. بررسی‌ها ── */}
                  <TabsContent value="readiness" className="mt-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">وضعیت آمادگی:</span>
                        <StatusBadge dot={false} {...readinessMeta(detail.readinessState)} />
                        {detail.readiness.checks.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {readinessSummaryText(detail.readiness)}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy}
                        onClick={() => void runBundleAction('READINESS')}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <ListChecks className="h-4 w-4" aria-hidden />
                        )}
                        بررسی آمادگی
                      </Button>
                    </div>

                    {detail.readinessState === 'BLOCKED' ? (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>تأیید بسته ممکن نیست</AlertTitle>
                        <AlertDescription className="text-xs leading-5">
                          بررسی آمادگی با خطا مواجه شده است؛ ابتدا موارد قرمز زیر را برطرف کنید و دوباره بررسی را
                          اجرا کنید.
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {detail.readiness.checks.length > 0 ? (
                      <div className="max-h-80 space-y-2 overflow-y-auto pe-1">
                        {[...detail.readiness.checks]
                          .sort((a, b) => CHECK_LEVEL_ORDER[a.level] - CHECK_LEVEL_ORDER[b.level])
                          .map((c) => (
                            <ReadinessCheckRow key={c.key} check={c} />
                          ))}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                        هنوز بررسی آمادگی اجرا نشده است؛ برای ارزیابی بسته، «بررسی آمادگی» را اجرا کنید.
                      </p>
                    )}

                    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                      <p className="text-sm font-semibold">اقدام‌های بسته</p>
                      {detail.readinessState === 'BLOCKED' ? (
                        <ContextHint tone="warning" title="چرا تأیید بسته غیرفعال است؟">
                          بررسی آمادگی باید بدون خطا باشد؛ خطاهای قرمز در تب «بررسی‌ها» را برطرف کنید.
                        </ContextHint>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        {showSendToReview ? (
                          <Button
                            variant="outline"
                            className="gap-1.5"
                            disabled={busy}
                            onClick={() => void runBundleAction('SEND_TO_REVIEW')}
                          >
                            <Send className="h-4 w-4" aria-hidden />
                            ارسال برای بررسی
                          </Button>
                        ) : null}

                        {showApprove ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex" aria-disabled={approveBlocked || undefined}>
                                <Button
                                  className="gap-1.5"
                                  disabled={busy || !canApproveNow}
                                  onClick={() => void runBundleAction('APPROVE')}
                                >
                                  <ShieldCheck className="h-4 w-4" aria-hidden />
                                  تأیید بسته
                                </Button>
                              </span>
                            </TooltipTrigger>
                            {approveBlocked ? (
                              <TooltipContent>
                                بررسی آمادگی مسدود است؛ ابتدا خطاهای بسته را برطرف کنید.
                              </TooltipContent>
                            ) : null}
                          </Tooltip>
                        ) : null}

                        {showPublishBtn ? (
                          <Button className="gap-1.5" disabled={busy} onClick={() => setPublishOpen(true)}>
                            <Rocket className="h-4 w-4" aria-hidden />
                            انتشار فوری
                          </Button>
                        ) : null}

                        {showCancelBtn ? (
                          <Button
                            variant="outline"
                            className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={busy}
                            onClick={() => setCancelOpen(true)}
                          >
                            <Ban className="h-4 w-4" aria-hidden />
                            لغو بسته
                          </Button>
                        ) : null}

                        {noActionsAvailable ? (
                          <p className="text-xs text-muted-foreground">
                            در وضعیت فعلی، اقدامی در دسترس شما نیست.
                          </p>
                        ) : null}
                      </div>

                      {showScheduleForm ? (
                        <Field
                          label="زمان انتشار"
                          htmlFor="bundle-schedule-input"
                          hint="منطقهٔ زمانی: Asia/Tehran (UTC+03:30) — بسته در موعد مقرر به‌صورت خودکار منتشر می‌شود."
                          className="border-t pt-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              id="bundle-schedule-input"
                              type="datetime-local"
                              dir="ltr"
                              className="w-auto"
                              value={scheduleValue}
                              onChange={(e) => setScheduleValue(e.target.value)}
                            />
                            <Button
                              size="sm"
                              className="gap-1.5"
                              disabled={busy || !scheduleValue}
                              onClick={() => void saveSchedule()}
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <CalendarClock className="h-4 w-4" aria-hidden />
                              )}
                              ذخیرهٔ زمان انتشار
                            </Button>
                            {detail.status === 'SCHEDULED' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                disabled={busy}
                                onClick={() => void runBundleAction('CANCEL_SCHEDULE')}
                              >
                                <CalendarX2 className="h-4 w-4" aria-hidden />
                                لغو زمان‌بندی
                              </Button>
                            ) : null}
                          </div>
                        </Field>
                      ) : null}
                    </div>
                  </TabsContent>

                  {/* ── ۴. سابقهٔ اجرا ── */}
                  <TabsContent value="runs" className="mt-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">اجراهای انتشار</h3>
                      {canPublish && (detail.status === 'PARTIAL' || detail.status === 'FAILED') ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={busy}
                          onClick={() => void runBundleAction('RETRY')}
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden />
                          تلاش مجدد برای موارد ناموفق
                        </Button>
                      ) : null}
                    </div>

                    {detail.runs.length === 0 ? (
                      <EmptyState
                        compact
                        title="هنوز اجرایی ثبت نشده است"
                        description="با انتشار بسته، گزارش کامل نتیجهٔ هر جزء اینجا ثبت می‌شود."
                        icon={<Rocket className="h-7 w-7" />}
                      />
                    ) : (
                      <div className="max-h-[32rem] space-y-3 overflow-y-auto pe-1">
                        {(() => {
                          const runNumberById = new Map(detail.runs.map((r, i) => [r.id, i + 1]))
                          return detail.runs.map((run, idx) => (
                            <RunCard
                              key={run.id}
                              run={run}
                              runNumber={idx + 1}
                              retryOfNumber={run.retryOfId ? runNumberById.get(run.retryOfId) ?? null : null}
                            />
                          ))
                        })()}
                      </div>
                    )}

                    <HistorySection history={detail.history} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : null}
        </section>
      </div>

      {/* ── گفت‌وگوی ایجاد بسته ── */}
      <CreateBundleDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      {/* ── گفت‌وگوی افزودن قلم ── */}
      {detail ? (
        <AddItemDialog
          bundleId={detail.id}
          open={addItemOpen}
          onOpenChange={setAddItemOpen}
          excludeIds={detail.items.map((it) => it.articleId)}
          onSaved={refreshAfterChange}
        />
      ) : null}

      {/* ── گفت‌وگوی تغییر نسخهٔ قلم ── */}
      {versionTarget && detail ? (
        <VersionDialog
          item={versionTarget}
          bundleId={detail.id}
          open
          onOpenChange={(o) => {
            if (!o) setVersionTarget(null)
          }}
          onSaved={refreshAfterChange}
        />
      ) : null}

      {/* ── تأیید حذف قلم ── */}
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRemoveTarget(null)
        }}
        title="حذف قلم از بسته"
        description={`قلم «${removeTarget?.articleTitle ?? ''}» از بسته حذف می‌شود؛ بعداً می‌توانید دوباره آن را بیفزایید.`}
        confirmLabel="حذف از بسته"
        destructive
        loading={busy}
        onConfirm={() => void removeItem()}
      />

      {/* ── تأیید انتشار فوری ── */}
      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="انتشار فوری بسته"
        description="هر جزء به‌طور مستقل منتشر می‌شود و نتیجهٔ آن جداگانه ثبت می‌گردد؛ اگر نسخهٔ تازه‌تری پس از تأیید ثبت شده باشد، آن جزء رد می‌شود. ادامه می‌دهید؟"
        confirmLabel="انتشار فوری"
        loading={busy}
        onConfirm={() => {
          setPublishOpen(false)
          void runBundleAction('PUBLISH')
        }}
      />

      {/* ── تأیید لغو بسته ── */}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="لغو بسته"
        description={`بسته «${detail?.title ?? ''}» لغو می‌شود و دیگر قابل انتشار نیست. ادامه می‌دهید؟`}
        confirmLabel="لغو بسته"
        destructive
        loading={busy}
        onConfirm={() => {
          setCancelOpen(false)
          void runBundleAction('CANCEL')
        }}
      />

      {/* ── تأیید حذف بسته ── */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="حذف بسته"
        description={`بسته «${detail?.title ?? ''}» برای همیشه حذف می‌شود. این عملیات قابل بازگشت نیست.`}
        confirmLabel="حذف"
        destructive
        loading={busy}
        onConfirm={() => void deleteBundle()}
      />
    </div>
  )
}
