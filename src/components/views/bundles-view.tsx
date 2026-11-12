'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  Info,
  ListPlus,
  Loader2,
  PackageOpen,
  PackagePlus,
  Plus,
  Rocket,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingSpinner,
  PageHeader,
  SearchInput,
  StatusBadge,
} from '@/components/shared/ui-bits'
import { apiDelete, apiGet, apiPost } from '@/lib/client/api'
import { faDateTime, timeAgo, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { cn } from '@/lib/utils'

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

type BundleStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'

type BundleItem = {
  id: string
  articleId: string
  title: string
  /** وضعیت فعلی مقاله */
  status: string
  snapshotStatus: string
  result: 'SUCCESS' | 'FAILED' | null
  message: string | null
}

type BundleRow = {
  id: string
  title: string
  note: string | null
  status: BundleStatus
  scheduledAt: string | null
  publishedAt: string | null
  createdByName: string
  createdAt: string
  items: BundleItem[]
}

type BundlesResponse = { items: BundleRow[]; executedDue: number }

type PublishResponse = BundleRow & {
  execution: {
    status: 'PUBLISHED' | 'PARTIAL' | 'FAILED'
    results: { articleId: string; title: string; result: 'SUCCESS' | 'FAILED'; message: string }[]
  }
}

type PickerArticle = { id: string; title: string; status: string }
type ArticleListResponse = { items: PickerArticle[]; total: number }

type StatusMeta = { label: string; colorClass: string; bgClass: string }

const BUNDLE_STATUS_META: Record<BundleStatus, StatusMeta> = {
  DRAFT: { label: 'پیش‌نویس', colorClass: 'text-slate-700 dark:text-slate-300', bgClass: 'bg-slate-100 dark:bg-slate-950' },
  SCHEDULED: { label: 'زمان‌بندی‌شده', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  PUBLISHING: { label: 'در حال انتشار', colorClass: 'text-teal-700 dark:text-teal-300', bgClass: 'bg-teal-100 dark:bg-teal-950' },
  PUBLISHED: { label: 'منتشرشده', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  PARTIAL: { label: 'انتشار ناقص', colorClass: 'text-orange-700 dark:text-orange-300', bgClass: 'bg-orange-100 dark:bg-orange-950' },
  FAILED: { label: 'ناموفق', colorClass: 'text-rose-700 dark:text-rose-300', bgClass: 'bg-rose-100 dark:bg-rose-950' },
  CANCELLED: { label: 'لغوشده', colorClass: 'text-zinc-700 dark:text-zinc-300', bgClass: 'bg-zinc-100 dark:bg-zinc-950' },
}

const ARTICLE_STATUS_META: Record<'DRAFT' | 'IN_REVIEW' | 'NEEDS_REVISION' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED', StatusMeta> = {
  DRAFT: { label: 'پیش‌نویس', colorClass: 'text-slate-700 dark:text-slate-300', bgClass: 'bg-slate-100 dark:bg-slate-950' },
  IN_REVIEW: { label: 'در انتظار بررسی', colorClass: 'text-amber-700 dark:text-amber-300', bgClass: 'bg-amber-100 dark:bg-amber-950' },
  NEEDS_REVISION: { label: 'نیازمند اصلاح', colorClass: 'text-orange-700 dark:text-orange-300', bgClass: 'bg-orange-100 dark:bg-orange-950' },
  APPROVED: { label: 'تأییدشده', colorClass: 'text-teal-700 dark:text-teal-300', bgClass: 'bg-teal-100 dark:bg-teal-950' },
  PUBLISHED: { label: 'منتشرشده', colorClass: 'text-emerald-700 dark:text-emerald-300', bgClass: 'bg-emerald-100 dark:bg-emerald-950' },
  ARCHIVED: { label: 'بایگانی', colorClass: 'text-zinc-700 dark:text-zinc-300', bgClass: 'bg-zinc-100 dark:bg-zinc-950' },
}

/** برچسب و رنگ وضعیت فعلی مقاله با مقدار پیش‌فرض برای مقادیر ناشناخته */
function articleStatusMeta(status: string): StatusMeta {
  switch (status) {
    case 'DRAFT':
      return ARTICLE_STATUS_META.DRAFT
    case 'IN_REVIEW':
      return ARTICLE_STATUS_META.IN_REVIEW
    case 'NEEDS_REVISION':
      return ARTICLE_STATUS_META.NEEDS_REVISION
    case 'APPROVED':
      return ARTICLE_STATUS_META.APPROVED
    case 'PUBLISHED':
      return ARTICLE_STATUS_META.PUBLISHED
    case 'ARCHIVED':
      return ARTICLE_STATUS_META.ARCHIVED
    default:
      return { label: status, colorClass: 'text-slate-700 dark:text-slate-300', bgClass: 'bg-slate-100 dark:bg-slate-950' }
  }
}

/** وضعیت آمادگی یا نتیجه انتشار هر جزء */
function itemState(it: BundleItem): React.ReactNode {
  if (it.result === 'SUCCESS') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        {it.message || 'منتشر شد'}
      </span>
    )
  }
  if (it.result === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400">
        <XCircle className="h-3.5 w-3.5" aria-hidden />
        {it.message || 'انتشار ناموفق بود'}
      </span>
    )
  }
  if (it.status === 'APPROVED' || it.status === 'PUBLISHED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        {it.status === 'APPROVED' ? 'آماده انتشار' : 'از قبل منتشرشده'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-500">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      غیرآماده
    </span>
  )
}

