'use client'

/**
 * مدیریت گزارش‌های پشتیبانی (مجوز users.manage) — فهرست با فیلتر وضعیت و جست‌وجو،
 * جزئیات کامل با اطلاعات تشخیصی پالایش‌شده، تصویر پیوست، عملیات مرتبط و ثبت پاسخ پشتیبان.
 */

import * as React from 'react'
import { Download, ExternalLink, LifeBuoy, Link2, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  EmptyState,
  ErrorState,
  LoadingSpinner,
  PageHeader,
  Pagination,
  SearchInput,
  StatusBadge,
} from '@/components/shared/ui-bits'
import { apiGet } from '@/lib/client/api'
import { faDateTime, timeAgo, toFa } from '@/lib/client/format'
import {
  SUPPORT_STATUSES,
  normalizeSupportStatus,
  supportStatusInfo,
} from '@/lib/client/support-status'
import { useCan } from '@/store/app-store'
import { navigate } from '@/hooks/use-hash-route'

/** کمک‌تابع محلی برای endpointهایی که فقط PATCH را می‌پذیرند
 * (کتابخانه api کلاینت متد PATCH ندارد) — با همان قرارداد خطای apiGet */
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

type Ticket = {
  id: string
  code: string
  userId: string | null
  userName: string
  userEmail: string
  subject: string
  expectation: string
  actual: string
  page: string
  section: string
  steps: string
  errorInfo: string
  operationId: string | null
  diagnostics: string
  screenshot: string | null
  screenshotMime: string | null
  userAgent: string
  status: string
  note: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  resolvedByName: string | null
}

type OperationInfo = {
  id: string
  type: string
  status: string
  resultSummary: string
  createdAt: string
  finishedAt: string | null
}

type TicketDetail = Ticket & { operation?: OperationInfo | null }

type Diagnostics = {
  time?: string
  appVersion?: string
  page?: string
  section?: string
  browser?: string
  errorCode?: string | null
  operationId?: string | null
}

const PAGE_SIZE = 20

/** برچسب نوع عملیات مرکز عملیات (مطابق operations-view) */
function opTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    BULK_PUBLISH_ARTICLES: 'انتشار گروهی مقالات',
    BULK_UNPUBLISH_ARTICLES: 'لغو انتشار گروهی مقالات',
    BUNDLE_PUBLISH: 'انتشار بسته',
    MEDIA_UPLOAD: 'بارگذاری رسانه',
    CSV_EXPORT: 'خروجی CSV',
    OTHER: 'سایر',
  }
  return labels[type] ?? type
}

/** برچسب وضعیت عملیات */
function opStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    QUEUED: 'در صف',
    RUNNING: 'در حال اجرا',
    SUCCESS: 'موفق',
    PARTIAL: 'ناقص',
    FAILED: 'ناموفق',
    CANCELLED: 'لغوشده',
  }
  return labels[status] ?? status
}

/** ردیف برچسب‌دار بخش جزئیات */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 py-2.5 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground sm:w-32 shrink-0">{label}</span>
      <div className="text-sm min-w-0 leading-6">{children}</div>
    </div>
  )
}

const Em = ({ children }: { children: React.ReactNode }) =>
  children ? <span className="whitespace-pre-line">{children}</span> : <span className="text-muted-foreground">—</span>

