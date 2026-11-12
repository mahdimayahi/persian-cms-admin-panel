'use client'

/**
 * بررسی اثر حذف — نسخه ۲ (قرارداد phase1-spec §۱ و §۴.۱)
 *
 * پیش از حذف قطعی، گزارش وابستگی‌ها از GET /api/impact دریافت و نمایش داده می‌شود.
 * عملیات حذف را والد از طریق onDelete انجام می‌دهد؛ برای دسته‌بندیِ مسدودکننده،
 * راهبرد حذف (انتقال/خروج) از طریق opts به onDelete ارسال می‌شود و برای رسانهٔ
 * مسدودکننده، جایگزینی ارجاع‌ها با POST /api/media/{id}/replace-references انجام
 * و گزارش دوباره بارگیری می‌شود.
 */

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  ShieldAlert,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { MediaPickerDialog, type MediaItem } from '@/components/shared/media-picker'
import { apiGet, apiPost } from '@/lib/client/api'
import { toFa } from '@/lib/client/format'
import { navigate } from '@/hooks/use-hash-route'

export type ImpactType = 'article' | 'category' | 'tag' | 'media' | 'user' | 'page'

export type ImpactSeverity = 'INFO' | 'WARNING' | 'BLOCKING'

export type ImpactItem = {
  id: string
  title: string
  status?: string | null
  published: boolean
  link?: string | null
}

export type ImpactGroup = {
  key: string
  label: string
  detail: string
  dependencyType: string
  count: number
  severity: ImpactSeverity
  items: ImpactItem[]
}

export type ImpactReport = {
  type: ImpactType
  id: string
  name: string
  severity: ImpactSeverity
  canDelete: boolean
  total: number
  groups: ImpactGroup[]
}

/** گزینه‌های حذف — راهبرد دسته‌بندی مسدودکننده */
export type ImpactDeleteOptions = {
  strategy?: 'TRANSFER' | 'DETACH'
  targetCategoryId?: string
}

type CategoryLite = { id: string; name: string }

