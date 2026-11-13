'use client'

import * as React from 'react'
import { MoreHorizontal, Plus, Tags, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { apiGet, apiPost, apiDelete } from '@/lib/client/api'
import { toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'

type Tag = {
  id: string
  name: string
  slug: string
  _count: { articles: number }
}

export function TagsView() {
  const can = useCan()
  const canManage = can('tags.manage')

  const [items, setItems] = React.useState<Tag[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی افزودن
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  // حذف
  const [deleteTarget, setDeleteTarget] = React.useState<Tag | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<Tag[]>('/api/tags')
      setItems(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت برچسب‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    if (!name.trim()) {
      setFormError('نام برچسب الزامی است.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await apiPost('/api/tags', { name: name.trim() })
      toast.success('برچسب ایجاد شد.')
      setDialogOpen(false)
      setName('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ایجاد برچسب ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await apiDelete(`/api/tags/${deleteTarget.id}`)
    toast.success('برچسب حذف شد.')
    setDeleteTarget(null)
  }

  const columns: Column<Tag>[] = [
    {
      key: 'name',
      header: 'نام',
      render: (t) => <span className="font-medium">{t.name}</span>,
    },
    {
      key: 'slug',
      header: 'اسلاگ',
      render: (t) => (
        <span dir="ltr" className="ltr-inline text-xs text-muted-foreground">
          {t.slug}
        </span>
      ),
    },
    {
      key: 'count',
      header: 'تعداد مقالات',
      className: 'tabular-nums',
      render: (t) => <span className="text-sm tabular-nums">{toFa(t._count?.articles ?? 0)}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            headerClassName: 'w-12',
            render: (t: Tag) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`عملیات برچسب ${t.name}`}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() => setDeleteTarget(t)}
                    className="text-destructive focus:text-destructive gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          } satisfies Column<Tag>,
        ]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="برچسب‌ها"
        description="برچسب‌گذاری مقالات برای یافتن راحت‌تر"
        icon={<Tags className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setName('')
                setFormError(null)
                setDialogOpen(true)
              }}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              برچسب جدید
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(t) => t.id}
        loading={loading}
        error={error ? <ErrorState message={error} onRetry={load} /> : null}
        emptyTitle="برچسبی یافت نشد"
        emptyDescription={canManage ? 'اولین برچسب را با دکمه «برچسب جدید» بسازید.' : undefined}
        itemLabel="برچسب"
      />

      {/* گفت‌وگوی افزودن برچسب */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>برچسب جدید</DialogTitle>
            <DialogDescription>نامی کوتاه و گویا برای برچسب انتخاب کنید.</DialogDescription>
          </DialogHeader>
          <div className="py-1">
            <Field label="نام برچسب" required htmlFor="tag-name" error={formError ?? undefined}>
              <Input
                id="tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثلاً: هوش مصنوعی"
                maxLength={60}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                }}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              ایجاد برچسب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف */}
      <ImpactDialog
        target={deleteTarget ? { type: 'tag', id: deleteTarget.id, name: deleteTarget.name } : null}
        onClose={() => setDeleteTarget(null)}
        onDelete={confirmDelete}
        onDeleted={load}
      />
    </div>
  )
}
