'use client'

import * as React from 'react'
import { BookA, Pencil, Plus, ShieldOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/client/api'
import { toFa, timeAgo } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { ruleTypeLabel, severityLabel } from '@/lib/glossary-check'

type GlossaryItem = {
  id: string
  term: string
  preferred: string
  forms: string
  type: string
  severity: string
  scope: string
  language: string
  explanation: string
  example: string
  note: string
  isActive: boolean
  createdByName: string | null
  createdAt: string
  updatedAt: string
  exceptionsCount: number
}

/** خواندن امن فهرست شکل‌های نامطلوب (JSON) */
function parseForms(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json || '[]')
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string' && f.trim() !== '') : []
  } catch {
    return []
  }
}

/** ظاهر نشان شدت: پیشنهاد خاکستری، هشدار کهربایی، الزام‌آور سرخ */
const SEVERITY_META: Record<string, { colorClass: string; bgClass: string }> = {
  SUGGESTION: { colorClass: 'text-muted-foreground', bgClass: 'bg-muted' },
  WARNING: { colorClass: 'text-warning', bgClass: 'bg-warning/10' },
  ENFORCING: { colorClass: 'text-destructive', bgClass: 'bg-destructive/10' },
}

const SCOPE_LABELS: Record<string, string> = {
  ALL: 'همه بخش‌ها',
  TITLE: 'عنوان',
  BODY: 'متن اصلی',
  SEO: 'سئو',
}

const LANGUAGE_LABELS: Record<string, string> = {
  FA: 'فارسی',
  EN: 'انگلیسی',
}

type GlossaryForm = {
  term: string
  preferred: string
  formsText: string
  type: string
  severity: string
  scope: string
  language: string
  explanation: string
  example: string
  note: string
}

const emptyForm = (): GlossaryForm => ({
  term: '',
  preferred: '',
  formsText: '',
  type: 'STYLE',
  severity: 'SUGGESTION',
  scope: 'ALL',
  language: 'FA',
  explanation: '',
  example: '',
  note: '',
})