/** تبدیل ISO به مقدار قابل نمایش در input نوع datetime-local (زمان محلی) */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** انتخابگر مقاله — مشترک بین گفت‌وگوی ایجاد و ویرایش اجزا */
function ArticlePicker({
  articles,
  loading,
  query,
  onQueryChange,
  selected,
  onToggle,
}: {
  articles: PickerArticle[]
  loading: boolean
  query: string
  onQueryChange: (v: string) => void
  selected: string[]
  onToggle: (id: string) => void
}) {
  const q = query.trim()
  const filtered = q ? articles.filter((a) => a.title.includes(q)) : articles

  return (
    <div className="space-y-2">
      <SearchInput value={query} onChange={onQueryChange} placeholder="جست‌وجوی مقاله…" />
      <ScrollArea className="max-h-72 rounded-xl border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span className="text-sm">در حال دریافت مقالات…</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">مقاله‌ای یافت نشد.</p>
        ) : (
          <div className="divide-y">
            {filtered.map((a) => {
              const isSel = selected.includes(a.id)
              const meta = articleStatusMeta(a.status)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onToggle(a.id)}
                  className="flex w-full items-center gap-2.5 p-2.5 text-start transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-pressed={isSel}
                  aria-label={`${isSel ? 'حذف' : 'افزودن'} «${a.title}» ${isSel ? 'از' : 'به'} بسته`}
                >
                  <CheckCircle2
                    className={cn('h-5 w-5 shrink-0 transition-colors', isSel ? 'text-emerald-600' : 'text-muted-foreground/30')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
                  <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                </button>
              )
            })}
          </div>
        )}
      </ScrollArea>
      <Badge variant="secondary">{toFa(selected.length)} مقاله انتخاب شد</Badge>
    </div>
  )
}

