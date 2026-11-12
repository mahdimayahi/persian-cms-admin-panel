'use client'

import * as React from 'react'
import { KeyRound, MoreHorizontal, Pencil, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type Column } from '@/components/shared/data-table'
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
import { ApiError, apiDelete, apiGet, apiPost, apiPut, type PagedResponse } from '@/lib/client/api'
import { notifyGuideEvent } from '@/lib/client/guide'
import { faDate, timeAgo, toFa } from '@/lib/client/format'
import { USER_STATUSES, userStatusInfo } from '@/lib/constants'
import { ROLES, ROLE_LABELS, type Role } from '@/lib/permissions'
import { useCan } from '@/store/app-store'

type UserRow = {
  id: string
  email: string
  name: string
  role: string
  status: string
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
  _count: { articles: number }
}

/** حرف‌های نخست نام برای آواتار */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '؟'
  return parts.slice(0, 2).map((p) => p[0]).join('')
}

const ALL = '__ALL__'

export function UsersView() {
  const can = useCan()
  const canManage = can('users.manage')

  // ─── داده فهرست ─────────────────────────────────────────────────
  const [list, setList] = React.useState<PagedResponse<UserRow> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // ─── فیلترها و صفحه‌بندی ────────────────────────────────────────
  const [qInput, setQInput] = React.useState('')
  const [q, setQ] = React.useState('')
  const [role, setRole] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)

  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [qInput])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (q) params.set('q', q)
      if (role) params.set('role', role)
      if (status) params.set('status', status)
      const res = await apiGet<PagedResponse<UserRow>>(`/api/users?${params.toString()}`)
      setList(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت فهرست کاربران')
    } finally {
      setLoading(false)
    }
  }, [q, role, status, page, pageSize])

  React.useEffect(() => {
    load()
  }, [load])

  // ─── گفت‌وگوی ایجاد کاربر ───────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createForm, setCreateForm] = React.useState({ name: '', email: '', password: '', role: 'AUTHOR' })
  const [createBusy, setCreateBusy] = React.useState(false)

  const openCreate = () => {
    setCreateForm({ name: '', email: '', password: '', role: 'AUTHOR' })
    setCreateOpen(true)
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createForm.name.trim() || !createForm.email.trim() || createForm.password.length < 8) {
      toast.error('نام، ایمیل و رمز عبور (حداقل ۸ نویسه) الزامی است.')
      return
    }
    setCreateBusy(true)
    try {
      await apiPost('/api/users', {
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        password: createForm.password,
        role: createForm.role,
      })
      toast.success('دعوت‌نامه ایجاد شد — کاربر با اولین ورود فعال می‌شود.')
      // راهنما: ساخت موفق اولین حساب همکار
      void notifyGuideEvent('user.created')
      setCreateOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در ایجاد کاربر')
    } finally {
      setCreateBusy(false)
    }
  }

  // ─── گفت‌وگوی ویرایش کاربر ──────────────────────────────────────
  const [editTarget, setEditTarget] = React.useState<UserRow | null>(null)
  const [editForm, setEditForm] = React.useState({ name: '', role: '', status: '', password: '' })
  const [editBusy, setEditBusy] = React.useState(false)

  const openEdit = (u: UserRow) => {
    setEditForm({ name: u.name, role: u.role, status: u.status, password: '' })
    setEditTarget(u)
  }

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget) return
    if (!editForm.name.trim()) {
      toast.error('نام الزامی است.')
      return
    }
    setEditBusy(true)
    try {
      const payload: Record<string, string> = {
        name: editForm.name.trim(),
        role: editForm.role,
        status: editForm.status,
      }
      if (editForm.password) payload.password = editForm.password
      await apiPut(`/api/users/${editTarget.id}`, payload)
      toast.success('اطلاعات کاربر ذخیره شد.')
      // راهنما: تغییر نقش یک کاربر = به‌روزرسانی مجوزهای مؤثر او. (صفحهٔ نقش‌ها فقط‌خواندنی است؛
      // تنها جریان واقعی به‌روزرسانی مجوزهای در دسترس، همین تغییر نقش است)
      if (editForm.role !== editTarget.role) void notifyGuideEvent('roles.updated')
      setEditTarget(null)
      load()
    } catch (err) {
      // خطاهای سرور مانند جلوگیری از تضعیف حساب خودی یا حذف آخرین مدیر
      toast.error(err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات کاربر')
    } finally {
      setEditBusy(false)
    }
  }

  // ─── حذف و انتقال مقالات ────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [transfer, setTransfer] = React.useState<{ user: UserRow; options: UserRow[]; value: string } | null>(null)
  const [transferBusy, setTransferBusy] = React.useState(false)

  const submitDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await apiDelete(`/api/users/${deleteTarget.id}`)
      toast.success('حساب کاربری حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const articleCount = (err.data as { articleCount?: number } | undefined)?.articleCount ?? 0
        if (articleCount > 0) {
          // کاربر نویسنده مقاله است؛ گفت‌وگوی انتقال مقالات باز می‌شود
          try {
            const res = await apiGet<PagedResponse<UserRow>>('/api/users?page=1&pageSize=100')
            const options = res.items.filter((u) => u.id !== deleteTarget.id)
            if (options.length === 0) {
              toast.error('کاربر دیگری برای انتقال مقالات وجود ندارد.')
            } else {
              setTransfer({ user: deleteTarget, options, value: '' })
            }
          } catch {
            toast.error(`این کاربر نویسندهٔ ${toFa(articleCount)} مقاله است و امکان انتقال مقالات فراهم نشد.`)
          }
          setDeleteTarget(null)
        } else {
          // خطای ۴۰۹ دیگر (مانند وجود رسانه متصل به کاربر)
          toast.error(err.message)
        }
      } else {
        toast.error(err instanceof Error ? err.message : 'خطا در حذف کاربر')
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  const submitTransfer = async () => {
    if (!transfer || !transfer.value) {
      toast.error('کاربر مقصد انتقال را انتخاب کنید.')
      return
    }
    setTransferBusy(true)
    try {
      await apiDelete(`/api/users/${transfer.user.id}?transferToUserId=${transfer.value}`)
      toast.success('حساب کاربری حذف و مقالات به کاربر منتخب منتقل شد.')
      setTransfer(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در حذف و انتقال مقالات')
    } finally {
      setTransferBusy(false)
    }
  }

  // ─── ستون‌های جدول ──────────────────────────────────────────────
  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: 'کاربر',
      render: (u) => (
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="size-9">
            <AvatarFallback className="text-xs font-semibold">{initials(u.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-semibold line-clamp-1">{u.name}</p>
            <p className="text-xs text-muted-foreground truncate" dir="ltr">
              {u.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'نقش',
      render: (u) => <Badge variant="secondary">{ROLE_LABELS[u.role as Role] ?? u.role}</Badge>,
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (u) => {
        const info = userStatusInfo(u.status)
        return <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
      },
    },
    {
      key: 'articles',
      header: 'مقالات',
      render: (u) => <span className="text-sm tabular-nums">{toFa(u._count?.articles ?? 0)}</span>,
    },
    {
      key: 'lastLogin',
      header: 'آخرین ورود',
      render: (u) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'هرگز'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'تاریخ عضویت',
      render: (u) => <span className="text-sm text-muted-foreground whitespace-nowrap">{faDate(u.createdAt)}</span>,
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: '',
      headerClassName: 'w-12',
      render: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`عملیات کاربر ${u.name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => openEdit(u)}>
              <Pencil className="me-2 h-4 w-4" />
              ویرایش
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openEdit(u)}>
              <KeyRound className="me-2 h-4 w-4" />
              بازیابی رمز عبور
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDeleteTarget(u)}
            >
              <Trash2 className="me-2 h-4 w-4" />
              حذف
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    })
  }

  if (loading && !list) return <LoadingSpinner label="در حال بارگذاری کاربران…" />
  if (error && !list) return <ErrorState message={error} onRetry={load} />

  return (
    <div>
      <PageHeader
        title="کاربران"
        description="مدیریت حساب‌های کاربری، نقش‌ها و وضعیت دسترسی"
        icon={<Users className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              دعوت کاربر
            </Button>
          ) : null
        }
      />

      {/* نوار فیلتر */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <SearchInput value={qInput} onChange={setQInput} placeholder="جست‌وجوی نام یا ایمیل…" className="sm:max-w-xs" />
        <Select
          value={role || ALL}
          onValueChange={(v) => {
            setRole(v === ALL ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="فیلتر نقش">
            <SelectValue placeholder="نقش" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>همه نقش‌ها</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || ALL}
          onValueChange={(v) => {
            setStatus(v === ALL ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="فیلتر وضعیت">
            <SelectValue placeholder="وضعیت" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>همه وضعیت‌ها</SelectItem>
            {USER_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={list?.items ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        error={error && list ? <ErrorState message={error} onRetry={load} /> : undefined}
        emptyState={
          <EmptyState
            compact
            title="کاربری یافت نشد"
            description="با تغییر فیلترها یا دعوت کاربر جدید شروع کنید."
            icon={<Users className="h-6 w-6" />}
          />
        }
        page={page}
        pageSize={pageSize}
        total={list?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        itemLabel="کاربر"
      />

      {/* گفت‌وگوی دعوت کاربر */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>دعوت کاربر</DialogTitle>
            <DialogDescription>حساب با وضعیت «دعوت‌شده» ایجاد می‌شود و با اولین ورود فعال می‌گردد.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <Field label="نام" required htmlFor="create-name">
              <Input
                id="create-name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={100}
                required
              />
            </Field>
            <Field label="ایمیل" required htmlFor="create-email">
              <Input
                id="create-email"
                type="email"
                dir="ltr"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </Field>
            <Field label="رمز عبور" required htmlFor="create-password" hint="حداقل ۸ نویسه">
              <Input
                id="create-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
            </Field>
            <Field label="نقش" required htmlFor="create-role">
              <Select value={createForm.role} onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger id="create-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createBusy}>
                انصراف
              </Button>
              <Button type="submit" disabled={createBusy}>
                {createBusy ? 'در حال ایجاد…' : 'ایجاد دعوت‌نامه'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* گفت‌وگوی ویرایش کاربر (و بازیابی رمز عبور) */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ویرایش کاربر</DialogTitle>
            <DialogDescription>
              {editTarget ? `${editTarget.name} — ${editTarget.email}` : ''}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-4">
            <Field label="نام" required htmlFor="edit-name">
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={100}
                required
              />
            </Field>
            <Field label="نقش" required htmlFor="edit-role">
              <Select value={editForm.role} onValueChange={(v) => setEditForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger id="edit-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="وضعیت" required htmlFor="edit-status">
              <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger id="edit-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="رمز عبور جدید"
              htmlFor="edit-password"
              hint="در صورت خالی بودن، رمز عبور تغییر نمی‌کند. برای بازیابی رمز، مقدار جدید وارد کنید."
            >
              <Input
                id="edit-password"
                type="password"
                autoComplete="new-password"
                placeholder="تغییر ندهید"
                minLength={8}
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)} disabled={editBusy}>
                انصراف
              </Button>
              <Button type="submit" disabled={editBusy}>
                {editBusy ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف حساب کاربری */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="حذف حساب کاربری"
        description={
          deleteTarget
            ? `آیا از حذف حساب «${deleteTarget.name}» مطمئن هستید؟ این عملیات بازگشت‌پذیر نیست و همه نشست‌های فعال کاربر نیز خروج داده می‌شوند.`
            : undefined
        }
        confirmLabel="حذف"
        destructive
        loading={deleteBusy}
        onConfirm={submitDelete}
      />

      {/* گفت‌وگوی انتقال مقالات پیش از حذف */}
      <Dialog
        open={transfer !== null}
        onOpenChange={(open) => {
          if (!open) setTransfer(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>انتقال مقالات و حذف کاربر</DialogTitle>
            <DialogDescription>
              {transfer
                ? `«${transfer.user.name}» نویسندهٔ ${toFa(transfer.user._count?.articles ?? 0)} مقاله است. مقالات به کدام کاربر منتقل شود؟`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {transfer ? (
            <div className="space-y-4">
              <Field label="انتقال مقالات به:" required htmlFor="transfer-user">
                <Select value={transfer.value} onValueChange={(v) => setTransfer((t) => (t ? { ...t, value: v } : t))}>
                  <SelectTrigger id="transfer-user" className="w-full">
                    <SelectValue placeholder="انتخاب کاربر مقصد…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {transfer.options.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} — {ROLE_LABELS[u.role as Role] ?? u.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTransfer(null)} disabled={transferBusy}>
                  انصراف
                </Button>
                <Button type="button" variant="destructive" onClick={submitTransfer} disabled={transferBusy || !transfer.value}>
                  {transferBusy ? 'در حال انجام…' : 'حذف و انتقال'}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
