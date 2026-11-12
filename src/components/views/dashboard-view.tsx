'use client'

import * as React from 'react'
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock,
  Eye,
  FileEdit,
  FileText,
  Image as ImageIcon,
  Inbox,
  MessagesSquare,
  RefreshCw,
  Users,
  Wrench,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge, EmptyState, ErrorState, LoadingSpinner } from '@/components/shared/ui-bits'
import { apiGet } from '@/lib/client/api'
import { faDateTime, shortFaDate, timeAgo, toFa } from '@/lib/client/format'
import { useAppStore, useCan } from '@/store/app-store'
import { articleStatusInfo } from '@/lib/constants'
import { navigate } from '@/hooks/use-hash-route'

type DashboardData = {
  stats: {
    totalArticles: number
    published: number
    drafts: number
    inReview: number
    pendingComments: number
    totalUsers: number
    mediaCount: number
    newForms: number
    totalViews: number
  }
  trend: { date: string; count: number }[]
  recentActivity: { id: string; userName: string; action: string; entityTitle: string | null; details: string | null; createdAt: string }[]
  pendingReview: { id: string; title: string; status: string; updatedAt: string; author: { name: string } }[]
  myDrafts: { id: string; title: string; status: string; updatedAt: string }[]
  generatedAt: string
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'ورود به سامانه',
  LOGOUT: 'خروج از سامانه',
  CREATE: 'ایجاد',
  UPDATE: 'ویرایش',
  DELETE: 'حذف',
  PUBLISH: 'انتشار',
  UNPUBLISH: 'لغو انتشار',
  ARCHIVE: 'بایگانی',
  SUBMIT_REVIEW: 'ارسال برای بازبینی',
  APPROVE: 'تأیید',
  REJECT: 'بازگشت برای اصلاح',
  UPLOAD: 'بارگذاری فایل',
  RESTORE: 'بازگردانی نسخه',
  MODERATE: 'بازبینی دیدگاه',
}

function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
  onClick,
}: {
  label: string
  value: number
  icon: React.ElementType
  hint?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-start rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      disabled={!onClick}
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
        </div>
      </div>
      <p className="text-2xl font-bold mt-2 tabular-nums">{toFa(value)}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </button>
  )
}

