'use client'

import * as React from 'react'
import {
  ArrowRight,
  ChevronLeft,
  Download,
  FilePlus2,
  FileText,
  Info,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DataTable, type Column } from '@/components/shared/data-table'
import {
  PageHeader,
  StatusBadge,
  SearchInput,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSpinner,
} from '@/components/shared/ui-bits'
import { ImpactDialog } from '@/components/shared/impact-dialog'
import { apiGet, apiPost, apiDelete, type PagedResponse } from '@/lib/client/api'
import { notifyGuideEvent } from '@/lib/client/guide'
import { toFa, faDate, downloadCsv } from '@/lib/client/format'
import { useAppStore, useCan } from '@/store/app-store'
import { ARTICLE_STATUSES, articleStatusInfo, TRANSITION_LABELS, type TransitionAction } from '@/lib/constants'
import { navigate, useHashRoute } from '@/hooks/use-hash-route'

type ArticleRow = {
  id: string
  title: string
  slug: string
  status: string
  authorId: string
  views: number
  createdAt: string
  updatedAt: string
  author: { id: string; name: string }
  category: { id: string; name: string; color: string } | null
  sourceTemplateName?: string | null
  sourceTemplateVersion?: number | null
}

type CategoryLite = { id: string; name: string }

// ─── گزینه‌های الگو برای گفت‌وگوی «ایجاد محتوا» ─────────────────

type TplStructureRow = {
  key?: string
  label: string
  kind: string
  required?: boolean
  guide?: string
}

type TemplateOption = {
  id: string
  name: string
  description: string
  type: string
  version: number
  isActive: boolean
  titleTemplate: string
  excerptTemplate: string
  structure: string
  guideText: string
  checklist: string
  parsedStructure?: TplStructureRow[]
  parsedChecklist?: string[]
}

/** ظاهر نشان نوع الگو (پالت کهربایی/بنفش — بدون آبی) */
const TPL_TYPE_META: Record<string, { label: string; colorClass: string; bgClass: string }> = {
  ARTICLE: {
    label: 'مقاله',
    colorClass: 'text-amber-700 dark:text-amber-300',
    bgClass: 'bg-amber-100 dark:bg-amber-950/60',
  },
  LANDING: {
    label: 'صفحه فرود',
    colorClass: 'text-violet-700 dark:text-violet-300',
    bgClass: 'bg-violet-100 dark:bg-violet-950/60',
  },
}

/** ظاهر نشان فیلد/بلوک در پیش‌نمایش ساختار */
const TPL_KIND_META: Record<string, { label: string; colorClass: string; bgClass: string }> = {
  FIELD: { label: 'فیلد', colorClass: 'text-muted-foreground', bgClass: 'bg-muted' },
  BLOCK: {
    label: 'بلوک',
    colorClass: 'text-violet-700 dark:text-violet-300',
    bgClass: 'bg-violet-100 dark:bg-violet-950/60',
  },
}

/** تجزیه امن JSON ساختار الگو (بازگشت به تجزیه محلی در نبود فیلد parsed سرور) */
function parseTplStructure(json: string | undefined): TplStructureRow[] {
  if (!json || !json.trim()) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is TplStructureRow => !!r && typeof r === 'object' && typeof (r as TplStructureRow).label === 'string'
    )
  } catch {
    return []
  }
}

function parseTplStringList(json: string | undefined): string[] {
  if (!json || !json.trim()) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
  } catch {
    return []
  }
}

function tplStructureOf(t: TemplateOption): TplStructureRow[] {
  if (Array.isArray(t.parsedStructure)) return t.parsedStructure
  return parseTplStructure(t.structure)
}

function tplChecklistOf(t: TemplateOption): string[] {
  if (Array.isArray(t.parsedChecklist)) return t.parsedChecklist
  return parseTplStringList(t.checklist)
}

type SortValue = 'new' | 'old' | 'views' | 'title'

const SORT_OPTIONS: { value: SortValue; label: string; sort: string; dir: 'asc' | 'desc' }[] = [
  { value: 'new', label: 'جدیدترین', sort: 'createdAt', dir: 'desc' },
  { value: 'old', label: 'قدیمی‌ترین', sort: 'createdAt', dir: 'asc' },
  { value: 'views', label: 'پربازدیدترین', sort: 'views', dir: 'desc' },
  { value: 'title', label: 'الفبایی', sort: 'title', dir: 'asc' },
]

