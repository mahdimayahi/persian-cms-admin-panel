'use client'

import * as React from 'react'
import { FolderTree, MoreHorizontal, Palette, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import { DataTable, type Column } from '@/components/shared/data-table'
import { ImpactDialog } from '@/components/shared/impact-dialog'
import { PageHeader, Field, ErrorState } from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/client/api'
import { toFa, faDate } from '@/lib/client/format'
import { useCan } from '@/store/app-store'

type Category = {
  id: string
  name: string
  slug: string
  description: string | null
  color: string
  createdAt: string
  _count: { articles: number }
}

export function CategoriesView() {
  const can = useCan()
  const canManage = can('categories.manage')

  const [items, setItems] = React.useState<Category[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی ایجاد/ویرایش
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Category | null>(null)
  const [form, setForm] = React.useState({ name: '', description: '', color: '#64748b' })
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  // حذف
  const [deleteTarget, setDeleteTarget] = React.useState<Category | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<Category[]>('/api/categories')
      setItems(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت دسته‌بندی‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', description: '', color: '#64748b' })
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (c: Category) => {
    setEditing(c)
    setForm({ name: c.name, description: c.description ?? '', color: c.color || '#64748b' })
    setFormError(null)
    setDialogOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setFormError('نام دسته‌بندی الزامی است.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color,
      }
      if (editing) {
        await apiPut(`/api/categories/${editing.id}`, payload)
        toast.success('دسته‌بندی ویرایش شد.')
      } else {
        await apiPost('/api/categories', payload)
        toast.success('دسته‌بندی ایجاد شد.')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      // پیام سرور (مانند ۴۰۹ تکراری بودن نام) مستقیماً نمایش داده می‌شود
      toast.error(e instanceof Error ? e.message : 'ذخیره دسته‌بندی ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await apiDelete(`/api/categories/${deleteTarget.id}`)
      toast.success('دسته‌بندی حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف دسته‌بندی ناموفق بود.')
    }
  }

  const columns: Column<Category>[] = [
    {
      key: 'name',
      header: 'نام',
      render: (c) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <span
            className="h-3 w-3 rounded-full border border-black/10 shrink-0"
            style={{ background: c.color || '#64748b' }}
            aria-hidden
          />
          {c.name}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'توضیحات',
      render: (c) =>
        c.description ? (
          <p className="text-sm text-muted-foreground line-clamp-1 max-w-md">{c.description}</p>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      key: 'count',
      header: 'تعداد مقالات',
      className: 'tabular-nums',
      render: (c) => <span className="text-sm tabular-nums">{toFa(c._count?.articles ?? 0)}</span>,
    },
    {
      key: 'createdAt',
      header: 'تاریخ ایجاد',
      render: (c) => <span className="text-sm whitespace-nowrap">{faDate(c.createdAt)}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            headerClassName: 'w-12',
            render: (c: Category) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`عملیات دسته‌بندی ${c.name}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => openEdit(c)} className="gap-2">
                    <Pencil className="h-4 w-4" />
                    ویرایش
                  </DropdownMenuItem>
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
          } satisfies Column<Category>,
        ]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="دسته‌بندی‌ها"
        description="سازمان‌دهی مقالات بر اساس موضوع"
        icon={<FolderTree className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              دسته‌بندی جدید
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(c) => c.id}
        loading={loading}
        error={error ? <ErrorState message={error} onRetry={load} /> : null}
        emptyTitle="دسته‌بندی‌ای یافت نشد"
        emptyDescription={canManage ? 'اولین دسته‌بندی را با دکمه «دسته‌بندی جدید» بسازید.' : undefined}
        itemLabel="دسته‌بندی"
      />

      {/* گفت‌وگوی ایجاد/ویرایش */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید'}</DialogTitle>
            <DialogDescription>
              {editing ? 'نام و مشخصات دسته‌بندی را به‌روزرسانی کنید.' : 'نامی گویا برای گروه‌بندی مقالات انتخاب کنید.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field label="نام دسته‌بندی" required htmlFor="cat-name" error={formError ?? undefined}>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثلاً: اخبار فناوری"
                maxLength={100}
              />
            </Field>
            <Field label="توضیحات" htmlFor="cat-description">
              <Textarea
                id="cat-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="توضیح اختیاری درباره این دسته‌بندی…"
                maxLength={500}
              />
            </Field>
            <Field label="رنگ" htmlFor="cat-color" hint="رنگ نمایشی کنار نام دسته‌بندی در فهرست‌ها.">
              <div className="flex items-center gap-2">
                <input
                  id="cat-color"
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-9 w-14 cursor-pointer rounded-md border bg-transparent p-1"
                  aria-label="انتخاب رنگ دسته‌بندی"
                />
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5" />
                  <span dir="ltr" className="ltr-inline">
                    {form.color}
                  </span>
                </span>
              </div>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {editing ? 'ذخیره تغییرات' : 'ایجاد دسته‌بندی'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* بررسی اثر تغییر + تأیید حذف */}
      <ImpactDialog
        target={deleteTarget ? { type: 'category', id: deleteTarget.id, name: deleteTarget.name } : null}
        onClose={() => setDeleteTarget(null)}
        onDelete={confirmDelete}
        onDeleted={load}
      />
    </div>
  )
}