export function DashboardView() {
  const [data, setData] = React.useState<DashboardData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const user = useAppStore((s) => s.user)
  const can = useCan()
  const hasReview = can('articles.review')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<DashboardData>('/api/dashboard')
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت اطلاعات داشبورد')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  if (loading && !data) return <LoadingSpinner label="در حال بارگذاری داشبورد…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const s = data.stats
  const trendData = data.trend.map((t) => ({ ...t, label: shortFaDate(t.date) }))

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">داشبورد</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {user?.name} عزیز، خوش آمدید. آخرین به‌روزرسانی: {faDateTime(data.generatedAt)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 w-fit">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          به‌روزرسانی
        </Button>
      </div>

      {/* شاخص‌های کلیدی */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="کل مقالات" value={s.totalArticles} icon={FileText} onClick={() => navigate('/articles')} />
        <KpiCard label="منتشرشده" value={s.published} icon={CheckCircle2} hint="در دسترس عمومی" onClick={() => navigate('/articles')} />
        <KpiCard label="در انتظار بررسی" value={s.inReview} icon={Clock} hint="نیازمند بازبینی" onClick={hasReview ? () => navigate('/articles') : undefined} />
        <KpiCard label="بازدید کل" value={s.totalViews} icon={Eye} />
        <KpiCard label="دیدگاه در انتظار" value={s.pendingComments} icon={MessagesSquare} onClick={can('comments.moderate') ? () => navigate('/comments') : undefined} />
        <KpiCard label="کاربران فعال" value={s.totalUsers} icon={Users} onClick={can('users.manage') ? () => navigate('/users') : undefined} />
        <KpiCard label="فایل‌های رسانه" value={s.mediaCount} icon={ImageIcon} onClick={() => navigate('/media')} />
        <KpiCard label="پاسخ جدید فرم" value={s.newForms} icon={Wrench} onClick={can('forms.view') ? () => navigate('/forms') : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* روند انتشار */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">روند انتشار محتوا — ۱۴ روز گذشته</CardTitle>
            <CardDescription>تعداد مقالات منتشرشده در هر روز (منطقه زمانی تهران)</CardDescription>
          </CardHeader>
          <CardContent dir="ltr">
            {trendData.every((t) => t.count === 0) ? (
              <div className="h-56 flex items-center justify-center">
                <EmptyState compact title="هنوز مطلبی در این بازه منتشر نشده" description="با انتشار یک مقاله، روند اینجا نمایش داده می‌شود." icon={<FileText className="h-6 w-6" />} />
              </div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" className="text-primary" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="currentColor" className="text-primary" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
                    <Tooltip
                      contentStyle={{ direction: 'rtl', fontFamily: 'Vazirmatn, Tahoma', fontSize: 12, borderRadius: 8 }}
                      formatter={(value) => [`${toFa(Number(value))} مقاله`, 'منتشرشده']}
                    />
                    <Area type="monotone" dataKey="count" stroke="currentColor" className="text-primary" strokeWidth={2} fill="url(#trendFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* وظایف کاربر */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{hasReview ? 'در انتظار بررسی شما' : 'پیش‌نویس‌های من'}</CardTitle>
            <CardDescription>{hasReview ? 'محتوایی که منتظر تأیید یا انتشار است' : 'محتوای نیمه‌تمام شما'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {hasReview ? (
              data.pendingReview.length === 0 ? (
                <EmptyState compact title="صف بازبینی خالی است" icon={<CheckCircle2 className="h-6 w-6" />} />
              ) : (
                data.pendingReview.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => navigate(`/articles/${a.id}/edit`)}
                    className="w-full text-start rounded-lg border p-3 hover:border-primary/40 transition focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="text-sm font-medium line-clamp-1">{a.title}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-muted-foreground">
                        {a.author.name} · {timeAgo(a.updatedAt)}
                      </span>
                      <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </div>
                  </button>
                ))
              )
            ) : data.myDrafts.length === 0 ? (
              <EmptyState compact title="پیش‌نویسی ندارید" icon={<FileEdit className="h-6 w-6" />} />
            ) : (
              data.myDrafts.map((a) => {
                const info = articleStatusInfo(a.status)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => navigate(`/articles/${a.id}/edit`)}
                    className="w-full text-start rounded-lg border p-3 hover:border-primary/40 transition focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="text-sm font-medium line-clamp-1">{a.title}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
                      <span className="text-xs text-muted-foreground">{timeAgo(a.updatedAt)}</span>
                    </div>
                  </button>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* فعالیت‌های اخیر */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">فعالیت‌های اخیر</CardTitle>
            <CardDescription>آخرین عملیات ثبت‌شده در سامانه</CardDescription>
          </div>
          {can('activity.view') ? (
            <Button variant="ghost" size="sm" onClick={() => navigate('/activity')}>
              مشاهده همه
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <EmptyState compact title="فعالیتی ثبت نشده" icon={<Inbox className="h-6 w-6" />} />
          ) : (
            <ul className="divide-y">
              {data.recentActivity.map((log) => (
                <li key={log.id} className="flex items-start gap-3 py-2.5">
                  <div className="rounded-full bg-muted p-1.5 shrink-0">
                    <Bell className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{log.userName}</span> — {ACTION_LABELS[log.action] ?? log.action}
                      {log.entityTitle ? <span className="text-muted-foreground"> · {log.entityTitle}</span> : null}
                    </p>
                    {log.details ? <p className="text-xs text-muted-foreground mt-0.5">{log.details}</p> : null}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(log.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