/** مقدار تاخیر debounce جست‌وجو */
const DEBOUNCE_MS = 300

function useDebouncedValue<T>(value: T, delay = DEBOUNCE_MS): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return v
}

/** انتقال‌های مجاز برای یک ردیف بر اساس وضعیت و مجوزهای کاربر (هم‌راستا با منطق سرور) */
function rowTransitions(row: ArticleRow, userId: string | undefined, can: (p: string) => boolean): TransitionAction[] {
  const list: TransitionAction[] = []
  const isOwn = !!userId && userId === row.authorId
  if ((row.status === 'DRAFT' || row.status === 'NEEDS_REVISION') && can('articles.create') && (isOwn || can('articles.review'))) {
    list.push('SUBMIT_REVIEW')
  }
  if (row.status === 'IN_REVIEW' && can('articles.review')) list.push('APPROVE')
  if (row.status === 'APPROVED' && can('articles.publish')) list.push('PUBLISH')
  if (row.status === 'PUBLISHED' && can('articles.publish')) list.push('UNPUBLISH')
  if ((row.status === 'PUBLISHED' || row.status === 'APPROVED') && can('articles.publish')) list.push('ARCHIVE')
  return list
}

export function ArticlesView() {
  const { segments } = useHashRoute()
  // مسیرهای فرعی (/articles/new و /articles/{id}/edit) توسط ویرایشگر مدیریت می‌شوند
  if (segments.length > 1) return null

  return <ArticlesListPage />
}

