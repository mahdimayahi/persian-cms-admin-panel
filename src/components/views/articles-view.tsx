'use client'

import * as React from 'react'
import { Download, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { DataTable, type Column } from '@/components/shared/data-table'
import {
  PageHeader,
  StatusBadge,
  SearchInput,
  ConfirmDialog,
  EmptyState,
  ErrorState,
} from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiDelete, type PagedResponse } from '@/lib/client/api'
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
}

type CategoryLite = { id: string; name: string }

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

  // حذف تک‌موردی
  const [deleteTarget, setDeleteTarget] = React.useState<ArticleRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // خروجی CSV
  const [exporting, setExporting] = React.useState(false)

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
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'انجام عملیات ناموفق بود.')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/articles/${deleteTarget.id}`)
      toast.success('مقاله حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف مقاله ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  // ─── عملیات گروهی ─────────────────────────────────────────────
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
                    onClick={() => setDeleteTarget(row)}
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
              <Button size="sm" onClick={() => runBulkTransition('PUBLISH')} disabled={bulkBusy}>
                انتشار
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
        actions={
          <>
            {can('articles.view') ? (
              <Button variant="outline" onClick={exportCsv} disabled={exporting} className="gap-1.5">
                <Download className="h-4 w-4" />
                {exporting ? 'در حال ساخت خروجی…' : 'خروجی CSV'}
              </Button>
            ) : null}
            {can('articles.create') ? (
              <Button onClick={() => navigate('/articles/new')} className="gap-1.5">
                <Plus className="h-4 w-4" />
                مقاله جدید
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

      {/* تأیید حذف تک‌موردی */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف مقاله"
        description={`آیا از حذف «${deleteTarget?.title ?? ''}» مطمئن هستید؟ نسخه‌ها و دیدگاه‌های آن نیز حذف می‌شوند و این عمل بازگشت‌پذیر نیست.`}
        confirmLabel="حذف مقاله"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />

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
