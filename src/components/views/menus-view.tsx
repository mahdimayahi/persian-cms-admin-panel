'use client'

import * as React from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader, Field, ConfirmDialog, EmptyState, ErrorState, LoadingSpinner } from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/client/api'
import { toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'

type MenuRow = {
  id: string
  label: string
  url: string
  order: number
}

export function MenusView() {
  const can = useCan()
  const canManage = can('menus.manage')

  const [items, setItems] = React.useState<MenuRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی افزودن/ویرایش
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<MenuRow | null>(null)
  const [form, setForm] = React.useState({ label: '', url: '' })
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  // حذف
  const [deleteTarget, setDeleteTarget] = React.useState<MenuRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<MenuRow[]>('/api/menus')
      setItems([...res].sort((a, b) => a.order - b.order))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت آیتم‌های منو')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({ label: '', url: '' })
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (m: MenuRow) => {
    setEditing(m)
    setForm({ label: m.label, url: m.url })
    setFormError(null)
    setDialogOpen(true)
  }

  const save = async () => {
    if (!form.label.trim()) {
      setFormError('عنوان منو الزامی است.')
      return
    }
    if (!form.url.trim()) {
      setFormError('آدرس منو الزامی است.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = { label: form.label.trim(), url: form.url.trim() }
      if (editing) {
        await apiPut(`/api/menus/${editing.id}`, payload)
        toast.success('آیتم منو ویرایش شد.')
      } else {
        await apiPost('/api/menus', payload)
        toast.success('آیتم منو اضافه شد.')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ذخیره آیتم منو ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  // جابه‌جایی ترتیب: تبادل مقدار order دو آیتم با دو PUT
  const move = async (index: number, dir: -1 | 1) => {
    const a = items[index]
    const b = items[index + dir]
    if (!a || !b) return
    try {
      await apiPut(`/api/menus/${a.id}`, { order: b.order })
      await apiPut(`/api/menus/${b.id}`, { order: a.order })
      toast.success('ترتیب منو به‌روزرسانی شد.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تغییر ترتیب ناموفق بود.')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/menus/${deleteTarget.id}`)
      toast.success('آیتم منو حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف آیتم منو ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="منوها"
        description="مدیریت آیتم‌های منوی اصلی سایت"
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              افزودن آیتم
            </Button>
          ) : null
        }
      />

      {loading ? (
        <LoadingSpinner label="در حال بارگذاری منو…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          title="آیتمی در منو وجود ندارد"
          description={
            canManage ? 'با دکمه «افزودن آیتم» اولین گزینه منوی سایت را اضافه کنید.' : undefined
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">آیتم‌های منوی اصلی</CardTitle>
            <CardDescription>ترتیب نمایش در سایت از بالا به پایین است ({toFa(items.length)} آیتم).</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {items.map((m, idx) => (
                <li key={m.id} className="flex items-center gap-3 px-4 sm:px-6 py-3">
                  <Badge variant="secondary" className="tabular-nums shrink-0" aria-label={`ترتیب ${toFa(m.order)}`}>
                    {toFa(m.order)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{m.label}</p>
                    <p dir="ltr" className="ltr-inline text-xs text-muted-foreground truncate block max-w-full">
                      {m.url}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => move(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`انتقال ${m.label} به بالا`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => move(idx, 1)}
                        disabled={idx === items.length - 1}
                        aria-label={`انتقال ${m.label} به پایین`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(m)}
                        aria-label={`ویرایش ${m.label}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(m)}
                        aria-label={`حذف ${m.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* گفت‌وگوی افزودن/ویرایش */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش آیتم منو' : 'افزودن آیتم منو'}</DialogTitle>
            <DialogDescription>عنوان نمایشی و آدرس مقصد این گزینه در منوی سایت.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field label="عنوان" required htmlFor="menu-label" error={formError ?? undefined}>
              <Input
                id="menu-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="مثلاً: صفحه اصلی"
                maxLength={100}
              />
            </Field>
            <Field label="آدرس" required htmlFor="menu-url" hint="آدرس داخلی مانند /about یا پیوند کامل خارجی.">
              <Input
                id="menu-url"
                dir="ltr"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="/about"
                maxLength={500}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving}>
              {editing ? 'ذخیره تغییرات' : 'افزودن به منو'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف آیتم منو"
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» از منوی سایت مطمئن هستید؟`}
        confirmLabel="حذف آیتم"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