function ArticlesListPage() {
  const user = useAppStore((s) => s.user)
  const can = useCan()

  const [rows, setRows] = React.useState<ArticleRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [categories, setCategories] = React.useState<CategoryLite[]>([])

  // فیلترها
  const [q, setQ] = React.useState('')
  const debouncedQ = useDebouncedValue(q)
  const [status, setStatus] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('all')
  const [sort, setSort] = React.useState<SortValue>('new')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)

  // انتخاب گروهی
  const [selected, setSelected] = React.useState<string[]>([])
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)

  // حذف تک‌موردی با بررسی اثر پیش از حذف
  const [impactTarget, setImpactTarget] = React.useState<{ type: 'article'; id: string; name: string } | null>(null)

  // خروجی CSV
  const [exporting, setExporting] = React.useState(false)

  // ─── گفت‌وگوی سه‌گامی «ایجاد محتوا» (شروع خالی یا ساخت با الگو) ──
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createStep, setCreateStep] = React.useState<1 | 2 | 3>(1)
  const [tpls, setTpls] = React.useState<TemplateOption[]>([])
  const [tplsLoading, setTplsLoading] = React.useState(false)
  const [tplsError, setTplsError] = React.useState<string | null>(null)
  const [selectedTpl, setSelectedTpl] = React.useState<TemplateOption | null>(null)
  const [creatingFromTpl, setCreatingFromTpl] = React.useState(false)
  const tplSeqRef = React.useRef(0)

  const openCreateDialog = () => {
    setCreateStep(1)
    setSelectedTpl(null)
    setTplsError(null)
    setCreatingFromTpl(false)
    setCreateOpen(true)
  }

  const closeCreateDialog = () => {
    setCreateOpen(false)
    setCreateStep(1)
    setSelectedTpl(null)
    setTplsError(null)
    setCreatingFromTpl(false)
  }

  /** دریافت الگوها برای گام ۲ — فقط الگوهای فعال نمایش داده می‌شوند */
  const loadTemplates = React.useCallback(async () => {
    const seq = ++tplSeqRef.current
    setTplsLoading(true)
    setTplsError(null)
    try {
      const res = await apiGet<{ items: TemplateOption[] }>('/api/templates')
      if (seq !== tplSeqRef.current) return
      setTpls(res.items.filter((t) => t.isActive))
    } catch (e) {
      if (seq !== tplSeqRef.current) return
      setTplsError(e instanceof Error ? e.message : 'خطا در دریافت الگوها')
    } finally {
      if (seq === tplSeqRef.current) setTplsLoading(false)
    }
  }, [])

  /** گام ۳: ایجاد پیش‌نویس مستقل از الگو و رفتن به ویرایشگر (مثل جریان ایجاد عادی) */
  const createFromTemplate = async () => {
    if (!selectedTpl) return
    setCreatingFromTpl(true)
    try {
      const created = await apiPost<{ id: string; title: string; slug: string }>('/api/templates/create-content', {
        templateId: selectedTpl.id,
      })
      toast.success(`پیش‌نویس مستقل «${created.title}» از الگوی «${selectedTpl.name}» ساخته شد.`)
      closeCreateDialog()
      navigate(`/articles/${created.id}/edit`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ساخت محتوا از الگو ناموفق بود.')
    } finally {
      setCreatingFromTpl(false)
    }
  }

  const seqRef = React.useRef(0)

  const buildQuery = React.useCallback(
    (p: number, ps: number) => {
      const sp = new URLSearchParams()
      if (debouncedQ.trim()) sp.set('q', debouncedQ.trim())
      if (status) sp.set('status', status)
      if (categoryId !== 'all') sp.set('categoryId', categoryId)
      const sortOpt = SORT_OPTIONS.find((s) => s.value === sort) ?? SORT_OPTIONS[0]
      sp.set('sort', sortOpt.sort)
      sp.set('dir', sortOpt.dir)
      sp.set('page', String(p))
      sp.set('pageSize', String(ps))
      return sp.toString()
    },
    [debouncedQ, status, categoryId, sort]
  )

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<PagedResponse<ArticleRow>>(`/api/articles?${buildQuery(page, pageSize)}`)
      if (seq !== seqRef.current) return
      setRows(res.items)
      setTotal(res.total)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : 'خطا در دریافت فهرست مقالات')
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [buildQuery, page, pageSize])

  React.useEffect(() => {
    load()
  }, [load])

  // بازگشت به صفحه اول هنگام تغییر جست‌وجو
  React.useEffect(() => {
    setPage(1)
  }, [debouncedQ])

  // دسته‌بندی‌ها برای فیلتر (یک‌بار)
  React.useEffect(() => {
    apiGet<CategoryLite[]>('/api/categories')
      .then(setCategories)
      .catch(() => {
        /* فیلتر دسته‌بندی اختیاری است؛ خطا نادیده گرفته می‌شود */
      })
  }, [])

  const doTransition = async (id: string, action: TransitionAction) => {
    try {
      await apiPost(`/api/articles/${id}/transition`, { action })
      toast.success(`«${TRANSITION_LABELS[action]}» با موفقیت انجام شد.`)
      // راهنما: رویدادهای گردش کار فقط پس از موفقیت واقعی (سرور ایدمپوتنت و مجوزسنجی‌شده)
      if (action === 'APPROVE') {
        // تأیید = ثبت نتیجهٔ بازبینی + تأیید نسخه (هر دو گام)
        void notifyGuideEvent('article.reviewed')
        void notifyGuideEvent('article.approved')
      } else if (action === 'REJECT') {
        void notifyGuideEvent('article.revision_requested')
      } else if (action === 'SUBMIT_REVIEW') {
        void notifyGuideEvent('article.sent_to_review')
      }
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'انجام عملیات ناموفق بود.')
    }
  }

  // ─── عملیات گروهی (انتشار/لغو انتشار از طریق مرکز عملیات) ──────
  const MAX_BULK_OP_ITEMS = 100

  const startBulkOp = async (type: 'BULK_PUBLISH_ARTICLES' | 'BULK_UNPUBLISH_ARTICLES') => {
    if (selected.length > MAX_BULK_OP_ITEMS) {
      toast.error('هر عملیات گروهی حداکثر ۱۰۰ مورد می‌تواند داشته باشد.')
      return
    }
    setBulkBusy(true)
    try {
      await apiPost<{ id: string }>('/api/operations', { type, articleIds: selected })
      toast.success(
        type === 'BULK_PUBLISH_ARTICLES'
          ? 'عملیات انتشار گروهی در مرکز عملیات آغاز شد.'
          : 'عملیات لغو انتشار گروهی در مرکز عملیات آغاز شد.',
        { action: { label: 'مشاهده در مرکز عملیات', onClick: () => navigate('/operations') } }
      )
      setSelected([])
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت عملیات گروهی ناموفق بود.')
    } finally {
      setBulkBusy(false)
    }
  }

  // ─── بایگانی گروهی (متوالی — به‌صورت قبلی) ───────────────────
  const runBulkTransition = async (action: TransitionAction) => {
    setBulkBusy(true)
    let okCount = 0
    let failCount = 0
    for (const id of selected) {
      try {
        await apiPost(`/api/articles/${id}/transition`, { action })
        okCount++
      } catch {
        failCount++
      }
    }
    setBulkBusy(false)
    setSelected([])
    load()
    if (failCount === 0) toast.success(`${TRANSITION_LABELS[action]}: ${toFa(okCount)} مورد موفق.`)
    else toast.warning(`${TRANSITION_LABELS[action]}: ${toFa(okCount)} موفق، ${toFa(failCount)} ناموفق.`)
  }

  const bulkDelete = async () => {
    setBulkBusy(true)
    let okCount = 0
    let failCount = 0
    for (const id of selected) {
      try {
        await apiDelete(`/api/articles/${id}`)
        okCount++
      } catch {
        failCount++
      }
    }
    setBulkBusy(false)
    setBulkDeleteOpen(false)
    setSelected([])
    load()
    if (failCount === 0) toast.success(`حذف گروهی: ${toFa(okCount)} مقاله حذف شد.`)
    else toast.warning(`حذف گروهی: ${toFa(okCount)} موفق، ${toFa(failCount)} ناموفق.`)
  }

  // ─── خروجی CSV (همه صفحات منطبق با فیلترهای فعلی) ──────────────
  const exportCsv = async () => {
    setExporting(true)
    try {
      const pageSize = 100
      const all: ArticleRow[] = []
      const first = await apiGet<PagedResponse<ArticleRow>>(`/api/articles?${buildQuery(1, pageSize)}`)
      all.push(...first.items)
      const cappedTotal = Math.min(first.total, 1000)
      let p = 2
      while (all.length < cappedTotal) {
        const res = await apiGet<PagedResponse<ArticleRow>>(`/api/articles?${buildQuery(p, pageSize)}`)
        if (!res.items.length) break
        all.push(...res.items)
        p++
      }
      downloadCsv(
        'articles.csv',
        ['عنوان', 'وضعیت', 'نویسنده', 'دسته‌بندی', 'بازدید', 'تاریخ ایجاد'],
        all.map((a) => [
          a.title,
          articleStatusInfo(a.status).label,
          a.author?.name ?? '—',
          a.category?.name ?? '—',
          a.views,
          faDate(a.createdAt),
        ])
      )
      toast.success(`خروجی ${toFa(all.length)} مقاله دانلود شد.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ساخت خروجی CSV ناموفق بود.')
    } finally {
      setExporting(false)
    }
  }

  const canDeleteRow = (row: ArticleRow) =>
    can('articles.delete.any') || (can('articles.delete.own') && !!user && row.authorId === user.id)
  const canEditRow = (row: ArticleRow) =>
    can('articles.edit.any') || (can('articles.edit.own') && !!user && row.authorId === user.id)

  const columns: Column<ArticleRow>[] = [
    {
      key: 'title',
      header: 'عنوان',
      render: (row) => (
        <div className="min-w-0 max-w-xs">
          <p className="font-medium line-clamp-1">{row.title}</p>
          <p className="text-xs text-muted-foreground ltr-inline truncate block max-w-full" dir="ltr">
            {row.slug}
          </p>
          {row.sourceTemplateName ? (
            <Badge
              variant="outline"
              className="mt-1 max-w-full gap-1 text-[10px] font-normal text-muted-foreground"
              title={`ساخته‌شده از الگوی «${row.sourceTemplateName}» (نسخه ${toFa(row.sourceTemplateVersion ?? 0)})`}
            >
              <LayoutTemplate className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">الگو: {row.sourceTemplateName}</span>
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => {
        const info = articleStatusInfo(row.status)
        return <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
      },
    },
    { key: 'author', header: 'نویسنده', render: (row) => <span className="text-sm">{row.author?.name ?? '—'}</span> },
    {
      key: 'category',
      header: 'دسته‌بندی',
      render: (row) =>
        row.category ? (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: row.category.color }} aria-hidden />
            {row.category.name}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      key: 'views',
      header: 'بازدید',
      className: 'tabular-nums',
      render: (row) => <span className="text-sm tabular-nums">{toFa(row.views)}</span>,
    },
    { key: 'date', header: 'تاریخ ایجاد', render: (row) => <span className="text-sm whitespace-nowrap">{faDate(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      headerClassName: 'w-12',
      render: (row) => {
        const transitions = rowTransitions(row, user?.id, can)
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`عملیات مقاله ${row.title}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {canEditRow(row) ? (
                <DropdownMenuItem onClick={() => navigate(`/articles/${row.id}/edit`)}>
                  <Pencil className="h-4 w-4 me-2" />
                  ویرایش
                </DropdownMenuItem>
              ) : null}
              {transitions.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">گردش کار</DropdownMenuLabel>
                  {transitions.map((action) => (
                    <DropdownMenuItem key={action} onClick={() => doTransition(row.id, action)}>
                      {TRANSITION_LABELS[action]}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              {canDeleteRow(row) ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setImpactTarget({ type: 'article', id: row.id, name: row.title })}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 me-2" />
                    حذف
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const bulkBar =
    selected.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 mb-3">
        <Badge variant="secondary">{toFa(selected.length)} انتخاب‌شده</Badge>
        <span className="text-xs text-muted-foreground">عملیات روی موارد انتخاب‌شده در همین صفحه اعمال می‌شود.</span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {can('articles.publish') ? (
            <>
              <Button size="sm" onClick={() => startBulkOp('BULK_PUBLISH_ARTICLES')} disabled={bulkBusy}>
                انتشار
              </Button>
              <Button size="sm" variant="outline" onClick={() => startBulkOp('BULK_UNPUBLISH_ARTICLES')} disabled={bulkBusy}>
                لغو انتشار
              </Button>
              <Button size="sm" variant="outline" onClick={() => runBulkTransition('ARCHIVE')} disabled={bulkBusy}>
                بایگانی
              </Button>
            </>
          ) : null}
          {can('articles.delete.any') || can('articles.delete.own') ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkBusy}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setSelected([])} disabled={bulkBusy}>
            لغو انتخاب
          </Button>
        </div>
      </div>
    ) : null

  return (
    <div>
      <PageHeader
        title="مقالات"
        description="مدیریت مقالات، گردش کار انتشار و محتوا"
        icon={<FileText className="h-5 w-5" />}
        actions={
          <>
            {can('articles.view') ? (
              <Button variant="outline" onClick={exportCsv} disabled={exporting} className="gap-1.5">
                <Download className="h-4 w-4" />
                {exporting ? 'در حال ساخت خروجی…' : 'خروجی CSV'}
              </Button>
            ) : null}
            {can('articles.create') ? (
              <Button onClick={openCreateDialog} className="gap-1.5">
                <Plus className="h-4 w-4" />
                ایجاد محتوا
              </Button>
            ) : null}
          </>
        }
      />

      {/* نوار فیلترها */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="جست‌وجوی عنوان مقاله…" className="sm:max-w-xs w-full" />
        <Select
          value={status || 'all'}
          onValueChange={(v) => {
            setStatus(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="فیلتر وضعیت">
            <SelectValue placeholder="وضعیت" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همه وضعیت‌ها</SelectItem>
            {ARTICLE_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={categoryId}
          onValueChange={(v) => {
            setCategoryId(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="فیلتر دسته‌بندی">
            <SelectValue placeholder="دسته‌بندی" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همه دسته‌بندی‌ها</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => { setSort(v as SortValue); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-40 sm:ms-auto" aria-label="ترتیب نمایش">
            <SelectValue placeholder="مرتب‌سازی" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        error={error ? <ErrorState message={error} onRetry={load} /> : null}
        emptyState={
          <EmptyState
            title="مقاله‌ای یافت نشد"
            description="با تغییر فیلترها جست‌وجو کنید یا مقاله جدیدی بسازید."
            compact
          />
        }
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        itemLabel="مقاله"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        bulkBar={bulkBar}
      />

      {/* بررسی اثر و حذف تک‌مقاله */}
      <ImpactDialog
        target={impactTarget}
        onClose={() => setImpactTarget(null)}
        onDelete={async () => {
          if (!impactTarget) return
          await apiDelete(`/api/articles/${impactTarget.id}`)
        }}
        onDeleted={() => {
          toast.success('مقاله حذف شد.')
          load()
        }}
      />

      {/* گفت‌وگوی سه‌گامی ایجاد محتوا: گام ۱ انتخاب روش، گام ۲ انتخاب الگوی فعال، گام ۳ پیش‌نمایش و ایجاد پیش‌نویس مستقل */}
      <Dialog open={createOpen} onOpenChange={(o) => (o ? setCreateOpen(true) : closeCreateDialog())}>
        <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>ایجاد محتوا</DialogTitle>
            <DialogDescription>
              {createStep === 1
                ? 'چطور می‌خواهید شروع کنید؟ محتوای خالی بسازید یا از الگوهای آماده شروع کنید.'
                : createStep === 2
                  ? 'الگوی فعال مورد نظر را انتخاب کنید — خروجی همیشه یک پیش‌نویس مستقل است.'
                  : 'پیش‌نمایش الگوی انتخاب‌شده؛ پس از ایجاد، ویرایشگر باز می‌شود.'}
            </DialogDescription>
          </DialogHeader>

          {/* گام ۱: انتخاب روش شروع */}
          {createStep === 1 ? (
            <div className="grid gap-3 sm:grid-cols-2 py-1">
              <button
                type="button"
                onClick={() => {
                  closeCreateDialog()
                  navigate('/articles/new')
                }}
                className="flex min-h-28 flex-col items-start gap-2 rounded-2xl border bg-card p-4 text-start transition-colors hover:border-primary/50 hover:bg-accent/40"
                aria-label="شروع خالی — ایجاد مقاله خالی در ویرایشگر"
              >
                <span className="rounded-xl bg-muted p-2 text-foreground/80" aria-hidden>
                  <FilePlus2 className="h-5 w-5" />
                </span>
                <span className="font-semibold">شروع خالی</span>
                <span className="text-xs leading-5 text-muted-foreground">
                  مقاله خالی ایجاد می‌شود و همه فیلدها را خودتان در ویرایشگر تکمیل می‌کنید.
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateStep(2)
                  loadTemplates()
                }}
                className="flex min-h-28 flex-col items-start gap-2 rounded-2xl border bg-card p-4 text-start transition-colors hover:border-primary/50 hover:bg-accent/40"
                aria-label="ساخت با الگو — انتخاب از الگوهای آماده"
              >
                <span className="rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" aria-hidden>
                  <LayoutTemplate className="h-5 w-5" />
                </span>
                <span className="font-semibold">ساخت با الگو</span>
                <span className="text-xs leading-5 text-muted-foreground">
                  از الگوهای آماده تیم شروع کنید؛ متن، ساختار و چک‌لیست از قبل مهیاست.
                </span>
              </button>
            </div>
          ) : null}

          {/* گام ۲: انتخاب الگوی فعال */}
          {createStep === 2 ? (
            <div className="space-y-3 py-1">
              <Button variant="ghost" size="sm" onClick={() => setCreateStep(1)} className="gap-1.5">
                <ArrowRight className="h-4 w-4" aria-hidden />
                بازگشت
              </Button>

              {tplsLoading ? (
                <LoadingSpinner label="در حال دریافت الگوها…" />
              ) : tplsError ? (
                <ErrorState message={tplsError} onRetry={loadTemplates} />
              ) : tpls.length === 0 ? (
                <EmptyState
                  compact
                  title="الگوی فعالی وجود ندارد"
                  description="الگوها در بخش «الگوهای آماده» ساخته و فعال می‌شوند."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        closeCreateDialog()
                        navigate('/articles/new')
                      }}
                    >
                      شروع خالی
                    </Button>
                  }
                />
              ) : (
                <>
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {toFa(tpls.length)} الگوی فعال
                  </p>
                  <div className="max-h-[46vh] space-y-2 overflow-y-auto">
                    {tpls.map((t) => {
                      const meta = TPL_TYPE_META[t.type] ?? TPL_TYPE_META.ARTICLE
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSelectedTpl(t)
                            setCreateStep(3)
                          }}
                          className="w-full rounded-xl border bg-card p-3 text-start transition-colors hover:border-primary/50 hover:bg-accent/40"
                          aria-label={`انتخاب الگوی ${t.name}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium" dir="auto">
                              {t.name}
                            </span>
                            <Badge variant="outline" className={`text-[11px] font-normal ${meta.colorClass} ${meta.bgClass}`}>
                              {meta.label}
                            </Badge>
                            <Badge variant="outline" className="text-[11px] font-normal">
                              نسخه {toFa(t.version)}
                            </Badge>
                            <ChevronLeft className="ms-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          </div>
                          {t.description ? (
                            <p className="mt-1.5 text-xs leading-5 text-muted-foreground line-clamp-2" dir="auto">
                              {t.description}
                            </p>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/* گام ۳: پیش‌نمایش الگو و ایجاد پیش‌نویس مستقل */}
          {createStep === 3 && selectedTpl ? (
            <>
              <div className="space-y-4 py-1">
                <Button variant="ghost" size="sm" onClick={() => setCreateStep(2)} className="gap-1.5">
                  <ArrowRight className="h-4 w-4" aria-hidden />
                  بازگشت به الگوها
                </Button>

                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold" dir="auto">
                    {selectedTpl.name}
                  </h3>
                  <Badge
                    variant="outline"
                    className={`text-[11px] font-normal ${(TPL_TYPE_META[selectedTpl.type] ?? TPL_TYPE_META.ARTICLE).colorClass} ${(TPL_TYPE_META[selectedTpl.type] ?? TPL_TYPE_META.ARTICLE).bgClass}`}
                  >
                    {(TPL_TYPE_META[selectedTpl.type] ?? TPL_TYPE_META.ARTICLE).label}
                  </Badge>
                  <Badge variant="outline" className="text-[11px] font-normal">
                    نسخه {toFa(selectedTpl.version)}
                  </Badge>
                </div>

                {selectedTpl.description ? (
                  <p className="text-sm leading-6 text-muted-foreground" dir="auto">
                    {selectedTpl.description}
                  </p>
                ) : null}

                {selectedTpl.titleTemplate ? (
                  <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <p className="mb-0.5 text-[11px] text-muted-foreground">عنوان پیش‌فرض</p>
                    <p dir="auto" className="break-words text-sm leading-6">
                      {selectedTpl.titleTemplate}
                    </p>
                  </div>
                ) : null}

                {selectedTpl.excerptTemplate ? (
                  <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <p className="mb-0.5 text-[11px] text-muted-foreground">خلاصه پیش‌فرض</p>
                    <p dir="auto" className="line-clamp-3 text-sm leading-6">
                      {selectedTpl.excerptTemplate}
                    </p>
                  </div>
                ) : null}

                {selectedTpl.guideText ? (
                  <div className="max-h-36 overflow-y-auto rounded-xl border px-3 py-2">
                    <p className="mb-1 text-[11px] text-muted-foreground">راهنمای استفاده</p>
                    <p dir="auto" className="whitespace-pre-wrap text-sm leading-6">
                      {selectedTpl.guideText}
                    </p>
                  </div>
                ) : null}

                {/* بلوک‌ها و فیلدهای الگو */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">بلوک‌ها و فیلدها</p>
                  {tplStructureOf(selectedTpl).length > 0 ? (
                    <ul className="space-y-1.5">
                      {tplStructureOf(selectedTpl).map((r, i) => {
                        const kind = TPL_KIND_META[r.kind] ?? TPL_KIND_META.FIELD
                        return (
                          <li key={r.key || i} className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="outline" className={`text-[11px] font-normal ${kind.colorClass} ${kind.bgClass}`}>
                              {kind.label}
                            </Badge>
                            <span className="font-medium" dir="auto">
                              {r.label}
                            </span>
                            {r.required ? (
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                الزامی
                              </Badge>
                            ) : null}
                            {r.guide ? (
                              <span className="text-xs text-muted-foreground" dir="auto">
                                {r.guide}
                              </span>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">ساختار مشخصی برای این الگو ثبت نشده است.</p>
                  )}
                </div>

                {/* چک‌لیست تکمیل */}
                {tplChecklistOf(selectedTpl).length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">چک‌لیست تکمیل</p>
                    <ol className="space-y-1">
                      {tplChecklistOf(selectedTpl).map((item, i) => (
                        <li key={i} className="flex gap-1.5 text-sm">
                          <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">{toFa(i + 1)}.</span>
                          <span dir="auto">{item}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    خروجی همیشه یک پیش‌نویس مستقل است؛ تأییدها منتقل نمی‌شود و تاریخ انتشار خالی است.
                  </AlertDescription>
                </Alert>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeCreateDialog} disabled={creatingFromTpl}>
                  انصراف
                </Button>
                <Button onClick={createFromTemplate} disabled={creatingFromTpl}>
                  {creatingFromTpl ? (
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <FilePlus2 className="h-4 w-4" />
                  )}
                  ایجاد پیش‌نویس مستقل
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* تأیید حذف گروهی */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="حذف گروهی مقالات"
        description={`حذف ${toFa(selected.length)} مقاله انتخاب‌شده. این عمل بازگشت‌پذیر نیست.`}
        confirmLabel="حذف موارد انتخاب‌شده"
        destructive
        loading={bulkBusy}
        onConfirm={bulkDelete}
      />
    </div>
  )
}