export function BundlesView() {
  const can = useCan()
  const canCreate = can('articles.create')
  const canPublish = can('articles.publish')

  const [bundles, setBundles] = React.useState<BundleRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی ایجاد بسته
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createTitle, setCreateTitle] = React.useState('')
  const [createNote, setCreateNote] = React.useState('')
  const [createQuery, setCreateQuery] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [titleError, setTitleError] = React.useState<string | null>(null)
  const [pickerError, setPickerError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // انتخابگر مقالات (مشترک بین ایجاد و ویرایش اجزا)
  const [pickerArticles, setPickerArticles] = React.useState<PickerArticle[]>([])
  const [pickerLoading, setPickerLoading] = React.useState(false)

  // گفت‌وگوی ویرایش اجزا
  const [editTarget, setEditTarget] = React.useState<BundleRow | null>(null)
  const [editSelected, setEditSelected] = React.useState<string[]>([])
  const [editQuery, setEditQuery] = React.useState('')
  const [editError, setEditError] = React.useState<string | null>(null)
  const [savingEdit, setSavingEdit] = React.useState(false)

  // گفت‌وگوی زمان‌بندی
  const [scheduleTarget, setScheduleTarget] = React.useState<BundleRow | null>(null)
  const [scheduleValue, setScheduleValue] = React.useState('')
  const [scheduleError, setScheduleError] = React.useState<string | null>(null)
  const [savingSchedule, setSavingSchedule] = React.useState(false)

  // انتشار فوری و حذف
  const [publishTarget, setPublishTarget] = React.useState<BundleRow | null>(null)
  const [publishing, setPublishing] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<BundleRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<BundlesResponse>('/api/bundles')
      setBundles(res.items)
      if (res.executedDue > 0) {
        toast.info(`${toFa(res.executedDue)} بسته زمان‌بندی‌شده به‌صورت خودکار اجرا شد.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت بسته‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const loadPicker = React.useCallback(async () => {
    setPickerLoading(true)
    try {
      const res = await apiGet<ArticleListResponse>('/api/articles?pageSize=100')
      setPickerArticles(res.items)
    } catch (e) {
      setPickerArticles([])
      toast.error(e instanceof Error ? e.message : 'دریافت فهرست مقالات ناموفق بود.')
    } finally {
      setPickerLoading(false)
    }
  }, [])

  const openCreate = async () => {
    setCreateTitle('')
    setCreateNote('')
    setCreateQuery('')
    setSelectedIds([])
    setTitleError(null)
    setPickerError(null)
    setCreateOpen(true)
    await loadPicker()
  }

  const togglePick = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleEditPick = (id: string) => {
    setEditSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const submitCreate = async () => {
    const title = createTitle.trim()
    if (title.length < 3) {
      setTitleError('عنوان بسته باید دست‌کم ۳ نویسه باشد.')
      return
    }
    if (selectedIds.length === 0) {
      setPickerError('حداقل یک مقاله به بسته اضافه کنید.')
      return
    }
    setSaving(true)
    setTitleError(null)
    setPickerError(null)
    try {
      await apiPost<BundleRow>('/api/bundles', {
        title,
        note: createNote.trim() || undefined,
        articleIds: selectedIds,
      })
      toast.success('بسته ایجاد شد.')
      setCreateOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ایجاد بسته ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = async (b: BundleRow) => {
    setEditTarget(b)
    setEditSelected(b.items.map((it) => it.articleId))
    setEditQuery('')
    setEditError(null)
    await loadPicker()
  }

  const submitEdit = async () => {
    if (!editTarget) return
    if (editSelected.length === 0) {
      setEditError('حداقل یک مقاله لازم است.')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      await apiPatch<BundleRow>(`/api/bundles/${editTarget.id}`, { articleIds: editSelected })
      toast.success('اجزای بسته به‌روزرسانی شد.')
      setEditTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'به‌روزرسانی اجزای بسته ناموفق بود.')
    } finally {
      setSavingEdit(false)
    }
  }

  const openSchedule = (b: BundleRow) => {
    setScheduleTarget(b)
    setScheduleValue(b.scheduledAt ? toLocalInputValue(b.scheduledAt) : '')
    setScheduleError(null)
  }

  const submitSchedule = async () => {
    if (!scheduleTarget) return
    if (!scheduleValue) {
      setScheduleError('انتخاب زمان انتشار الزامی است.')
      return
    }
    const d = new Date(scheduleValue)
    if (Number.isNaN(d.getTime())) {
      setScheduleError('زمان انتخابی نامعتبر است.')
      return
    }
    setSavingSchedule(true)
    setScheduleError(null)
    try {
      await apiPatch<BundleRow>(`/api/bundles/${scheduleTarget.id}`, { scheduledAt: d.toISOString() })
      toast.success('زمان‌بندی ثبت شد.')
      setScheduleTarget(null)
      load()
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : 'ثبت زمان‌بندی ناموفق بود.')
    } finally {
      setSavingSchedule(false)
    }
  }

  const cancelSchedule = async (b: BundleRow) => {
    setBusyId(b.id)
    try {
      await apiPatch<BundleRow>(`/api/bundles/${b.id}`, { scheduledAt: '' })
      toast.success('زمان‌بندی لغو شد.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'لغو زمان‌بندی ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  const confirmPublish = async () => {
    if (!publishTarget) return
    setPublishing(true)
    try {
      const res = await apiPost<PublishResponse>(`/api/bundles/${publishTarget.id}`)
      const okCount = res.execution.results.filter((r) => r.result === 'SUCCESS').length
      const failCount = res.execution.results.length - okCount
      if (res.execution.status === 'PUBLISHED') {
        toast.success(`انتشار کامل شد — ${toFa(okCount)} جزء منتشر شد.`)
      } else if (res.execution.status === 'PARTIAL') {
        toast.warning(`انتشار ناقص — ${toFa(okCount)} موفق، ${toFa(failCount)} ناموفق.`)
      } else {
        toast.error(`انتشار ناموفق بود — ${toFa(failCount)} جزء منتشر نشد.`)
      }
      setPublishTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'انتشار بسته ناموفق بود.')
    } finally {
      setPublishing(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/bundles?id=${deleteTarget.id}`)
      toast.success('بسته حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف بسته ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  const retryFailed = async (b: BundleRow) => {
    const failedIds = b.items.filter((it) => it.result === 'FAILED').map((it) => it.articleId)
    if (failedIds.length === 0) return
    setBusyId(b.id)
    try {
      await apiPost<BundleRow>('/api/bundles', {
        title: `${b.title} — اجزای ناموفق`,
        note: `ساخته‌شده از اجزای ناموفق بسته «${b.title}»`,
        articleIds: failedIds,
      })
      toast.success('بسته جدید از اجزای ناموفق ساخته شد.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ساخت بسته از اجزای ناموفق ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading && bundles === null) return <LoadingSpinner label="در حال بارگذاری بسته‌ها…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (bundles === null) return null

  return (
    <div className="space-y-6">
      <PageHeader
        title="بسته‌های انتشار"
        description="چند تغییر مرتبط را هماهنگ، آماده و منتشر کنید — گزارش نتیجه هر جزء جداگانه ثبت می‌شود"
        icon={<PackageOpen className="h-5 w-5" />}
        actions={
          canCreate ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              بسته جدید
            </Button>
          ) : null
        }
      />

      {/* ── نکته رفتار انتشار جزء‌به‌جزء ─────────────────────── */}
      <Alert className="text-muted-foreground">
        <Info className="h-4 w-4" />
        <AlertDescription>
          هر جزء مستقل منتشر می‌شود؛ گزارش موفقیت و شکست هر مقاله جداگانه ثبت می‌شود. تضمین «همه یا هیچ» ارائه نمی‌شود.
        </AlertDescription>
      </Alert>

      {/* ── فهرست بسته‌ها ────────────────────────────────────── */}
      <div className="max-w-4xl space-y-4">
        {bundles.length === 0 ? (
          <EmptyState
            title="هنوز بسته‌ای ساخته نشده است"
            description="چند مقاله مرتبط را گروه‌بندی کنید تا همه‌با هم هماهنگ منتشر شوند."
            icon={<PackageOpen className="h-8 w-8" />}
            action={
              canCreate ? (
                <Button onClick={openCreate} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  بسته جدید
                </Button>
              ) : undefined
            }
          />
        ) : (
          bundles.map((b) => {
            const meta = BUNDLE_STATUS_META[b.status] ?? BUNDLE_STATUS_META.DRAFT
            const failedCount = b.items.filter((it) => it.result === 'FAILED').length
            const isDone = b.status === 'PUBLISHED' || b.status === 'PARTIAL' || b.status === 'FAILED'

            const actions: React.ReactNode[] = []
            if (b.status === 'DRAFT') {
              if (canPublish) {
                actions.push(
                  <Button key="publish" size="sm" onClick={() => setPublishTarget(b)} className="gap-1.5">
                    <Rocket className="h-4 w-4" aria-hidden />
                    انتشار فوری
                  </Button>,
                  <Button key="schedule" size="sm" variant="outline" onClick={() => openSchedule(b)} className="gap-1.5">
                    <CalendarClock className="h-4 w-4" aria-hidden />
                    زمان‌بندی
                  </Button>,
                )
              }
              if (canCreate) {
                actions.push(
                  <Button key="edit" size="sm" variant="outline" onClick={() => openEdit(b)} className="gap-1.5">
                    <ListPlus className="h-4 w-4" aria-hidden />
                    ویرایش اجزا
                  </Button>,
                )
              }
              if (canCreate || canPublish) {
                actions.push(
                  <Button
                    key="delete"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteTarget(b)}
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    حذف
                  </Button>,
                )
              }
            } else if (b.status === 'SCHEDULED') {
              if (canPublish) {
                actions.push(
                  <Button
                    key="unschedule"
                    size="sm"
                    variant="outline"
                    disabled={busyId === b.id}
                    onClick={() => cancelSchedule(b)}
                    className="gap-1.5"
                  >
                    {busyId === b.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarX className="h-4 w-4" aria-hidden />}
                    لغو زمان‌بندی
                  </Button>,
                  <Button key="publish" size="sm" onClick={() => setPublishTarget(b)} className="gap-1.5">
                    <Rocket className="h-4 w-4" aria-hidden />
                    انتشار فوری
                  </Button>,
                )
              }
            } else if (isDone && failedCount > 0 && canCreate) {
              actions.push(
                <Button
                  key="retry-failed"
                  size="sm"
                  variant="outline"
                  disabled={busyId === b.id}
                  onClick={() => retryFailed(b)}
                  className="gap-1.5"
                >
                  {busyId === b.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PackagePlus className="h-4 w-4" aria-hidden />}
                  ساخت بسته جدید از اجزای ناموفق
                </Button>,
              )
            }

            return (
              <Card key={b.id} className="rounded-2xl shadow-xs">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{b.title}</CardTitle>
                      {b.note ? <CardDescription className="mt-1 leading-6">{b.note}</CardDescription> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{b.createdByName}</span>
                        <span>{timeAgo(b.createdAt)}</span>
                        <span className="tabular-nums">{toFa(b.items.length)} جزء</span>
                        {b.status === 'SCHEDULED' && b.scheduledAt ? (
                          <span className="font-medium text-amber-700 dark:text-amber-400">موعد: {faDateTime(b.scheduledAt)}</span>
                        ) : null}
                        {isDone && b.publishedAt ? <span>انتشار: {faDateTime(b.publishedAt)}</span> : null}
                      </div>
                    </div>
                    <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {b.items.length > 0 ? (
                    <ul className="divide-y rounded-xl border">
                      {b.items.map((it) => {
                        const am = articleStatusMeta(it.status)
                        return (
                          <li key={it.id} className="p-3">
                            <p className="truncate text-sm font-medium">{it.title}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <StatusBadge label={am.label} colorClass={am.colorClass} bgClass={am.bgClass} />
                              {itemState(it)}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">هیچ جزئی در این بسته نیست.</p>
                  )}
                  {actions.length > 0 ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* ── گفت‌وگوی بسته جدید ───────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>بسته جدید</DialogTitle>
            <DialogDescription>مقالات مرتبط را برای انتشار هماهنگ انتخاب کنید.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field label="عنوان بسته" required htmlFor="bundle-title" error={titleError ?? undefined}>
              <Input
                id="bundle-title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="مثلاً: انتشار ویژه نوروز"
                maxLength={150}
              />
            </Field>
            <Field label="توضیح" htmlFor="bundle-note">
              <Textarea
                id="bundle-note"
                rows={2}
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                placeholder="توضیح اختیاری درباره این بسته…"
                maxLength={500}
              />
            </Field>
            <Field label="انتخاب مقالات" error={pickerError ?? undefined}>
              <ArticlePicker
                articles={pickerArticles}
                loading={pickerLoading}
                query={createQuery}
                onQueryChange={setCreateQuery}
                selected={selectedIds}
                onToggle={togglePick}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={submitCreate} disabled={saving || createTitle.trim().length < 3 || selectedIds.length === 0}>
              {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              ایجاد بسته
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── گفت‌وگوی ویرایش اجزا ─────────────────────────────── */}
      <Dialog open={editTarget !== null} onOpenChange={(o) => { if (!o) setEditTarget(null) }}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>ویرایش اجزای بسته</DialogTitle>
            <DialogDescription>اجزای جدید جایگزین اجزای فعلی بسته «{editTarget?.title}» می‌شوند.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field label="انتخاب مقالات" error={editError ?? undefined}>
              <ArticlePicker
                articles={pickerArticles}
                loading={pickerLoading}
                query={editQuery}
                onQueryChange={setEditQuery}
                selected={editSelected}
                onToggle={toggleEditPick}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>
              انصراف
            </Button>
            <Button onClick={submitEdit} disabled={savingEdit || editSelected.length === 0}>
              {savingEdit ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              ذخیره اجزا
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── گفت‌وگوی زمان‌بندی ───────────────────────────────── */}
      <Dialog open={scheduleTarget !== null} onOpenChange={(o) => { if (!o) setScheduleTarget(null) }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>زمان‌بندی انتشار</DialogTitle>
            <DialogDescription>تعیین زمان خودکار برای انتشار بسته «{scheduleTarget?.title}».</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field
              label="زمان انتشار"
              required
              htmlFor="bundle-schedule"
              error={scheduleError ?? undefined}
              hint="بسته در موعد مقرر به‌صورت خودکار در نخستین بارگذاری صفحات پنل منتشر می‌شود."
            >
              <Input
                id="bundle-schedule"
                type="datetime-local"
                dir="ltr"
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleTarget(null)} disabled={savingSchedule}>
              انصراف
            </Button>
            <Button onClick={submitSchedule} disabled={savingSchedule || !scheduleValue}>
              {savingSchedule ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              ثبت زمان‌بندی
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── تأیید انتشار فوری ───────────────────────────────── */}
      <ConfirmDialog
        open={publishTarget !== null}
        onOpenChange={(o) => { if (!o) setPublishTarget(null) }}
        title="انتشار بسته"
        description="اجزای آماده منتشر می‌شوند و نتیجه هر جزء در گزارش ثبت می‌شود."
        confirmLabel="انتشار فوری"
        loading={publishing}
        onConfirm={confirmPublish}
      />

      {/* ── تأیید حذف بسته ──────────────────────────────────── */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title="حذف بسته"
        description={`بسته «${deleteTarget?.title}» حذف شود؟ این عملیات قابل بازگشت نیست.`}
        confirmLabel="حذف"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
