'use client'

import * as React from 'react'
import { FilePlus2, Info, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { navigate } from '@/hooks/use-hash-route'
import { useCan } from '@/store/app-store'

type TemplateType = 'ARTICLE' | 'LANDING'

type Template = {
  id: string
  name: string
  description: string | null
  type: TemplateType
  titleTemplate: string
  excerptTemplate: string | null
  contentTemplate: string
  tagNames: string
  categoryId: string | null
  isSystem: boolean
  createdByName: string | null
  createdAt: string
}

type CategoryOption = { id: string; name: string }

const TYPE_META: Record<TemplateType, { label: string; colorClass: string; bgClass: string }> = {
  ARTICLE: {
    label: 'مقاله',
    colorClass: 'text-teal-700 dark:text-teal-400',
    bgClass: 'bg-teal-100 dark:bg-teal-950/60',
  },
  LANDING: {
    label: 'صفحه فرود',
    colorClass: 'text-violet-700 dark:text-violet-400',
    bgClass: 'bg-violet-100 dark:bg-violet-950/60',
  },
}

/** تجزیه امن JSON برچسب‌ها — خروجی خراب یا غیرآرایه به‌صورت آرایه خالی برگردانده می‌شود */
function parseTagNames(json: string): string[] {
  if (!json.trim()) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      .map((t) => t.trim())
  } catch {
    return []
  }
}