export function GlossaryView() {
  const can = useCan()
  const canManage = can('articles.review')

  const [items, setItems] = React.useState<GlossaryItem[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // فیلترها
  const [search, setSearch] = React.useState('')
  const [severityFilter, setSeverityFilter] = React.useState('ALL')
  const [typeFilter, setTypeFilter] = React.useState('ALL')

  // گفت‌وگوی ایجاد/ویرایش قاعده
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<GlossaryItem | null>(null)
  const [form, setForm] = React.useState<GlossaryForm>(emptyForm)
  const [termError, setTermError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // حذف قاعده
  const [deleteTarget, setDeleteTarget] = React.useState<GlossaryItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ items: GlossaryItem[] }>('/api/glossary')
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت واژه‌نامه')
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setTermError(null)
    setDialogOpen(true)
  }

  const openEdit = (item: GlossaryItem) => {
    setEditing(item)
    setForm({
      term: item.term,
      preferred: item.preferred,
      formsText: parseForms(item.forms).join('\n'),
      type: item.type,
      severity: item.severity,
      scope: item.scope,
      language: item.language,
      explanation: item.explanation,
      example: item.example,
      note: item.note,
    })
    setTermError(null)
    setDialogOpen(true)
  }

  const save = async () => {
    if (form.term.trim().length < 2) {
      setTermError('شکل نامطلوب باید حداقل ۲ نویسه باشد.')
      return
    }
    setSaving(true)
    setTermError(null)
    try {
      const payload = {
        term: form.term.trim(),
        preferred: form.preferred.trim(),
        forms: form.formsText
          .split(/[\n,،]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        type: form.type,
        severity: form.severity,
        scope: form.scope,
        language: form.language,
        explanation: form.explanation.trim(),
        example: form.example.trim(),
        note: form.note.trim(),
      }
      if (editing) {
        await apiPut(`/api/glossary/${editing.id}`, payload)
        toast.success('قاعده واژه‌نامه ویرایش شد.')
      } else {
        await apiPost('/api/glossary', payload)
        toast.success('قاعده به واژه‌نامه اضافه شد.')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      // پیام سرور (مانند تکراری بودن واژه) مستقیماً نمایش داده می‌شود
      toast.error(e instanceof Error ? e.message : 'ذخیره قاعده ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  /** تغییر وضعیت فعال قاعده — قاعده غیرفعال در بررسی‌های جدید اعمال نمی‌شود ولی سابقه‌اش حفظ می‌شود */
  const toggleActive = async (item: GlossaryItem, next: boolean) => {
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, isActive: next } : x)))
    try {
      await apiPut(`/api/glossary/${item.id}`, { isActive: next })
      toast.success(next ? 'قاعده فعال شد.' : 'قاعده غیرفعال شد و در بررسی‌های جدید اعمال نمی‌شود.')
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, isActive: !next } : x)))
      toast.error(e instanceof Error ? e.message : 'تغییر وضعیت قاعده ناموفق بود.')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/glossary/${deleteTarget.id}`)
      toast.success('قاعده از واژه‌نامه حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف قاعده ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (severityFilter !== 'ALL' && item.severity !== severityFilter) return false
      if (typeFilter !== 'ALL' && item.type !== typeFilter) return false
      if (q) {
        const haystack = `${item.term} ${item.preferred} ${item.explanation} ${item.note} ${parseForms(item.forms).join(' ')}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [items, search, severityFilter, typeFilter])

  const activeCount = items.filter((i) => i.isActive).length
  const enforcingCount = items.filter((i) => i.isActive && i.severity === 'ENFORCING').length

  if (!loaded && loading) return <LoadingSpinner label="در حال بارگذاری واژه‌نامه…" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="واژه‌نامه برند"
        description="یکدستی نگارش و هویت برند را از حافظه افراد به سیستم منتقل کنید — هشدارها در ویرایشگر غیرمسدودکننده هستند و اصلاح فقط با تصمیم نویسنده انجام می‌شود."
        icon={<BookA className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              قاعده جدید
            </Button>
          ) : null
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          title="واژه‌نامه خالی است"
          description={
            canManage
              ? 'اولین قاعده را ثبت کنید؛ از این پس بررسی واژه‌نامه در ویرایشگر محتوا با همین قواعد انجام می‌شود.'
              : 'هنوز قاعده‌ای برای واژه‌نامه برند ثبت نشده است.'
          }
          action={
            canManage ? (
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="h-4 w-4" />
                قاعده جدید
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* خلاصه وضعیت و فیلترها */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {toFa(items.length)} قاعده ثبت شده · {toFa(activeCount)} فعال · {toFa(enforcingCount)} الزام‌آور
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="جست‌وجو در واژه‌نامه…"
                className="sm:w-64"
              />
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="sm:w-40" aria-label="فیلتر شدت قاعده">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">همه شدت‌ها</SelectItem>
                  <SelectItem value="SUGGESTION">{severityLabel('SUGGESTION')}</SelectItem>
                  <SelectItem value="WARNING">{severityLabel('WARNING')}</SelectItem>
                  <SelectItem value="ENFORCING">{severityLabel('ENFORCING')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="sm:w-44" aria-label="فیلتر نوع قاعده">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">همه انواع</SelectItem>
                  <SelectItem value="BRAND_TERM">{ruleTypeLabel('BRAND_TERM')}</SelectItem>
                  <SelectItem value="BRAND_NAME">{ruleTypeLabel('BRAND_NAME')}</SelectItem>
                  <SelectItem value="STYLE">{ruleTypeLabel('STYLE')}</SelectItem>
                  <SelectItem value="CLARITY">{ruleTypeLabel('CLARITY')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              compact
              title="موردی مطابق فیلترها یافت نشد"
              description="عبارت جست‌وجو یا فیلترهای شدت و نوع را تغییر دهید."
            />
          ) : (
            <div className="rounded-2xl border bg-card divide-y shadow-xs">
              {filtered.map((item) => {
                const forms = parseForms(item.forms)
                const sevMeta = SEVERITY_META[item.severity] ?? SEVERITY_META.SUGGESTION
                return (
                  <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold" dir="auto">
                          {item.term}
                        </span>
                        <StatusBadge
                          label={severityLabel(item.severity)}
                          colorClass={sevMeta.colorClass}
                          bgClass={sevMeta.bgClass}
                        />
                        <Badge variant="outline" className="text-xs font-normal">
                          {ruleTypeLabel(item.type)}
                        </Badge>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {SCOPE_LABELS[item.scope] ?? 'همه بخش‌ها'}
                        </Badge>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {LANGUAGE_LABELS[item.language] ?? item.language}
                        </Badge>
                        {!item.isActive ? (
                          <Badge className="bg-muted text-muted-foreground border-0 text-xs">غیرفعال</Badge>
                        ) : null}
                      </div>

                      {item.preferred ? (
                        <p className="text-sm leading-6">
                          <span className="text-muted-foreground">عبارت ترجیحی: </span>
                          <span className="font-semibold text-success" dir="auto">
                            «{item.preferred}»
                          </span>
                        </p>
                      ) : null}

                      {forms.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">سایر شکل‌های نامطلوب:</span>
                          {forms.map((f) => (
                            <Badge key={f} variant="outline" className="text-[11px] font-normal" dir="auto">
                              {f}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {item.explanation ? (
                        <p className="text-xs leading-5 text-muted-foreground">علت هشدار: {item.explanation}</p>
                      ) : null}
                      {item.example ? (
                        <p className="text-xs leading-5">
                          <span className="text-muted-foreground">مثال کاربرد درست: </span>
                          <span dir="auto">{item.example}</span>
                        </p>
                      ) : null}
                      {item.note ? <p className="text-xs leading-5 text-muted-foreground">{item.note}</p> : null}

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                          {item.exceptionsCount > 0
                            ? `${toFa(item.exceptionsCount)} استثنای ثبت‌شده`
                            : 'بدون استثنا'}
                        </span>
                        {item.createdByName ? <span>{item.createdByName}</span> : null}
                        <span>آخرین تغییر: {timeAgo(item.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {canManage ? (
                        <>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground me-2">
                            <Switch
                              checked={item.isActive}
                              onCheckedChange={(v) => toggleActive(item, v)}
                              aria-label={`فعال یا غیرفعال کردن قاعده ${item.term}`}
                            />
                            {item.isActive ? 'فعال' : 'غیرفعال'}
                          </label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(item)}
                            aria-label={`ویرایش قاعده ${item.term}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(item)}
                            aria-label={`حذف قاعده ${item.term}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* گفت‌وگوی ایجاد/ویرایش قاعده */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش قاعده واژه‌نامه' : 'قاعده جدید واژه‌نامه'}</DialogTitle>
            <DialogDescription>
              شکل نامطلوبی که باید در محتوا تشخیص داده شود را ثبت کنید؛ بررسی در ویرایشگر با همین قواعد انجام می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field
              label="شکل نامطلوب (عبارت قابل تشخیص)"
              required
              htmlFor="gl-term"
              error={termError ?? undefined}
            >
              <Input
                id="gl-term"
                dir="auto"
                value={form.term}
                onChange={(e) => {
                  setTermError(null)
                  setForm((f) => ({ ...f, term: e.target.value }))
                }}
                placeholder="مثلاً: می باشد"
                maxLength={80}
              />
            </Field>

            <Field label="عبارت ترجیحی (پیشنهاد اصلاح)" htmlFor="gl-preferred" hint="در صورت خالی بودن، هشدار فقط اطلاع‌رسانی می‌شود و دکمه اعمال اصلاح نمایش داده نمی‌شود.">
              <Input
                id="gl-preferred"
                dir="auto"
                value={form.preferred}
                onChange={(e) => setForm((f) => ({ ...f, preferred: e.target.value }))}
                placeholder="مثلاً: است"
                maxLength={120}
              />
            </Field>

            <Field
              label="سایر شکل‌های نامطلوب"
              htmlFor="gl-forms"
              hint="هر خط یک شکل؛ مانند «می‌باشد» و «میباشد» (اختیاری)."
            >
              <Textarea
                id="gl-forms"
                rows={2}
                dir="auto"
                value={form.formsText}
                onChange={(e) => setForm((f) => ({ ...f, formsText: e.target.value }))}
                placeholder={'می‌باشد\nمیباشد'}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="نوع قاعده" htmlFor="gl-type">
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger id="gl-type" className="w-full" aria-label="نوع قاعده">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRAND_TERM">{ruleTypeLabel('BRAND_TERM')}</SelectItem>
                    <SelectItem value="BRAND_NAME">{ruleTypeLabel('BRAND_NAME')}</SelectItem>
                    <SelectItem value="STYLE">{ruleTypeLabel('STYLE')}</SelectItem>
                    <SelectItem value="CLARITY">{ruleTypeLabel('CLARITY')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label="شدت قاعده"
                htmlFor="gl-severity"
                hint="قواعد الزام‌آور فقط برای موارد مصوب و قابل‌اتکا فعال کنید؛ پیشنهاد: ابتدا قواعد غیرمسدودکننده اجرا شود."
              >
                <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
                  <SelectTrigger id="gl-severity" className="w-full" aria-label="شدت قاعده">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SUGGESTION">{severityLabel('SUGGESTION')}</SelectItem>
                    <SelectItem value="WARNING">{severityLabel('WARNING')}</SelectItem>
                    <SelectItem value="ENFORCING">{severityLabel('ENFORCING')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="دامنه بررسی" htmlFor="gl-scope" hint="قاعده فقط در بخش‌های انتخاب‌شده اعمال می‌شود.">
                <Select value={form.scope} onValueChange={(v) => setForm((f) => ({ ...f, scope: v }))}>
                  <SelectTrigger id="gl-scope" className="w-full" aria-label="دامنه بررسی">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">همه بخش‌ها</SelectItem>
                    <SelectItem value="TITLE">عنوان</SelectItem>
                    <SelectItem value="BODY">متن اصلی</SelectItem>
                    <SelectItem value="SEO">سئو</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="زبان" htmlFor="gl-language">
                <Select value={form.language} onValueChange={(v) => setForm((f) => ({ ...f, language: v }))}>
                  <SelectTrigger id="gl-language" className="w-full" aria-label="زبان قاعده">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FA">فارسی</SelectItem>
                    <SelectItem value="EN">انگلیسی</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="توضیح علت هشدار" htmlFor="gl-explanation" hint="این متن به‌عنوان «علت» در نتیجه بررسی ویرایشگر نمایش داده می‌شود.">
              <Textarea
                id="gl-explanation"
                rows={2}
                dir="auto"
                value={form.explanation}
                onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
                placeholder="مثلاً: حشو زبانی؛ «می» + «باشد» نیازمند نیست."
                maxLength={1000}
              />
            </Field>

            <Field label="مثال کاربرد درست" htmlFor="gl-example" hint="نمونه جمله درست برای راهنمایی نویسنده (اختیاری).">
              <Textarea
                id="gl-example"
                rows={2}
                dir="auto"
                value={form.example}
                onChange={(e) => setForm((f) => ({ ...f, example: e.target.value }))}
                placeholder="مثلاً: این قابلیت در نسخه فعلی موجود است."
                maxLength={1000}
              />
            </Field>

            <Field label="یادداشت داخلی" htmlFor="gl-note">
              <Textarea
                id="gl-note"
                rows={2}
                dir="auto"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="یادداشت اختیاری برای بازبینی‌کننده‌ها…"
                maxLength={500}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving}>
              {editing ? 'ذخیره تغییرات' : 'افزودن به واژه‌نامه'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف قاعده — استثناهای وابسته نیز حذف می‌شوند */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف قاعده واژه‌نامه"
        description={`قاعده «${deleteTarget?.term ?? ''}» حذف می‌شود و هشدار مرتبط با آن در ویرایشگر دیگر نمایش داده نمی‌شود. استثناهای ثبت‌شده برای این قاعده نیز حذف خواهند شد.`}
        confirmLabel="حذف قاعده"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
