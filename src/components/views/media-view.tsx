'use client'

import * as React from 'react'
import { FileText, ExternalLink, Images, Loader2, Search, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader, ConfirmDialog, EmptyState, ErrorState, Pagination } from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiPut, apiDelete, ApiError, type PagedResponse } from '@/lib/client/api'
import { toFa, faBytes, faDate, faDateTime } from '@/lib/client/format'
import { useAppStore, useCan } from '@/store/app-store'
import { mediaUrl, type MediaItem } from '@/components/shared/media-picker'
import { MAX_UPLOAD_SIZE, ALLOWED_MIME_TYPES } from '@/lib/constants'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 300

function useDebouncedValue<T>(value: T, delay = DEBOUNCE_MS): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return v
}

type MimeFilter = 'all' | 'image' | 'pdf'

const MIME_FILTERS: { value: MimeFilter; label: string; param: string }[] = [
  { value: 'all', label: 'همه', param: '' },
  { value: 'image', label: 'تصاویر', param: 'image' },
  { value: 'pdf', label: 'اسناد PDF', param: 'application/pdf' },
]

export function MediaView() {
  const user = useAppStore((s) => s.user)
  const can = useCan()
  const canUpload = can('media.upload')

  const [items, setItems] = React.useState<MediaItem[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(12)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // فیلترها
  const [q, setQ] = React.useState('')
  const debouncedQ = useDebouncedValue(q)
  const [mimeFilter, setMimeFilter] = React.useState<MimeFilter>('all')

  // بارگذاری
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)

  // گفت‌وگوی جزئیات
  const [details, setDetails] = React.useState<MediaItem | null>(null)
  const [altText, setAltText] = React.useState('')
  const [savingAlt, setSavingAlt] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [forceInfo, setForceInfo] = React.useState<{ count: number } | null>(null)

  const seqRef = React.useRef(0)

  const buildQuery = React.useCallback(
    (p: number, ps: number) => {
      const sp = new URLSearchParams()
      if (debouncedQ.trim()) sp.set('q', debouncedQ.trim())
      const mime = MIME_FILTERS.find((f) => f.value === mimeFilter)?.param
      if (mime) sp.set('mimeType', mime)
      sp.set('page', String(p))
      sp.set('pageSize', String(ps))
      return sp.toString()
    },
    [debouncedQ, mimeFilter]
  )

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<PagedResponse<MediaItem>>(`/api/media?${buildQuery(page, pageSize)}`)
      if (seq !== seqRef.current) return
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : 'خطا در دریافت فایل‌ها')
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [buildQuery, page, pageSize])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    setPage(1)
  }, [debouncedQ])

  // ─── بارگذاری فایل ─────────────────────────────────────────────
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    const oversize = list.filter((f) => f.size > MAX_UPLOAD_SIZE)
    if (oversize.length > 0) {
      toast.error(`حجم «${oversize[0].name}» بیش از ۵ مگابایت است.`)
      return
    }
    setUploading(true)
    let okCount = 0
    let failCount = 0
    const errors: { item: string; reason: string }[] = []
    for (const file of list) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        await apiPost('/api/media', fd)
        okCount++
      } catch (e) {
        failCount++
        const reason = e instanceof Error ? e.message : `بارگذاری «${file.name}» ناموفق بود.`
        errors.push({ item: file.name, reason })
        toast.error(reason)
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''

    // ثبت عملیات در مرکز عملیات (وضعیت، نتیجه و خطاهای قابل‌فهم)
    if (list.length > 1 || failCount > 0) {
      const status = failCount === 0 ? 'SUCCESS' : okCount === 0 ? 'FAILED' : 'PARTIAL'
      apiPost('/api/operations', {
        type: 'MEDIA_UPLOAD',
        title: `بارگذاری ${list.length} فایل رسانه`,
        status,
        totalItems: list.length,
        doneItems: okCount,
        failedItems: failCount,
        resultSummary: `${okCount} فایل بارگذاری شد${failCount ? `؛ ${failCount} فایل ناموفق بود` : ''}.`,
        errors,
      }).catch(() => undefined)
    }

    if (okCount > 0) {
      toast.success(`${toFa(okCount)} فایل با موفقیت بارگذاری شد.`)
      setPage(1)
      load()
    }
  }

  // ─── جزئیات فایل ───────────────────────────────────────────────
  const openDetails = (m: MediaItem) => {
    setDetails(m)
    setAltText(m.altText ?? '')
    setForceInfo(null)
    setDeleteOpen(false)
  }

  const canManageItem = (m: MediaItem) =>
    can('media.delete.any') || (!!user && m.uploadedBy?.id === user.id)

  const saveAlt = async () => {
    if (!details) return
    setSavingAlt(true)
    try {
      const updated = await apiPut<MediaItem>(`/api/media/${details.id}`, { altText })
      setDetails(updated)
      toast.success('متن جایگزین ذخیره شد.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ذخیره متن جایگزین ناموفق بود.')
    } finally {
      setSavingAlt(false)
    }
  }

  const doDelete = async (force = false) => {
    if (!details) return
    setDeleting(true)
    try {
      await apiDelete(`/api/media/${details.id}${force ? '?force=true' : ''}`)
      toast.success('فایل حذف شد.')
      setDetails(null)
      setDeleteOpen(false)
      setForceInfo(null)
      load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const usedBy = (e.data as { usedBy?: number } | undefined)?.usedBy ?? 0
        setForceInfo({ count: usedBy })
      } else {
        toast.error(e instanceof Error ? e.message : 'حذف فایل ناموفق بود.')
      }
    } finally {
      setDeleting(false)
    }
  }

  const isImage = (m: MediaItem) => m.mimeType.startsWith('image/')

  return (
    <div>
      <PageHeader
        title="کتابخانه فایل‌ها"
        description="مدیریت تصاویر و اسناد استفاده‌شده در محتوا"
        icon={<Images className="h-5 w-5" />}
        actions={
          <>
            <Select value={mimeFilter} onValueChange={(v) => { setMimeFilter(v as MimeFilter); setPage(1) }}>
              <SelectTrigger className="w-36" aria-label="فیلتر نوع فایل">
                <SelectValue placeholder="نوع فایل" />
              </SelectTrigger>
              <SelectContent>
                {MIME_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canUpload ? (
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1.5">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? 'در حال بارگذاری…' : 'بارگذاری فایل'}
              </Button>
            ) : null}
          </>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        multiple
        accept={ALLOWED_MIME_TYPES.join(',')}
        onChange={(e) => handleFiles(e.target.files)}
        aria-hidden
        tabIndex={-1}
      />

      <div className="mb-4 sm:max-w-xs">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جست‌وجوی نام فایل یا متن جایگزین…"
            className="ps-8 pe-8 bg-background"
            aria-label="جست‌وجو در کتابخانه فایل‌ها"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm"
              aria-label="پاک‌کردن جست‌وجو"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {/* ناحیه رهاسازی فایل (کشیدن و رها کردن) */}
      {canUpload ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFiles(e.dataTransfer.files)
          }}
          className={cn(
            'mb-4 rounded-lg border-2 border-dashed p-4 text-center text-sm text-muted-foreground transition',
            dragOver ? 'border-primary bg-primary/5 text-foreground' : 'border-border'
          )}
        >
          فایل‌ها را برای بارگذاری اینجا رها کنید (PNG، JPEG، WebP، GIF، PDF — حداکثر ۵ مگابایت)
        </div>
      ) : null}

      {/* شبکه فایل‌ها */}
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border overflow-hidden">
              <Skeleton className="aspect-video rounded-none" />
              <div className="p-3 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="فایلی یافت نشد"
          description={canUpload ? 'فایل جدیدی بارگذاری کنید یا عبارت دیگری جست‌وجو کنید.' : 'عبارت دیگری جست‌وجو کنید.'}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => openDetails(m)}
              className="group text-start rounded-lg border overflow-hidden hover:ring-2 hover:ring-primary/50 transition focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`جزئیات فایل ${m.originalName}`}
            >
              <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                {isImage(m) ? (
                  <img
                    src={mediaUrl(m.id)}
                    alt={m.altText || m.originalName}
                    className="h-full w-full object-cover group-hover:scale-105 transition"
                    loading="lazy"
                  />
                ) : (
                  <FileText className="h-10 w-10 text-muted-foreground" aria-hidden />
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-medium truncate" title={m.originalName}>
                  {m.originalName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {faBytes(m.size)} · {faDate(m.createdAt)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {!error && !loading && total > 0 ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s)
            setPage(1)
          }}
          itemLabel="فایل"
        />
      ) : null}

      {/* گفت‌وگوی جزئیات فایل */}
      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="line-clamp-1">{details?.originalName}</DialogTitle>
            <DialogDescription>مشخصات و مدیریت فایل انتخاب‌شده</DialogDescription>
          </DialogHeader>

          {details ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 flex items-center justify-center overflow-hidden min-h-48 max-h-72">
                {isImage(details) ? (
                  <img
                    src={mediaUrl(details.id)}
                    alt={details.altText || details.originalName}
                    className="max-h-72 w-full object-contain"
                  />
                ) : (
                  <FileText className="h-16 w-16 text-muted-foreground" aria-hidden />
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">نوع فایل:</dt>
                <dd dir="ltr" className="ltr-inline text-xs">
                  {details.mimeType}
                </dd>
                <dt className="text-muted-foreground">ابعاد:</dt>
                <dd className="tabular-nums">
                  {details.width && details.height ? `${toFa(details.width)} × ${toFa(details.height)}` : '—'}
                </dd>
                <dt className="text-muted-foreground">حجم:</dt>
                <dd>{faBytes(details.size)}</dd>
                <dt className="text-muted-foreground">بارگذاری‌کننده:</dt>
                <dd>{details.uploadedBy?.name ?? '—'}</dd>
                <dt className="text-muted-foreground">تاریخ بارگذاری:</dt>
                <dd>{faDateTime(details.createdAt)}</dd>
              </dl>

              {canManageItem(details) ? (
                <div className="space-y-1.5">
                  <Label htmlFor="media-alt">متن جایگزین (Alt)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="media-alt"
                      value={altText}
                      onChange={(e) => setAltText(e.target.value)}
                      placeholder="توضیح تصویر برای دسترس‌پذیری و سئو…"
                      maxLength={300}
                    />
                    <Button onClick={saveAlt} disabled={savingAlt} className="shrink-0">
                      {savingAlt ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      ذخیره
                    </Button>
                  </div>
                </div>
              ) : null}

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" asChild>
                  <a href={mediaUrl(details.id)} target="_blank" rel="noreferrer" className="gap-1.5">
                    <ExternalLink className="h-4 w-4" />
                    نمایش فایل
                  </a>
                </Button>
                {can('media.delete.any') ||
                (can('media.delete.own') && !!user && details.uploadedBy?.id === user.id) ? (
                  <Button variant="destructive" onClick={() => setDeleteOpen(true)} className="gap-1.5">
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                ) : null}
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* تأیید حذف (با پشتیبانی حذف اجباری) */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o)
          if (!o) setForceInfo(null)
        }}
        title={forceInfo ? 'فایل در حال استفاده است' : 'حذف فایل'}
        description={
          forceInfo
            ? `این فایل تصویر شاخص ${toFa(forceInfo.count)} مقاله است. با حذف اجباری، تصویر از مقالات مربوطه حذف خواهد شد.`
            : `آیا از حذف «${details?.originalName ?? ''}» مطمئن هستید؟ این عمل بازگشت‌پذیر نیست.`
        }
        confirmLabel={forceInfo ? 'حذف اجباری' : 'حذف فایل'}
        destructive
        loading={deleting}
        onConfirm={() => doDelete(!!forceInfo)}
      />
    </div>
  )
}
