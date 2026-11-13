'use client'

import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import { Eye, LayoutList, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type Column } from '@/components/shared/data-table'
import { PageHeader, Field, StatusBadge, ConfirmDialog, ErrorState } from '@/components/shared/ui-bits'
import { ContentComments } from '@/components/shared/content-comments'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/client/api'
import { toFa, timeAgo } from '@/lib/client/format'
import { useCan } from '@/store/app-store'

type PageRow = {
  id: string
  title: string
  slug: string
  content: string
  status: string
  showInNav: boolean
  order: number
  createdAt: string
  updatedAt: string
}

const PAGE_STATUS_INFO: Record<string, { label: string; color: string; bg: string }> = {
  PUBLISHED: { label: 'منتشرشده', color: 'text-success', bg: 'bg-success/10' },
  DRAFT: { label: 'پیش‌نویس', color: 'text-muted-foreground', bg: 'bg-muted' },
}

function pageStatusInfo(status: string) {
  return PAGE_STATUS_INFO[status] ?? PAGE_STATUS_INFO.DRAFT
}

/** اسلایگ‌ساز محلی سبک (مشابه منطق سرور) */
function slugifyLocal(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0600-\u06FF-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

type PageForm = {
  title: string
  slug: string
  content: string
  status: 'DRAFT' | 'PUBLISHED'
  showInNav: boolean
  order: string
}

const EMPTY_FORM: PageForm = { title: '', slug: '', content: '', status: 'DRAFT', showInNav: false, order: '0' }

export function PagesView() {
  const can = useCan()
  const canManage = can('pages.manage')

  const [items, setItems] = React.useState<PageRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی ویرایش
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<PageRow | null>(null)
  const [form, setForm] = React.useState<PageForm>(EMPTY_FORM)
  const [slugEdited, setSlugEdited] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [previewTab, setPreviewTab] = React.useState('write')

  // حذف
  const [deleteTarget, setDeleteTarget] = React.useState<PageRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<PageRow[]>('/api/pages')
      setItems(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت صفحات')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setSlugEdited(false)
    setPreviewTab('write')
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (p: PageRow) => {
    setEditing(p)
    setForm({
      title: p.title,
      slug: p.slug,
      content: p.content ?? '',
      status: p.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
      showInNav: p.showInNav,
      order: String(p.order ?? 0),
    })
    setSlugEdited(true)
    setPreviewTab('write')
    setFormError(null)
    setDialogOpen(true)
  }

  const save = async () => {
    if (!form.title.trim()) {
      setFormError('عنوان صفحه الزامی است.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim(),
        content: form.content,
        status: form.status,
        showInNav: form.showInNav,
        order: Number(form.order) || 0,
        // قفل خوش‌بینانه: نسخهٔ پایه برای جلوگیری از بازنویسی بی‌صدای ویرایش دیگران
        ...(editing ? { baseUpdatedAt: editing.updatedAt } : {}),
      }
      if (editing) {
        await apiPut(`/api/pages/${editing.id}`, payload)
        toast.success('صفحه ذخیره شد.')
      } else {
        await apiPost('/api/pages', payload)
        toast.success('صفحه ایجاد شد.')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ذخیره صفحه ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/pages/${deleteTarget.id}`)
      toast.success('صفحه حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف صفحه ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<PageRow>[] = [
    {
      key: 'title',
      header: 'عنوان',
      render: (p) => <span className="font-medium line-clamp-1 max-w-xs" title={p.title}>{p.title}</span>,
    },
    {
      key: 'slug',
      header: 'آدرس',
      render: (p) => (
        <span dir="ltr" className="ltr-inline text-xs text-muted-foreground">
          /{p.slug}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (p) => {
        const info = pageStatusInfo(p.status)
        return <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
      },
    },
    {
      key: 'showInNav',
      header: 'در منو',
      render: (p) =>
        p.showInNav ? (
          <span className="text-sm">بله</span>
        ) : (
          <span className="text-sm text-muted-foreground">خیر</span>
        ),
    },
    {
      key: 'order',
      header: 'ترتیب',
      className: 'tabular-nums',
      render: (p) => <span className="text-sm tabular-nums">{toFa(p.order)}</span>,
    },
    {
      key: 'updatedAt',
      header: 'به‌روزرسانی',
      render: (p) => <span className="text-sm whitespace-nowrap text-muted-foreground">{timeAgo(p.updatedAt)}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            headerClassName: 'w-12',
            render: (p: PageRow) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`عملیات صفحه ${p.title}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => openEdit(p)} className="gap-2">
                    <Pencil className="h-4 w-4" />
                    ویرایش
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteTarget(p)}
                    className="text-destructive focus:text-destructive gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          } satisfies Column<PageRow>,
        ]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="صفحات"
        description="صفحات ثابت سایت مانند «درباره ما» و «تماس با ما»"
        icon={<LayoutList className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              صفحه جدید
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(p) => p.id}
        loading={loading}
        error={error ? <ErrorState message={error} onRetry={load} /> : null}
        emptyTitle="صفحه‌ای یافت نشد"
        emptyDescription={canManage ? 'اولین صفحه ثابت سایت را با دکمه «صفحه جدید» بسازید.' : undefined}
        itemLabel="صفحه"
      />

      {/* گفت‌وگوی ویرایش صفحه */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش صفحه' : 'صفحه جدید'}</DialogTitle>
            <DialogDescription>محتوای صفحه و نحوه نمایش آن در سایت را تنظیم کنید.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <Field label="عنوان صفحه" required htmlFor="page-title" error={formError ?? undefined}>
              <Input
                id="page-title"
                value={form.title}
                onChange={(e) => {
                  const title = e.target.value
                  setForm((f) => ({ ...f, title, slug: slugEdited ? f.slug : slugifyLocal(title) }))
                }}
                placeholder="مثلاً: درباره ما"
                maxLength={200}
              />
            </Field>

            <Field label="آدرس کوتاه" htmlFor="page-slug" hint="فقط حروف انگلیسی، عدد و خط تیره. در صورت خالی بودن از عنوان ساخته می‌شود.">
              <Input
                id="page-slug"
                dir="ltr"
                value={form.slug}
                onChange={(e) => {
                  setSlugEdited(true)
                  setForm((f) => ({ ...f, slug: e.target.value }))
                }}
                placeholder="about-us"
              />
            </Field>

            <div className="space-y-1.5">
              <Label>محتوای صفحه</Label>
              <Tabs value={previewTab} onValueChange={setPreviewTab}>
                <TabsList className="h-8">
                  <TabsTrigger value="write" className="text-xs">
                    نوشتن
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs gap-1">
                    <Eye className="h-3.5 w-3.5" />
                    پیش‌نمایش
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="write" className="mt-2">
                  <Textarea
                    rows={10}
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    placeholder="متن صفحه (پشتیبانی از مارک‌داون)…"
                    aria-label="محتوای صفحه"
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-2">
                  <div className="md-preview rounded-md border p-4 min-h-40 max-h-72 overflow-y-auto">
                    {form.content.trim() ? (
                      <ReactMarkdown>{form.content}</ReactMarkdown>
                    ) : (
                      <p className="text-sm text-muted-foreground">چیزی برای پیش‌نمایش وجود ندارد.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="وضعیت" htmlFor="page-status">
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as PageForm['status'] }))}
                >
                  <SelectTrigger id="page-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">پیش‌نویس</SelectItem>
                    <SelectItem value="PUBLISHED">منتشرشده</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ترتیب نمایش" htmlFor="page-order" hint="عدد کوچک‌تر در ابتدای فهرست نمایش داده می‌شود.">
                <Input
                  id="page-order"
                  type="number"
                  min={0}
                  value={form.order}
                  onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="page-nav" className="font-normal">
                نمایش در منوی سایت
              </Label>
              <Switch
                id="page-nav"
                checked={form.showInNav}
                onCheckedChange={(v) => setForm((f) => ({ ...f, showInNav: v }))}
              />
            </div>

            {/* گفتگوی رکوردی صفحه — فقط هنگام ویرایش صفحهٔ موجود */}
            {editing ? (
              <div className="border-t pt-4">
                <ContentComments entityType="PAGE" entityId={editing.id} />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving || !form.title.trim()}>
              {editing ? 'ذخیره تغییرات' : 'ایجاد صفحه'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف صفحه"
        description={`آیا از حذف «${deleteTarget?.title ?? ''}» مطمئن هستید؟ محتوای صفحه به‌طور کامل حذف می‌شود.`}
        confirmLabel="حذف صفحه"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
