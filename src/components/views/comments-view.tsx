'use client'

import * as React from 'react'
import { Check, MessagesSquare, MoreHorizontal, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiGet, apiPut, apiDelete, type PagedResponse } from '@/lib/client/api'
import { timeAgo, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { commentStatusInfo } from '@/lib/constants'
import { navigate } from '@/hooks/use-hash-route'

type CommentRow = {
  id: string
  articleId: string
  authorName: string
  authorEmail: string
  content: string
  status: string
  createdAt: string
  article: { id: string; title: string; slug: string } | null
}

const DEBOUNCE_MS = 300

function useDebouncedValue<T>(value: T, delay = DEBOUNCE_MS): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return v
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'all', label: 'همه' },
  { value: 'PENDING', label: 'در انتظار بررسی' },
  { value: 'APPROVED', label: 'تأییدشده' },
  { value: 'REJECTED', label: 'ردشده' },
]

export function CommentsView() {
  const can = useCan()
  const canModerate = can('comments.moderate')

  const [rows, setRows] = React.useState<CommentRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // فیلترها
  const [q, setQ] = React.useState('')
  const debouncedQ = useDebouncedValue(q)
  const [status, setStatus] = React.useState('all')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)

  // انتخاب گروهی و عملیات
  const [selected, setSelected] = React.useState<string[]>([])
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<CommentRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const seqRef = React.useRef(0)

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (debouncedQ.trim()) sp.set('q', debouncedQ.trim())
      if (status !== 'all') sp.set('status', status)
      sp.set('page', String(page))
      sp.set('pageSize', String(pageSize))
      const res = await apiGet<PagedResponse<CommentRow>>(`/api/comments?${sp.toString()}`)
      if (seq !== seqRef.current) return
      setRows(res.items)
      setTotal(res.total)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : 'خطا در دریافت دیدگاه‌ها')
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [debouncedQ, status, page, pageSize])

  React.useEffect(() => {
    load()
  }, [load])

  // بازگشت به صفحه اول هنگام تغییر جست‌وجو
  React.useEffect(() => {
    setPage(1)
  }, [debouncedQ])

  const moderate = async (id: string, next: 'APPROVED' | 'REJECTED') => {
    try {
      await apiPut(`/api/comments/${id}`, { status: next })
      toast.success(next === 'APPROVED' ? 'دیدگاه تأیید شد.' : 'دیدگاه رد شد.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تغییر وضعیت دیدگاه ناموفق بود.')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/comments/${deleteTarget.id}`)
      toast.success('دیدگاه حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف دیدگاه ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  // ─── عملیات گروهی ─────────────────────────────────────────────
  const runBulk = async (kind: 'APPROVED' | 'REJECTED' | 'DELETE') => {
    setBulkBusy(true)
    let okCount = 0
    let failCount = 0
    for (const id of selected) {
      try {
        if (kind === 'DELETE') await apiDelete(`/api/comments/${id}`)
        else await apiPut(`/api/comments/${id}`, { status: kind })
        okCount++
      } catch {
        failCount++
      }
    }
    setBulkBusy(false)
    setBulkDeleteOpen(false)
    setSelected([])
    load()
    const label = kind === 'APPROVED' ? 'تأیید گروهی' : kind === 'REJECTED' ? 'رد گروهی' : 'حذف گروهی'
    if (failCount === 0) toast.success(`${label}: ${toFa(okCount)} مورد موفق.`)
    else toast.warning(`${label}: ${toFa(okCount)} موفق، ${toFa(failCount)} ناموفق.`)
  }

  const columns: Column<CommentRow>[] = [
    {
      key: 'author',
      header: 'نویسنده',
      render: (c) => (
        <div className="min-w-0 max-w-[180px]">
          <p className="font-medium line-clamp-1">{c.authorName}</p>
          <p dir="ltr" className="ltr-inline text-xs text-muted-foreground truncate block max-w-full">
            {c.authorEmail}
          </p>
        </div>
      ),
    },
    {
      key: 'content',
      header: 'متن دیدگاه',
      render: (c) => <p className="text-sm line-clamp-2 max-w-md">{c.content}</p>,
    },
    {
      key: 'article',
      header: 'مقاله',
      render: (c) =>
        c.article ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 line-clamp-1 max-w-[200px]"
            onClick={() => navigate(`/articles/${c.article!.id}/edit`)}
            title={c.article.title}
          >
            {c.article.title}
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      key: 'date',
      header: 'تاریخ',
      render: (c) => <span className="text-sm whitespace-nowrap text-muted-foreground">{timeAgo(c.createdAt)}</span>,
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (c) => {
        const info = commentStatusInfo(c.status)
        return <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
      },
    },
    ...(canModerate
      ? [
          {
            key: 'actions',
            header: '',
            headerClassName: 'w-12',
            render: (c: CommentRow) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="عملیات دیدگاه">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {c.status !== 'APPROVED' ? (
                    <DropdownMenuItem onClick={() => moderate(c.id, 'APPROVED')} className="gap-2">
                      <Check className="h-4 w-4" />
                      تأیید
                    </DropdownMenuItem>
                  ) : null}
                  {c.status !== 'REJECTED' ? (
                    <DropdownMenuItem onClick={() => moderate(c.id, 'REJECTED')} className="gap-2">
                      <X className="h-4 w-4" />
                      رد
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() => setDeleteTarget(c)}
                    className="text-destructive focus:text-destructive gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          } satisfies Column<CommentRow>,
        ]
      : []),
  ]

  const bulkBar =
    canModerate && selected.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 mb-3">
        <Badge variant="secondary">{toFa(selected.length)} انتخاب‌شده</Badge>
        <span className="text-xs text-muted-foreground">عملیات روی موارد انتخاب‌شده در همین صفحه اعمال می‌شود.</span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => runBulk('APPROVED')} disabled={bulkBusy}>
            تأیید گروهی
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk('REJECTED')} disabled={bulkBusy}>
            رد گروهی
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)} disabled={bulkBusy}>
            حذف گروهی
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])} disabled={bulkBusy}>
            لغو انتخاب
          </Button>
        </div>
      </div>
    ) : null

  return (
    <div>
      <PageHeader title="دیدگاه‌ها" description="بازبینی و مدیریت دیدگاه‌های بازدیدکنندگان" icon={<MessagesSquare className="h-5 w-5" />} />

      {/* تب‌های وضعیت */}
      <Tabs
        value={status}
        onValueChange={(v) => {
          setStatus(v)
          setPage(1)
        }}
        className="mb-4"
      >
        <TabsList className="w-full sm:w-fit overflow-x-auto">
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mb-4 sm:max-w-xs">
        <SearchInput value={q} onChange={setQ} placeholder="جست‌وجو در متن یا نام نویسنده…" />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={loading}
        error={error ? <ErrorState message={error} onRetry={load} /> : null}
        emptyState={<EmptyState title="دیدگاهی یافت نشد" description="با تغییر فیلترها یا عبارت جست‌وجو دوباره تلاش کنید." compact />}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        itemLabel="دیدگاه"
        selectable={canModerate}
        selected={selected}
        onSelectedChange={setSelected}
        bulkBar={bulkBar}
      />

      {/* تأیید حذف تک‌موردی */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف دیدگاه"
        description="آیا از حذف این دیدگاه مطمئن هستید؟ این عمل بازگشت‌پذیر نیست."
        confirmLabel="حذف دیدگاه"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />

      {/* تأیید حذف گروهی */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="حذف گروهی دیدگاه‌ها"
        description={`حذف ${toFa(selected.length)} دیدگاه انتخاب‌شده. این عمل بازگشت‌پذیر نیست.`}
        confirmLabel="حذف موارد انتخاب‌شده"
        destructive
        loading={bulkBusy}
        onConfirm={() => runBulk('DELETE')}
      />
    </div>
  )
}
