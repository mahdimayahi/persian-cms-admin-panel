'use client'

import * as React from 'react'
import { Archive, CheckCheck, ClipboardList, Download, MoreHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable, type Column } from '@/components/shared/data-table'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSpinner,
  PageHeader,
  SearchInput,
  StatusBadge,
} from '@/components/shared/ui-bits'
import { apiDelete, apiGet, apiPut, type PagedResponse } from '@/lib/client/api'
import { downloadCsv, faDateTime, timeAgo, toFa } from '@/lib/client/format'
import { FORM_STATUSES, formStatusInfo } from '@/lib/constants'
import { useCan } from '@/store/app-store'

type Submission = {
  id: string
  formName: string
  name: string
  email: string
  subject: string
  message: string
  status: string
  createdAt: string
}

type FormsResponse = PagedResponse<Submission> & { formNames: string[] }

const ALL = '__ALL__'
const PAGE_SIZE_FOR_EXPORT = 100

export function FormsView() {
  const can = useCan()
  const canManage = can('forms.manage')

  // ─── داده فهرست ─────────────────────────────────────────────────
  const [list, setList] = React.useState<FormsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // ─── فیلترها و صفحه‌بندی ────────────────────────────────────────
  const [qInput, setQInput] = React.useState('')
  const [q, setQ] = React.useState('')
  const [tab, setTab] = React.useState('ALL') // ALL | NEW | READ | ARCHIVED
  const [formName, setFormName] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)

  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [qInput])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (q) params.set('q', q)
      if (tab !== 'ALL') params.set('status', tab)
      if (formName) params.set('formName', formName)
      const res = await apiGet<FormsResponse>(`/api/form-submissions?${params.toString()}`)
      setList(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت پاسخ‌های فرم')
    } finally {
      setLoading(false)
    }
  }, [q, tab, formName, page, pageSize])

  React.useEffect(() => {
    load()
  }, [load])

  // ─── انتخاب گروهی ───────────────────────────────────────────────
  const [selected, setSelected] = React.useState<string[]>([])
  const [bulkBusy, setBulkBusy] = React.useState(false)

  // ─── تغییر وضعیت یک پاسخ ────────────────────────────────────────
  const updateStatus = async (id: string, status: string, silent = false) => {
    try {
      await apiPut(`/api/form-submissions/${id}`, { status })
      if (!silent) {
        const label = FORM_STATUSES.find((s) => s.value === status)?.label ?? status
        toast.success(`وضعیت پاسخ به «${label}» تغییر کرد.`)
      }
      load()
      return true
    } catch (err) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'خطا در تغییر وضعیت پاسخ')
      return false
    }
  }

  // ─── گفت‌وگوی جزئیات ────────────────────────────────────────────
  const [detail, setDetail] = React.useState<Submission | null>(null)
  const [detailBusy, setDetailBusy] = React.useState(false)

  const openDetail = async (s: Submission) => {
    setDetail(s.status === 'NEW' ? { ...s, status: 'READ' } : s)
    // باز کردن پاسخ جدید به‌طور خودکار آن را خوانده‌شده می‌کند
    if (s.status === 'NEW' && canManage) {
      await updateStatus(s.id, 'READ', true)
    }
  }

  const [confirmDelete, setConfirmDelete] = React.useState<Submission | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)

  const submitDelete = async (target: Submission, after: () => void) => {
    setDeleteBusy(true)
    try {
      await apiDelete(`/api/form-submissions/${target.id}`)
      toast.success('پاسخ فرم حذف شد.')
      setConfirmDelete(null)
      after()
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در حذف پاسخ فرم')
    } finally {
      setDeleteBusy(false)
    }
  }

  // ─── عملیات گروهی (ترتیبی با شمارش نتیجه) ───────────────────────
  const bulkArchive = async () => {
    if (selected.length === 0) return
    setBulkBusy(true)
    let ok = 0
    let fail = 0
    for (const id of selected) {
      try {
        await apiPut(`/api/form-submissions/${id}`, { status: 'ARCHIVED' })
        ok++
      } catch {
        fail++
      }
    }
    setBulkBusy(false)
    setSelected([])
    if (fail === 0) toast.success(`${toFa(ok)} پاسخ بایگانی شد.`)
    else toast.warning(`${toFa(ok)} پاسخ بایگانی و ${toFa(fail)} مورد ناموفق بود.`)
    load()
  }

  const bulkDelete = async () => {
    if (selected.length === 0) return
    setBulkBusy(true)
    let ok = 0
    let fail = 0
    for (const id of selected) {
      try {
        await apiDelete(`/api/form-submissions/${id}`)
        ok++
      } catch {
        fail++
      }
    }
    setBulkBusy(false)
    setSelected([])
    if (fail === 0) toast.success(`${toFa(ok)} پاسخ حذف شد.`)
    else toast.warning(`${toFa(ok)} پاسخ حذف و ${toFa(fail)} مورد ناموفق بود.`)
    load()
  }

  // ─── خروجی CSV از همه صفحات ─────────────────────────────────────
  const [exporting, setExporting] = React.useState(false)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const baseParams = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE_FOR_EXPORT) })
      if (q) baseParams.set('q', q)
      if (tab !== 'ALL') baseParams.set('status', tab)
      if (formName) baseParams.set('formName', formName)

      const first = await apiGet<FormsResponse>(`/api/form-submissions?${baseParams.toString()}`)
      const rows: Submission[] = [...first.items]
      const totalPages = Math.ceil(first.total / PAGE_SIZE_FOR_EXPORT)
      for (let p = 2; p <= totalPages; p++) {
        const params = new URLSearchParams(baseParams)
        params.set('page', String(p))
        const res = await apiGet<FormsResponse>(`/api/form-submissions?${params.toString()}`)
        rows.push(...res.items)
      }

      if (rows.length === 0) {
        toast.info('پاسخی برای خروجی گرفتن وجود ندارد.')
        return
      }

      downloadCsv(
        'form-submissions.csv',
        ['نام', 'ایمیل', 'موضوع', 'فرم', 'وضعیت', 'تاریخ'],
        rows.map((r) => [r.name, r.email, r.subject, r.formName, formStatusInfo(r.status).label, faDateTime(r.createdAt)]),
      )
      toast.success(`خروجی ${toFa(rows.length)} پاسخ فرم آماده شد.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در تهیه خروجی CSV')
    } finally {
      setExporting(false)
    }
  }

  // ─── ستون‌های جدول ──────────────────────────────────────────────
  const columns: Column<Submission>[] = [
    {
      key: 'sender',
      header: 'ارسال‌کننده',
      render: (s) => (
        <button
          type="button"
          onClick={() => openDetail(s)}
          className="text-start min-w-0 rounded focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`مشاهده جزئیات پاسخ ${s.name}`}
        >
          <p className="text-sm font-medium line-clamp-1 hover:underline">{s.name}</p>
          <p className="text-xs text-muted-foreground truncate" dir="ltr">
            {s.email}
          </p>
        </button>
      ),
    },
    {
      key: 'subject',
      header: 'موضوع',
      render: (s) => (
        <button
          type="button"
          onClick={() => openDetail(s)}
          className="text-start rounded focus-visible:ring-2 focus-visible:ring-ring max-w-56"
          aria-label={`مشاهده جزئیات پاسخ ${s.subject}`}
        >
          <span className="text-sm font-medium line-clamp-1 hover:underline">{s.subject}</span>
        </button>
      ),
    },
    {
      key: 'form',
      header: 'فرم',
      render: (s) => <Badge variant="outline">{s.formName}</Badge>,
    },
    {
      key: 'date',
      header: 'تاریخ',
      render: (s) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">{timeAgo(s.createdAt)}</span>
      ),
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (s) => {
        const info = formStatusInfo(s.status)
        return <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
      },
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: '',
      headerClassName: 'w-12',
      render: (s) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`عملیات پاسخ ${s.subject}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {s.status !== 'READ' ? (
              <DropdownMenuItem onSelect={() => updateStatus(s.id, 'READ')}>
                <CheckCheck className="me-2 h-4 w-4" />
                علامت‌گذاری به‌عنوان خوانده‌شده
              </DropdownMenuItem>
            ) : null}
            {s.status !== 'ARCHIVED' ? (
              <DropdownMenuItem onSelect={() => updateStatus(s.id, 'ARCHIVED')}>
                <Archive className="me-2 h-4 w-4" />
                بایگانی
              </DropdownMenuItem>
            ) : null}
            {s.status === 'READ' ? (
              <DropdownMenuItem onSelect={() => updateStatus(s.id, 'NEW')}>
                <ClipboardList className="me-2 h-4 w-4" />
                علامت‌گذاری به‌عنوان جدید
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmDelete(s)}
            >
              <Trash2 className="me-2 h-4 w-4" />
              حذف
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    })
  }

  if (loading && !list) return <LoadingSpinner label="در حال بارگذاری پاسخ‌ها…" />
  if (error && !list) return <ErrorState message={error} onRetry={load} />

  return (
    <div>
      <PageHeader
        title="پاسخ‌های دریافتی"
        description="پیام‌های ارسالی کاربران از طریق فرم‌های سایت"
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={exporting} className="gap-1.5">
            <Download className={`h-4 w-4 ${exporting ? 'animate-pulse' : ''}`} />
            {exporting ? 'در حال آماده‌سازی…' : 'خروجی CSV'}
          </Button>
        }
      />

      {/* تب‌های وضعیت */}
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
          setSelected([])
        }}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="ALL">همه</TabsTrigger>
          <TabsTrigger value="NEW">جدید</TabsTrigger>
          <TabsTrigger value="READ">خوانده‌شده</TabsTrigger>
          <TabsTrigger value="ARCHIVED">بایگانی</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* نوار فیلتر */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <SearchInput value={qInput} onChange={setQInput} placeholder="جست‌وجوی نام، ایمیل یا موضوع…" className="sm:max-w-xs" />
        <Select
          value={formName || ALL}
          onValueChange={(v) => {
            setFormName(v === ALL ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label="فیلتر فرم">
            <SelectValue placeholder="فرم" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>همه فرم‌ها</SelectItem>
            {(list?.formNames ?? []).map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={list?.items ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        error={error && list ? <ErrorState message={error} onRetry={load} /> : undefined}
        emptyState={
          <EmptyState
            compact
            title="پاسخی یافت نشد"
            description="پاسخ‌های ارسالی از فرم‌های سایت در اینجا نمایش داده می‌شود."
            icon={<ClipboardList className="h-6 w-6" />}
          />
        }
        page={page}
        pageSize={pageSize}
        total={list?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        itemLabel="پاسخ"
        selectable={canManage}
        selected={selected}
        onSelectedChange={setSelected}
        bulkBar={
          canManage && selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 mb-2">
              <span className="text-sm font-medium">{toFa(selected.length)} مورد انتخاب‌شده</span>
              <Separator orientation="vertical" className="h-5" />
              <Button size="sm" variant="outline" onClick={bulkArchive} disabled={bulkBusy}>
                <Archive className="h-4 w-4" />
                بایگانی گروهی
              </Button>
              <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkBusy}>
                <Trash2 className="h-4 w-4" />
                حذف گروهی
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])} disabled={bulkBusy}>
                لغو انتخاب
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* گفت‌وگوی جزئیات پاسخ */}
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="line-clamp-2">{detail.subject}</DialogTitle>
                <DialogDescription>
                  ارسال‌شده از فرم «{detail.formName}» · {faDateTime(detail.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium">{detail.name}</span>
                  <span className="text-muted-foreground" dir="ltr">
                    {detail.email}
                  </span>
                  {(() => {
                    const info = formStatusInfo(detail.status)
                    return <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
                  })()}
                </div>
                <Separator />
                <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm whitespace-pre-wrap leading-6">{detail.message}</p>
                </div>
              </div>
              {canManage ? (
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={detailBusy || detail.status === 'READ'}
                    onClick={async () => {
                      setDetailBusy(true)
                      const ok = await updateStatus(detail.id, 'READ')
                      setDetailBusy(false)
                      if (ok) setDetail((d) => (d ? { ...d, status: 'READ' } : d))
                    }}
                  >
                    <CheckCheck className="h-4 w-4" />
                    علامت‌گذاری به‌عنوان خوانده‌شده
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={detailBusy || detail.status === 'ARCHIVED'}
                    onClick={async () => {
                      setDetailBusy(true)
                      const ok = await updateStatus(detail.id, 'ARCHIVED')
                      setDetailBusy(false)
                      if (ok) setDetail((d) => (d ? { ...d, status: 'ARCHIVED' } : d))
                    }}
                  >
                    <Archive className="h-4 w-4" />
                    بایگانی
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={detailBusy}
                    onClick={() => {
                      setDetail(null)
                      setConfirmDelete(detail)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* تأیید حذف پاسخ */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title="حذف پاسخ فرم"
        description={
          confirmDelete
            ? `آیا از حذف پاسخ با موضوع «${confirmDelete.subject}» مطمئن هستید؟ این عملیات بازگشت‌پذیر نیست.`
            : undefined
        }
        confirmLabel="حذف"
        destructive
        loading={deleteBusy}
        onConfirm={() => {
          if (confirmDelete) submitDelete(confirmDelete, () => setDetail(null))
        }}
      />
    </div>
  )
}
