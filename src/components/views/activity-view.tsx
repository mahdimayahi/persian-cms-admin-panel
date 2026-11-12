'use client'

import * as React from 'react'
import { History, ScrollText } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type Column } from '@/components/shared/data-table'
import { EmptyState, ErrorState, LoadingSpinner, PageHeader, SearchInput } from '@/components/shared/ui-bits'
import { apiGet, type PagedResponse } from '@/lib/client/api'
import { faDateTime, timeAgo, toFa } from '@/lib/client/format'

type ActivityRow = {
  id: string
  userName: string
  action: string
  entityType: string
  entityId: string | null
  entityTitle: string | null
  details: string | null
  createdAt: string
}

type ActivityResponse = PagedResponse<ActivityRow> & { actions: string[] }

/** برچسب فارسی عملیات‌ها (در صورت نبود مقدار، متن خام نمایش داده می‌شود) */
const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'ورود',
  LOGOUT: 'خروج',
  CREATE: 'ایجاد',
  UPDATE: 'ویرایش',
  DELETE: 'حذف',
  PUBLISH: 'انتشار',
  UNPUBLISH: 'لغو انتشار',
  ARCHIVE: 'بایگانی',
  SUBMIT_REVIEW: 'ارسال برای بازبینی',
  APPROVE: 'تأیید',
  REJECT: 'بازگشت برای اصلاح',
  CHANGE_PASSWORD: 'تغییر رمز عبور',
  RESET_PASSWORD: 'بازیابی رمز',
  REVOKE_SESSIONS: 'خروج نشست‌ها',
  UPLOAD: 'بارگذاری فایل',
  RESTORE: 'بازگردانی نسخه',
  MODERATE: 'بازبینی دیدگاه',
}

const ENTITY_LABELS: Record<string, string> = {
  ARTICLE: 'مقاله',
  USER: 'کاربر',
  MEDIA: 'رسانه',
  SETTINGS: 'تنظیمات',
  COMMENT: 'دیدگاه',
  FORM: 'فرم',
  SESSION: 'نشست',
  ROLE: 'نقش',
}

/** فهرست پیش‌فرض عملیات‌ها (پس از دریافت از API به‌روزرسانی می‌شود) */
const DEFAULT_ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'CREATE',
  'UPDATE',
  'DELETE',
  'PUBLISH',
  'UNPUBLISH',
  'ARCHIVE',
  'SUBMIT_REVIEW',
  'APPROVE',
  'REJECT',
  'CHANGE_PASSWORD',
  'RESET_PASSWORD',
  'REVOKE_SESSIONS',
  'UPLOAD',
  'RESTORE',
  'MODERATE',
]

const ENTITY_TYPES = ['ARTICLE', 'USER', 'MEDIA', 'SETTINGS', 'COMMENT', 'FORM', 'SESSION', 'ROLE']

const ALL = '__ALL__'

export function ActivityView() {
  const [list, setList] = React.useState<ActivityResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // ─── فیلترها و صفحه‌بندی ────────────────────────────────────────
  const [qInput, setQInput] = React.useState('')
  const [q, setQ] = React.useState('')
  const [action, setAction] = React.useState('')
  const [entityType, setEntityType] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [actions, setActions] = React.useState<string[]>(DEFAULT_ACTIONS)

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
      if (action) params.set('action', action)
      if (entityType) params.set('entityType', entityType)
      const res = await apiGet<ActivityResponse>(`/api/activity?${params.toString()}`)
      setList(res)
      if (Array.isArray(res.actions) && res.actions.length > 0) setActions(res.actions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت تاریخچه فعالیت‌ها')
    } finally {
      setLoading(false)
    }
  }, [q, action, entityType, page, pageSize])

  React.useEffect(() => {
    load()
  }, [load])

  const columns: Column<ActivityRow>[] = [
    {
      key: 'user',
      header: 'کاربر',
      render: (r) => <span className="text-sm font-medium whitespace-nowrap">{r.userName}</span>,
    },
    {
      key: 'action',
      header: 'عملیات',
      render: (r) => <Badge variant="outline">{ACTION_LABELS[r.action] ?? r.action}</Badge>,
    },
    {
      key: 'entity',
      header: 'موضوع',
      render: (r) => (
        <div className="min-w-0 max-w-52">
          <p className="text-sm line-clamp-1">{r.entityTitle ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{ENTITY_LABELS[r.entityType] ?? r.entityType}</p>
        </div>
      ),
    },
    {
      key: 'details',
      header: 'جزئیات',
      render: (r) => (
        <span className="text-sm text-muted-foreground line-clamp-1 block max-w-56">
          {r.details ?? '—'}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'زمان',
      render: (r) => (
        <div className="whitespace-nowrap">
          <p className="text-sm">{faDateTime(r.createdAt)}</p>
          <p className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</p>
        </div>
      ),
    },
  ]

  if (loading && !list) return <LoadingSpinner label="در حال بارگذاری تاریخچه…" />
  if (error && !list) return <ErrorState message={error} onRetry={load} />

  return (
    <div>
      <PageHeader
        title="تاریخچه فعالیت‌ها"
        description="ثبت عملیات کاربران برای پاسخ‌گویی و ردگیری تغییرات (Audit Log)"
        icon={<History className="h-5 w-5" />}
      />

      <Alert className="mb-4">
        <ScrollText className="h-4 w-4" />
        <AlertDescription>
          این تاریخچه از ویرایش عادی مصون است و کلیدهای محرمانه در آن ثبت نمی‌شود.
        </AlertDescription>
      </Alert>

      {/* نوار فیلتر */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <SearchInput value={qInput} onChange={setQInput} placeholder="جست‌وجوی کاربر یا موضوع…" className="sm:max-w-xs" />
        <Select
          value={action || ALL}
          onValueChange={(v) => {
            setAction(v === ALL ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="فیلتر عملیات">
            <SelectValue placeholder="عملیات" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>همه عملیات‌ها</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {ACTION_LABELS[a] ?? a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={entityType || ALL}
          onValueChange={(v) => {
            setEntityType(v === ALL ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="فیلتر نوع موجودیت">
            <SelectValue placeholder="نوع موجودیت" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>همه موجودیت‌ها</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ENTITY_LABELS[t]}
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
            title="فعالیتی ثبت نشده"
            description="با تغییر فیلترها یا انجام عملیات در سامانه، رکوردهای جدید اینجا نمایش داده می‌شود."
            icon={<History className="h-6 w-6" />}
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
        itemLabel="رویداد"
      />

      <p className="text-xs text-muted-foreground mt-2">
        مجموع {toFa(list?.total ?? 0)} رویداد ثبت‌شده — نمایش به‌صورت نزولی بر اساس زمان.
      </p>
    </div>
  )
}