/** ورودی آزاد کاربر (ویرگول فارسی یا لاتین) به آرایه برچسب */
function splitTags(raw: string): string[] {
  return raw
    .split(/[,،]/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

type TemplateForm = {
  name: string
  description: string
  type: TemplateType
  titleTemplate: string
  excerptTemplate: string
  contentTemplate: string
  tags: string
  categoryId: string // «none» یعنی بدون دسته‌بندی
}

const emptyForm = (): TemplateForm => ({
  name: '',
  description: '',
  type: 'ARTICLE',
  titleTemplate: '',
  excerptTemplate: '',
  contentTemplate: '',
  tags: '',
  categoryId: 'none',
})

export function TemplatesView() {
  const can = useCan()
  const canManage = can('articles.review')

  const [items, setItems] = React.useState<Template[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی ایجاد/ویرایش
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Template | null>(null)
  const [form, setForm] = React.useState<TemplateForm>(emptyForm)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [categories, setCategories] = React.useState<CategoryOption[]>([])

  // حذف
  const [deleteTarget, setDeleteTarget] = React.useState<Template | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ items: Template[] }>('/api/templates')
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت الگوها')
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const loadCategories = async () => {
    try {
      const res = await apiGet<CategoryOption[]>('/api/categories')
      setCategories(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'دریافت فهرست دسته‌بندی‌ها ناموفق بود.')
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setNameError(null)
    setDialogOpen(true)
    loadCategories()
  }

  const openEdit = (t: Template) => {
    setEditing(t)
    setForm({
      name: t.name,
      description: t.description ?? '',
      type: t.type,
      titleTemplate: t.titleTemplate,
      excerptTemplate: t.excerptTemplate ?? '',
      contentTemplate: t.contentTemplate,
      tags: parseTagNames(t.tagNames).join('، '),
      categoryId: t.categoryId ?? 'none',
    })
    setNameError(null)
    setDialogOpen(true)
    loadCategories()
  }

  const save = async () => {
    if (!form.name.trim()) {
      setNameError('نام الگو الزامی است.')
      return
    }
    setSaving(true)
    setNameError(null)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        titleTemplate: form.titleTemplate.trim(),
        excerptTemplate: form.excerptTemplate.trim() || undefined,
        contentTemplate: form.contentTemplate,
        tagNames: splitTags(form.tags),
        categoryId: form.categoryId === 'none' ? null : form.categoryId,
      }
      if (editing) {
        await apiPut(`/api/templates/${editing.id}`, payload)
        toast.success('الگو ویرایش شد.')
      } else {
        await apiPost('/api/templates', payload)
        toast.success('الگو ایجاد شد.')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ذخیره الگو ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/templates/${deleteTarget.id}`)
      toast.success('الگو حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف الگو ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  if (!loaded && loading) return <LoadingSpinner label="در حال بارگذاری الگوها…" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="الگوهای محتوا"
        description="کارهای مشابه از صفر ساخته نشوند — محتوای جدید از الگوی تأییدشده ساخته می‌شود"
        icon={<LayoutTemplate className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              الگوی جدید
            </Button>
          ) : null
        }
      />

      {/* راهنمای جای‌نگه‌دارها */}
      <Alert className="rounded-2xl">
        <Info className="h-4 w-4" />
        <AlertDescription>
          از کروشه مانند [عنوان] برای بخش‌هایی استفاده کنید که نویسنده باید تکمیل کند. آدرس، زمان انتشار و اطلاعات حساس از الگو کپی نمی‌شود.
        </AlertDescription>
      </Alert>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          title="الگویی ثبت نشده است"
          description={
            canManage
              ? 'اولین الگو را بسازید تا نویسنده‌ها به‌جای شروع از صفر، از آن شروع کنند.'
              : undefined
          }
          action={
            canManage ? (
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="h-4 w-4" />
                الگوی جدید
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((t) => {
            const meta = TYPE_META[t.type]
            const tags = parseTagNames(t.tagNames)
            return (
              <article key={t.id} className="rounded-2xl border bg-card p-4 flex flex-col gap-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                  {t.isSystem ? <Badge variant="secondary">سیستمی</Badge> : null}
                </div>

                {t.description ? (
                  <p className="text-sm text-muted-foreground line-clamp-2 leading-6">{t.description}</p>
                ) : null}

                {t.titleTemplate ? (
                  <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground mb-0.5">عنوان پیش‌فرض</p>
                    <p dir="auto" className="text-sm line-clamp-2 leading-6">
                      {t.titleTemplate}
                    </p>
                  </div>
                ) : null}

                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="font-normal text-[11px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <p className="text-xs text-muted-foreground mt-auto">
                  {t.createdByName ? `${t.createdByName} · ` : ''}
                  {timeAgo(t.createdAt)}
                </p>

                <div className="flex items-center gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    onClick={() => navigate(`/articles/new?template=${t.id}`)}
                    className="gap-1.5"
                    aria-label={`ایجاد محتوای جدید از الگوی ${t.name}`}
                  >
                    <FilePlus2 className="h-4 w-4" />
                    ایجاد از الگو
                  </Button>
                  {canManage ? (
                    <div className="ms-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(t)}
                        aria-label={`ویرایش الگوی ${t.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(t)}
                        aria-label={`حذف الگوی ${t.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* گفت‌وگوی ایجاد/ویرایش الگو */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش الگو' : 'الگوی جدید'}</DialogTitle>
            <DialogDescription>
              متن‌های پیش‌فرضی که مقاله یا صفحه جدید از روی آن‌ها ساخته می‌شود را تعیین کنید.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] -mx-1 px-1">
            <div className="space-y-4 py-1 pe-2">
              <Field label="نام الگو" required htmlFor="tpl-name" error={nameError ?? undefined}>
                <Input
                  id="tpl-name"
                  value={form.name}
                  onChange={(e) => {
                    setNameError(null)
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }}
                  placeholder="مثلاً: قالب مقاله آموزشی"
                  maxLength={100}
                />
              </Field>
              <Field label="توضیح" htmlFor="tpl-description">
                <Input
                  id="tpl-description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="توضیح اختیاری درباره کاربرد این الگو…"
                  maxLength={200}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="نوع" htmlFor="tpl-type">
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v as TemplateType }))}
                  >
                    <SelectTrigger id="tpl-type" className="w-full" aria-label="نوع الگو">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARTICLE">مقاله</SelectItem>
                      <SelectItem value="LANDING">صفحه فرود</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="دسته‌بندی پیش‌فرض" htmlFor="tpl-category">
                  <Select
                    value={form.categoryId}
                    onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                  >
                    <SelectTrigger id="tpl-category" className="w-full" aria-label="دسته‌بندی پیش‌فرض الگو">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">بدون دسته‌بندی</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="عنوان پیش‌فرض" htmlFor="tpl-title">
                <Input
                  id="tpl-title"
                  dir="auto"
                  value={form.titleTemplate}
                  onChange={(e) => setForm((f) => ({ ...f, titleTemplate: e.target.value }))}
                  placeholder="مثلاً: [عنوان] — راهنمای گام‌به‌گام"
                  maxLength={150}
                />
              </Field>
              <Field label="خلاصه پیش‌فرض" htmlFor="tpl-excerpt">
                <Textarea
                  id="tpl-excerpt"
                  rows={2}
                  dir="auto"
                  value={form.excerptTemplate}
                  onChange={(e) => setForm((f) => ({ ...f, excerptTemplate: e.target.value }))}
                  placeholder="خلاصه‌ای کوتاه که در فهرست‌ها نمایش داده می‌شود…"
                  maxLength={300}
                />
              </Field>
              <Field label="محتوای الگو (Markdown)" htmlFor="tpl-content">
                <Textarea
                  id="tpl-content"
                  rows={12}
                  dir="auto"
                  className="font-mono text-xs"
                  value={form.contentTemplate}
                  onChange={(e) => setForm((f) => ({ ...f, contentTemplate: e.target.value }))}
                  placeholder={'## مقدمه\n\n[متن بدنه]\n\n## نتیجه‌گیری'}
                />
              </Field>
              <Field
                label="برچسب‌ها (با ویرگول جدا کنید)"
                htmlFor="tpl-tags"
                hint="این برچسب‌ها هنگام ساخت محتوای جدید پیشنهاد می‌شوند."
              >
                <Input
                  id="tpl-tags"
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="مثلاً: آموزش، مبتدی"
                />
              </Field>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving}>
              {editing ? 'ذخیره تغییرات' : 'ایجاد الگو'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف الگو */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف الگو"
        description={`حذف الگوی «${deleteTarget?.name ?? ''}». محتوای ساخته‌شده از این الگو حذف نمی‌شود.`}
        confirmLabel="حذف الگو"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
