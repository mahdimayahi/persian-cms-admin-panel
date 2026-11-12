'use client'

import * as React from 'react'
import { BookA, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
  StatusBadge,
} from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/client/api'
import { timeAgo } from '@/lib/client/format'
import { useCan } from '@/store/app-store'

type RuleType = 'PREFERRED' | 'FORBIDDEN' | 'REVIEW'

type GlossaryItem = {
  id: string
  term: string
  replacement: string | null
  type: RuleType
  note: string | null
  createdByName: string | null
  createdAt: string
}

const RULE_META: Record<RuleType, { label: string; colorClass: string; bgClass: string }> = {
  PREFERRED: {
    label: 'واژه ترجیحی',
    colorClass: 'text-emerald-700 dark:text-emerald-400',
    bgClass: 'bg-emerald-100 dark:bg-emerald-950/60',
  },
  FORBIDDEN: {
    label: 'عبارت ممنوع',
    colorClass: 'text-rose-700 dark:text-rose-400',
    bgClass: 'bg-rose-100 dark:bg-rose-950/60',
  },
  REVIEW: {
    label: 'نیازمند بررسی',
    colorClass: 'text-amber-700 dark:text-amber-400',
    bgClass: 'bg-amber-100 dark:bg-amber-950/60',
  },
}

type GlossaryForm = {
  term: string
  replacement: string
  type: RuleType
  note: string
}

const emptyForm = (): GlossaryForm => ({
  term: '',
  replacement: '',
  type: 'PREFERRED',
  note: '',
})

export function GlossaryView() {
  const can = useCan()
  const canManage = can('articles.review')

  const [items, setItems] = React.useState<GlossaryItem[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی ایجاد/ویرایش
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<GlossaryItem | null>(null)
  const [form, setForm] = React.useState<GlossaryForm>(emptyForm)
  const [termError, setTermError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // حذف
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
      replacement: item.replacement ?? '',
      type: item.type,
      note: item.note ?? '',
    })
    setTermError(null)
    setDialogOpen(true)
  }

  const save = async () => {
    if (!form.term.trim()) {
      setTermError('واژه یا عبارت الزامی است.')
      return
    }
    setSaving(true)
    setTermError(null)
    try {
      const payload = {
        term: form.term.trim(),
        replacement: form.replacement.trim() || undefined,
        type: form.type,
        note: form.note.trim() || undefined,
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
      // پیام سرور (مانند ۴۰۹ تکراری بودن واژه) مستقیماً نمایش داده می‌شود
      toast.error(e instanceof Error ? e.message : 'ذخیره قاعده ناموفق بود.')
    } finally {
      setSaving(false)
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

  if (!loaded && loading) return <LoadingSpinner label="در حال بارگذاری واژه‌نامه…" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="واژه‌نامه و هویت برند"
        description="یکدستی نگارش را از حافظه افراد به سیستم منتقل کنید — هشدارها در ویرایشگر غیرمسدودکننده هستند"
        icon={<BookA className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              واژه جدید
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
              ? 'اولین قاعده نگارشی را ثبت کنید تا هشدارها در ویرایشگر فعال شود.'
              : 'هنوز قاعده‌نگارشی ثبت نشده است.'
          }
          action={
            canManage ? (
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="h-4 w-4" />
                واژه جدید
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-2xl border bg-card divide-y shadow-xs">
          {items.map((item) => {
            const meta = RULE_META[item.type]
            return (
              <div key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{item.term}</span>
                    <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                  </div>
                  {item.replacement ? (
                    <p className="text-sm leading-6">
                      <span className="text-muted-foreground">نگارش پیشنهادی: </span>
                      <span dir="auto">{item.replacement}</span>
                    </p>
                  ) : null}
                  {item.note ? <p className="text-xs text-muted-foreground leading-5">{item.note}</p> : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground me-2 whitespace-nowrap">
                    {item.createdByName ? `${item.createdByName} · ` : ''}
                    {timeAgo(item.createdAt)}
                  </span>
                  {canManage ? (
                    <>
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

      {/* گفت‌وگوی ایجاد/ویرایش قاعده */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش قاعده' : 'قاعده جدید'}</DialogTitle>
            <DialogDescription>
              قاعده‌ای برای یکدستی نگارش تعیین کنید؛ هشدارها در ویرایشگر نمایش داده می‌شوند.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field label="واژه یا عبارت" required htmlFor="gl-term" error={termError ?? undefined}>
              <Input
                id="gl-term"
                dir="auto"
                value={form.term}
                onChange={(e) => {
                  setTermError(null)
                  setForm((f) => ({ ...f, term: e.target.value }))
                }}
                placeholder="مثلاً: دانلود کردنی"
                maxLength={100}
              />
            </Field>
            <Field label="نگارش پیشنهادی" htmlFor="gl-replacement">
              <Input
                id="gl-replacement"
                dir="auto"
                value={form.replacement}
                onChange={(e) => setForm((f) => ({ ...f, replacement: e.target.value }))}
                placeholder="مثلاً: قابل دانلود"
                maxLength={100}
              />
            </Field>
            <Field label="نوع قاعده" htmlFor="gl-type">
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as RuleType }))}
              >
                <SelectTrigger id="gl-type" className="w-full" aria-label="نوع قاعده">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PREFERRED">واژه ترجیحی</SelectItem>
                  <SelectItem value="FORBIDDEN">عبارت ممنوع</SelectItem>
                  <SelectItem value="REVIEW">نیازمند بررسی</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="توضیح" htmlFor="gl-note">
              <Textarea
                id="gl-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="توضیح اختیاری درباره دلیل این قاعده…"
                maxLength={300}
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

      {/* تأیید حذف قاعده */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف قاعده"
        description={`قاعده «${deleteTarget?.term ?? ''}» از واژه‌نامه حذف می‌شود و هشدار مرتبط با آن در ویرایشگر دیگر نمایش داده نمی‌شود.`}
        confirmLabel="حذف قاعده"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