export function SupportView() {
  const can = useCan()
  const canManage = can('users.manage')

  const [items, setItems] = React.useState<Ticket[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState('all')
  const [qInput, setQInput] = React.useState('')
  const [q, setQ] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // جلوگیری از تداخل پاسخ‌های درخواست‌های همزمان
  const seqRef = React.useRef(0)

  // جست‌وجوی بی‌درنگ با تأخیر ۳۰۰ms
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      sp.set('page', String(page))
      sp.set('pageSize', String(PAGE_SIZE))
      if (status !== 'all') sp.set('status', status)
      if (q) sp.set('q', q)
      const res = await apiGet<{ items: Ticket[]; total: number; page: number; pageSize: number }>(
        `/api/support?${sp.toString()}`
      )
      if (seq !== seqRef.current) return
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      if (seq !== seqRef.current) return
      setError(e instanceof Error ? e.message : 'خطا در دریافت گزارش‌های پشتیبانی')
    } finally {
      if (seq === seqRef.current) {
        setLoading(false)
      }
    }
  }, [page, status, q])

  React.useEffect(() => {
    load()
  }, [load])

  // شمارش وضعیت‌ها از آیتم‌های صفحهٔ جاری — چیپ‌های آماری سبک
  const statusCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of items) {
      const s = normalizeSupportStatus(t.status)
      counts[s] = (counts[s] ?? 0) + 1
    }
    return counts
  }, [items])

  // ─── گفت‌وگوی جزئیات ─────────────────────────────────────────────
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<TicketDetail | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [detailRefresh, setDetailRefresh] = React.useState(0)

  const [note, setNote] = React.useState('')
  const [nextStatus, setNextStatus] = React.useState<string>('NEW')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!detailId) return
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    apiGet<TicketDetail>(`/api/support/${detailId}`)
      .then((res) => {
        if (cancelled) return
        setDetail(res)
        setNote(res.note ?? '')
        setNextStatus(normalizeSupportStatus(res.status))
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'خطا در دریافت جزئیات گزارش'
        setDetailError(msg)
        toast.error(msg)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailId, detailRefresh])

  const diagnostics = React.useMemo<Diagnostics | null>(() => {
    if (!detail?.diagnostics) return null
    try {
      const parsed = JSON.parse(detail.diagnostics) as Diagnostics
      return typeof parsed === 'object' && parsed !== null ? parsed : null
    } catch {
      return null
    }
  }, [detail])

  const saveResponse = async () => {
    if (!detail) return
    setSaving(true)
    try {
      await apiPatch<Ticket>(`/api/support/${detail.id}`, { status: nextStatus, note })
      toast.success(`پاسخ گزارش ${detail.code} ثبت شد.`)
      setDetailRefresh((n) => n + 1)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت پاسخ ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  const closeDetail = (open: boolean) => {
    if (!open) {
      setDetailId(null)
      setDetail(null)
      setDetailError(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="گزارش‌های پشتیبانی"
        description="پیگیری گزارش‌های مشکل کاربران با وضعیت و اطلاعات تشخیصی پالایش‌شده."
        icon={<LifeBuoy className="h-5 w-5" />}
      />

      {/* فیلترها */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={qInput}
          onChange={setQInput}
          placeholder="جستوجو در موضوع، کد یا نام کاربر…"
          className="flex-1 sm:max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger aria-label="فیلتر وضعیت گزارش‌ها" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همهٔ وضعیت‌ها</SelectItem>
            {SUPPORT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {supportStatusInfo(s).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void load()}
          aria-label="بازخوانی فهرست گزارش‌ها"
          title="بازخوانی"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* چیپ‌های آماری از صفحهٔ جاری */}
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="شمار وضعیت‌ها در صفحهٔ جاری">
          {SUPPORT_STATUSES.map((s) => {
            const n = statusCounts[s] ?? 0
            if (n === 0) return null
            const meta = supportStatusInfo(s)
            return (
              <StatusBadge
                key={s}
                label={`${meta.label} ${toFa(n)}`}
                colorClass={meta.colorClass}
                bgClass={meta.bgClass}
              />
            )
          })}
        </div>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading && items.length === 0 ? (
        <LoadingSpinner label="در حال بارگذاری گزارش‌های پشتیبانی…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="گزارشی یافت نشد"
          description={
            q || status !== 'all'
              ? 'با این فیلترها گزارشی پیدا نشد؛ جست‌وجو یا فیلتر را تغییر دهید.'
              : 'به‌محض ثبت گزارش جدید توسط کاربران، در همین‌جا با کد رهگیری نمایش داده می‌شود.'
          }
        />
      ) : (
        <>
          <div className="space-y-2.5">
            {items.map((t) => {
              const meta = supportStatusInfo(t.status)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDetailId(t.id)}
                  aria-label={`مشاهدهٔ جزئیات گزارش ${t.code}`}
                  className="w-full text-start rounded-2xl border bg-card p-4 space-y-2 shadow-xs hover:border-ring/50 hover:bg-accent/40 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono" dir="ltr">
                      {t.code}
                    </Badge>
                    <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                    <span className="text-sm font-medium">{t.userName}</span>
                    <span dir="ltr" className="text-xs text-muted-foreground truncate max-w-[200px] hidden sm:inline">
                      {t.userEmail}
                    </span>
                    {t.operationId ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-info"
                        title="متصل به مرکز عملیات"
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden />
                        عملیات
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground ms-auto whitespace-nowrap" title={faDateTime(t.createdAt)}>
                      {timeAgo(t.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm font-medium line-clamp-1">{t.subject}</p>
                  {t.section ? <p className="text-xs text-muted-foreground">بخش: {t.section}</p> : null}
                </button>
              )
            })}
          </div>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            itemLabel="گزارش"
          />
        </>
      )}

      {/* ─── گفت‌وگوی جزئیات گزارش ─────────────────────────────────── */}
      <Dialog open={detailId !== null} onOpenChange={closeDetail}>
        <DialogContent className="max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>گزارش</span>
              {detail ? (
                <Badge variant="secondary" className="font-mono" dir="ltr">
                  {detail.code}
                </Badge>
              ) : null}
              {detail ? (() => {
                const meta = supportStatusInfo(detail.status)
                return <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
              })() : null}
            </DialogTitle>
            <DialogDescription>جزئیات کامل گزارش، اطلاعات تشخیصی و ثبت پاسخ پشتیبان.</DialogDescription>
          </DialogHeader>

          {detailLoading && !detail ? (
            <LoadingSpinner label="در حال دریافت جزئیات گزارش…" />
          ) : detailError ? (
            <ErrorState message={detailError} onRetry={() => setDetailRefresh((n) => n + 1)} />
          ) : detail ? (
            <div className="space-y-4">
              {/* بخش‌های اصلی */}
              <div>
                <DetailRow label="موضوع">
                  <span className="font-medium">{detail.subject || '—'}</span>
                </DetailRow>
                <DetailRow label="انتظار">
                  <Em>{detail.expectation}</Em>
                </DetailRow>
                <DetailRow label="واقعیت">
                  <Em>{detail.actual}</Em>
                </DetailRow>
                <DetailRow label="مراحل بازتولید">
                  <Em>{detail.steps}</Em>
                </DetailRow>
                {detail.errorInfo ? (
                  <DetailRow label="خطا">
                    <pre
                      dir="ltr"
                      className="font-mono text-xs rounded-lg bg-muted/50 p-2 overflow-x-auto whitespace-pre-wrap break-words"
                    >
                      {detail.errorInfo}
                    </pre>
                  </DetailRow>
                ) : null}
                <DetailRow label="بخش">{detail.section || '—'}</DetailRow>
                <DetailRow label="صفحه">
                  <span className="font-mono text-xs" dir="ltr">{detail.page || '—'}</span>
                </DetailRow>
                <DetailRow label="کاربر">
                  <span className="flex flex-wrap items-center gap-2">
                    {detail.userName}
                    <span dir="ltr" className="text-xs text-muted-foreground">{detail.userEmail}</span>
                  </span>
                </DetailRow>
                <DetailRow label="زمان ثبت">
                  {faDateTime(detail.createdAt)}
                  <span className="text-xs text-muted-foreground"> ({timeAgo(detail.createdAt)})</span>
                </DetailRow>
                <DetailRow label="آخرین به‌روزرسانی">{faDateTime(detail.updatedAt)}</DetailRow>
                <DetailRow label="وضعیت">
                  {(() => {
                    const meta = supportStatusInfo(detail.status)
                    return <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                  })()}
                </DetailRow>
                {normalizeSupportStatus(detail.status) === 'RESOLVED' ? (
                  <DetailRow label="حل‌شده توسط">
                    {detail.resolvedByName ?? '—'}
                    {detail.resolvedAt ? (
                      <span className="text-xs text-muted-foreground"> · {faDateTime(detail.resolvedAt)}</span>
                    ) : null}
                  </DetailRow>
                ) : null}
              </div>

              {/* اطلاعات تشخیصی */}
              {diagnostics ? (
                <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-semibold">اطلاعات تشخیصی</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[8rem_1fr]">
                    {diagnostics.time ? (
                      <>
                        <dt className="text-muted-foreground">زمان:</dt>
                        <dd>{faDateTime(diagnostics.time)}</dd>
                      </>
                    ) : null}
                    {diagnostics.appVersion ? (
                      <>
                        <dt className="text-muted-foreground">نسخهٔ برنامه:</dt>
                        <dd dir="ltr">{diagnostics.appVersion}</dd>
                      </>
                    ) : null}
                    {diagnostics.browser ? (
                      <>
                        <dt className="text-muted-foreground">مرورگر:</dt>
                        <dd dir="ltr">{diagnostics.browser}</dd>
                      </>
                    ) : null}
                    {diagnostics.page ? (
                      <>
                        <dt className="text-muted-foreground">مسیر:</dt>
                        <dd className="font-mono" dir="ltr">{diagnostics.page}</dd>
                      </>
                    ) : null}
                    {diagnostics.errorCode ? (
                      <>
                        <dt className="text-muted-foreground">کد خطا:</dt>
                        <dd className="font-mono" dir="ltr">{diagnostics.errorCode}</dd>
                      </>
                    ) : null}
                    {diagnostics.operationId ? (
                      <>
                        <dt className="text-muted-foreground">شناسهٔ عملیات:</dt>
                        <dd className="font-mono" dir="ltr">{diagnostics.operationId}</dd>
                      </>
                    ) : null}
                  </dl>
                  <p className="text-[11px] text-muted-foreground leading-5">
                    مشاهدهٔ اطلاعات تشخیصی شما در تاریخچهٔ فعالیت ثبت می‌شود.
                  </p>
                </div>
              ) : null}

              {/* تصویر پیوست */}
              {detail.screenshot ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold">تصویر پیوست</p>
                    <Button variant="outline" size="sm" className="gap-1.5" asChild>
                      <a href={detail.screenshot} download={`${detail.code}.png`}>
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        دانلود تصویر
                      </a>
                    </Button>
                  </div>
                  <div className="rounded-xl border overflow-hidden bg-muted/40">
                    <img
                      src={detail.screenshot}
                      alt={`تصویر پیوست گزارش ${detail.code}`}
                      className="block w-full max-h-80 object-contain"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    پوشاندن‌های اعمال‌شده در فایل ذخیره شده‌اند و قابل برداشتن نیستند.
                  </p>
                </div>
              ) : null}

              {/* عملیات مرتبط */}
              {detail.operationId ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold">عملیات مرتبط</p>
                  {detail.operation ? (
                    <div className="rounded-xl border bg-card p-3 space-y-1.5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{opTypeLabel(detail.operation.type)}</span>
                        <StatusBadge
                          label={opStatusLabel(detail.operation.status)}
                          colorClass="text-info"
                          bgClass="bg-info/10"
                        />
                        <span className="text-xs text-muted-foreground ms-auto" dir="ltr">
                          {detail.operation.id}
                        </span>
                      </div>
                      {detail.operation.resultSummary ? (
                        <p className="text-xs text-muted-foreground leading-5">{detail.operation.resultSummary}</p>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => navigate('/operations')}
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        مشاهده در مرکز عملیات
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      برای مشاهدهٔ عملیات، مجوز مدیریتی لازم است.
                    </p>
                  )}
                </div>
              ) : null}

              {/* پاسخ پشتیبان */}
              {canManage ? (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <p className="text-sm font-medium">پاسخ پشتیبان</p>
                    <div>
                      <Textarea
                        rows={3}
                        maxLength={1000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="یادداشت پشتیبان برای پیگیری داخلی (حداکثر ۱۰۰۰ نویسه)"
                        aria-label="یادداشت پشتیبان"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1 text-start">
                        {toFa(note.length)} / {toFa(1000)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={nextStatus} onValueChange={setNextStatus}>
                        <SelectTrigger aria-label="تغییر وضعیت گزارش" className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPORT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {supportStatusInfo(s).label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={() => void saveResponse()} disabled={saving} className="gap-1.5">
                        {saving ? (
                          <Save className="h-4 w-4 animate-pulse" aria-hidden />
                        ) : (
                          <Save className="h-4 w-4" aria-hidden />
                        )}
                        {saving ? 'در حال ذخیره…' : 'ذخیره'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