/** تبدیل ارقام لاتین داخل متن سرور به ارقام فارسی */
function faDigits(value: string): string {
  return value.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

const SEVERITY_BANNER: Record<
  ImpactSeverity,
  { label: string; text: string; icon: typeof Info; className: string }
> = {
  INFO: {
    label: 'اطلاع‌رسانی',
    text: 'حذف با پاک‌سازی خودکار وابستگی‌ها انجام می‌شود.',
    icon: Info,
    className:
      'border-border bg-muted text-muted-foreground',
  },
  WARNING: {
    label: 'هشدار',
    text: 'حذف با پاک‌سازی خودکار وابستگی‌ها انجام می‌شود؛ موارد فهرست‌شده از بین می‌روند.',
    icon: AlertTriangle,
    className:
      'border-warning/40 bg-warning/10 text-warning',
  },
  BLOCKING: {
    label: 'مسدودکننده',
    text: 'حذف تا رفع وابستگی مسدود است.',
    icon: ShieldAlert,
    className:
      'border-destructive/40 bg-destructive/10 text-destructive',
  },
}

export function ImpactDialog({
  target,
  onClose,
  onDelete,
  onDeleted,
}: {
  target: { type: ImpactType; id: string; name: string } | null
  onClose: () => void
  onDelete: (opts?: ImpactDeleteOptions) => Promise<void> | void
  onDeleted: () => void
}) {
  const [report, setReport] = React.useState<ImpactReport | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)

  // راه اصلاح — رسانه
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [replacement, setReplacement] = React.useState<MediaItem | null>(null)
  const [replacing, setReplacing] = React.useState(false)

  // راه اصلاح — دسته‌بندی
  const [strategy, setStrategy] = React.useState<'TRANSFER' | 'DETACH'>('TRANSFER')
  const [targetCategoryId, setTargetCategoryId] = React.useState('')
  const [categories, setCategories] = React.useState<CategoryLite[] | null>(null)
  const [categoriesLoading, setCategoriesLoading] = React.useState(false)

  const type = target?.type
  const id = target?.id

  /* دریافت گزارش اثر هنگام باز شدن گفت‌وگو */
  React.useEffect(() => {
    if (!type || !id) {
      setReport(null)
      setError(null)
      setDeleting(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setReport(null)
    apiGet<ImpactReport>(`/api/impact?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`)
      .then((res) => {
        if (!cancelled) setReport(res)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'خطای غیرمنتظره در دریافت گزارش اثر.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type, id, reloadKey])

  /* بازنشانی راه اصلاح با تغییر هدف */
  React.useEffect(() => {
    setStrategy('TRANSFER')
    setTargetCategoryId('')
    setReplacement(null)
    setPickerOpen(false)
    setReplacing(false)
    setDeleting(false)
  }, [type, id])

  /* فهرست دسته‌ها برای راهبرد انتقال (فقط برای دسته‌بندیِ مسدودکننده) */
  React.useEffect(() => {
    if (type !== 'category' || !report || report.canDelete !== false) {
      setCategories(null)
      return
    }
    let cancelled = false
    setCategoriesLoading(true)
    apiGet<CategoryLite[]>('/api/categories')
      .then((res) => {
        if (!cancelled) setCategories(res)
      })
      .catch(() => {
        if (!cancelled) setCategories([])
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type, report])

  const otherCategories = React.useMemo(
    () => (categories ?? []).filter((c) => c.id !== id),
    [categories, id]
  )

  /* اگر دستهٔ دیگری برای انتقال نیست، راهبرد پیش‌فرض «خروج» شود */
  React.useEffect(() => {
    if (type === 'category' && strategy === 'TRANSFER' && !categoriesLoading && otherCategories.length === 0) {
      setStrategy('DETACH')
    }
  }, [type, strategy, categoriesLoading, otherCategories.length])

  /* جایگزینی ارجاع‌های رسانه و بارگیری مجدد گزارش */
  const handleReplaceReferences = async () => {
    if (!replacement || !id) return
    setReplacing(true)
    try {
      const res = await apiPost<{ moved: number }>(`/api/media/${id}/replace-references`, {
        targetMediaId: replacement.id,
      })
      toast.success(
        `${toFa(res?.moved ?? 0)} ارجاع به رسانهٔ جایگزین منتقل شد؛ اکنون می‌توانید فایل را حذف کنید.`
      )
      setReplacement(null)
      setPickerOpen(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'جایگزینی ارجاع‌ها ناموفق بود.')
    } finally {
      setReplacing(false)
    }
  }

  const handleConfirm = async () => {
    if (!report) return
    setDeleting(true)
    try {
      if (report.type === 'category' && report.canDelete === false) {
        await onDelete(
          strategy === 'TRANSFER' ? { strategy: 'TRANSFER', targetCategoryId } : { strategy: 'DETACH' }
        )
      } else {
        await onDelete()
      }
      onDeleted()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حذف انجام نشد. لطفاً دوباره تلاش کنید.')
    } finally {
      setDeleting(false)
    }
  }

  const banner = report ? SEVERITY_BANNER[report.severity] : null

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o && !deleting && !replacing) onClose()
      }}
    >
      <AlertDialogContent dir="rtl" className="max-w-lg rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{type === 'user' ? 'حذف کاربر' : `حذف «${target?.name ?? ''}»`}</AlertDialogTitle>
          <AlertDialogDescription>
            قبل از حذف، بخش‌هایی که تحت تأثیر قرار می‌گیرند را بررسی کنید.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-xl border p-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
              تلاش مجدد
            </Button>
          </div>
        ) : null}

        {!loading && !error && report && banner ? (
          <div
            className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm ${banner.className}`}
            role="status"
            aria-label={`شدت بررسی: ${banner.label}`}
          >
            <banner.icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">{banner.label}</span>
              {report.total > 0 ? ` — ${toFa(report.total)} وابستگی یافت شد. ` : ' '}
              {banner.text}
            </span>
          </div>
        ) : null}

        {!loading && !error && report && report.groups.length === 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>هیچ وابستگی‌ای پیدا نشد — حذف ایمن است.</span>
          </div>
        ) : null}

        {!loading && !error && report && report.groups.length > 0 ? (
          <div className="max-h-64 space-y-2 overflow-y-auto pe-1">
            <p className="text-xs text-muted-foreground">
              در مجموع {toFa(report.total)} مورد تحت تأثیر قرار می‌گیرد:
            </p>
            {report.groups.map((g) => (
              <div key={g.key} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{g.label}</p>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {toFa(g.count)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{faDigits(g.detail)}</p>
                {g.items.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {g.items.slice(0, 5).map((it) => (
                      <li key={it.id} className="flex items-center gap-2 text-xs">
                        <span className="line-clamp-1 min-w-0 flex-1 text-muted-foreground">• {it.title}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {it.published ? (
                            <Badge
                              variant="outline"
                              className="border-success/40 bg-success/10 text-success"
                            >
                              منتشرشده
                            </Badge>
                          ) : it.status ? (
                            <Badge variant="secondary">پیش‌نویس</Badge>
                          ) : null}
                          {it.link ? (
                            <button
                              type="button"
                              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => {
                                onClose()
                                navigate(it.link as string)
                              }}
                              aria-label={`مشاهده «${it.title}»`}
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                    {g.count > g.items.slice(0, 5).length ? (
                      <li className="pt-0.5 text-[11px] text-muted-foreground">
                        و {toFa(g.count - g.items.slice(0, 5).length)} مورد دیگر…
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* راه اصلاح — فقط وقتی حذف مسدود است */}
        {!loading && !error && report && !report.canDelete ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-3"
            role="region"
            aria-label="راه اصلاح برای حذف"
          >
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <Wrench className="h-4 w-4 shrink-0" aria-hidden />
              راه اصلاح
            </p>

            {report.type === 'media' ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-muted-foreground">
                  این فایل تصویر شاخص مقالات است. رسانهٔ جایگزین را انتخاب کنید تا ارجاع‌ها منتقل شوند و فایل
                  آزاد شود.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPickerOpen(true)}
                    disabled={replacing}
                  >
                    {replacement ? 'تغییر رسانهٔ جایگزین…' : 'انتخاب رسانهٔ جایگزین…'}
                  </Button>
                  {replacement ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void handleReplaceReferences()
                      }}
                      disabled={replacing}
                    >
                      {replacing ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
                      {replacing ? 'در حال جایگزینی…' : 'جایگزینی ارجاع‌ها و آزادسازی فایل'}
                    </Button>
                  ) : null}
                </div>
                {replacement ? (
                  <p className="text-xs text-muted-foreground">
                    رسانهٔ جایگزین: «{replacement.originalName}»
                  </p>
                ) : null}
              </div>
            ) : null}

            {report.type === 'category' ? (
              <div className="mt-2 space-y-2.5">
                <RadioGroup
                  value={strategy}
                  onValueChange={(v) => setStrategy(v === 'DETACH' ? 'DETACH' : 'TRANSFER')}
                  className="gap-3"
                  aria-label="راهبرد حذف دسته‌بندی"
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="TRANSFER"
                      id="impact-strategy-transfer"
                      className="mt-0.5"
                      disabled={categoriesLoading || otherCategories.length === 0}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label
                        htmlFor="impact-strategy-transfer"
                        className="cursor-pointer text-sm font-normal leading-snug"
                      >
                        انتقال مقالات به دستهٔ دیگر
                      </Label>
                      {strategy === 'TRANSFER' ? (
                        categoriesLoading ? (
                          <Skeleton className="h-9 w-full rounded-md" aria-hidden />
                        ) : otherCategories.length > 0 ? (
                          <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
                            <SelectTrigger className="w-full" aria-label="دستهٔ مقصد انتقال">
                              <SelectValue placeholder="انتخاب دستهٔ مقصد…" />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {otherCategories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-xs text-muted-foreground">دستهٔ دیگری برای انتقال وجود ندارد.</p>
                        )
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem value="DETACH" id="impact-strategy-detach" className="mt-0.5" />
                    <Label
                      htmlFor="impact-strategy-detach"
                      className="cursor-pointer text-sm font-normal leading-snug"
                    >
                      خروج مقالات از دسته (بدون دسته‌بندی)
                    </Label>
                  </div>
                </RadioGroup>
                {strategy === 'TRANSFER' && otherCategories.length > 0 && !targetCategoryId ? (
                  <p className="text-xs text-muted-foreground">برای انتقال، دستهٔ مقصد را انتخاب کنید.</p>
                ) : null}
              </div>
            ) : null}

            {report.type !== 'media' && report.type !== 'category' ? (
              <p className="mt-2 text-sm text-muted-foreground">
                ابتدا وابستگی‌های فهرست‌شده را رفع کنید، سپس حذف را دوباره تلاش کنید.
              </p>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting || replacing}>انصراف</AlertDialogCancel>
          {report && !report.canDelete && report.type === 'category' ? (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || (strategy === 'TRANSFER' && !targetCategoryId)}
              onClick={(e) => {
                e.preventDefault()
                void handleConfirm()
              }}
            >
              {deleting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {deleting
                ? 'در حال حذف…'
                : strategy === 'TRANSFER'
                  ? 'حذف با انتقال'
                  : 'حذف با خروج از دسته'}
            </AlertDialogAction>
          ) : (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || loading || !!error || !report?.canDelete}
              onClick={(e) => {
                e.preventDefault()
                void handleConfirm()
              }}
            >
              {deleting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {deleting ? 'در حال حذف…' : 'حذف قطعی'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>

        {/* گفت‌وگوی انتخاب رسانهٔ جایگزین */}
        <MediaPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(m) => {
            setReplacement(m)
            setPickerOpen(false)
          }}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
