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
  ListChecks,
  MessagesSquare,
  Plus,
  RefreshCw,
  Users,
  Wrench,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge, EmptyState, ErrorState, LoadingSpinner } from '@/components/shared/ui-bits'
import { OnboardingChecklist } from '@/components/shared/onboarding-checklist'
import { apiGet } from '@/lib/client/api'
import { faDateTime, shortFaDate, timeAgo, toFa } from '@/lib/client/format'
import { useAppStore, useCan } from '@/store/app-store'
import { articleStatusInfo } from '@/lib/constants'
import { navigate } from '@/hooks/use-hash-route'
import { cn } from '@/lib/utils'

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
  taskCounts: {
    awaitingReview: number
    overdueReviews: number
    openTasks: number
    overdueTasks: number
    needsRevision: number
    healthIssues: number
  }
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

const ACTION_ICONS: Record<string, React.ElementType> = {
  LOGIN: Users,
  LOGOUT: Users,
  CREATE: Plus,
  UPDATE: FileEdit,
  PUBLISH: CheckCircle2,
  SUBMIT_REVIEW: Clock,
  APPROVE: CheckCircle2,
  UPLOAD: ImageIcon,
  MODERATE: MessagesSquare,
}

/* رنگ کاشی هر شاخص — پالت زمردی/کهربایی/فیروزه‌ای/گلگون */
const KPI_TILES = [
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  'bg-amber-500/10 text-amber-600 dark:text-amber-500',
  'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  'bg-lime-500/10 text-lime-600 dark:text-lime-500',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  'bg-orange-500/10 text-orange-600 dark:text-orange-500',
]

function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
  tile,
  onClick,
}: {
  label: string
  value: number
  icon: React.ElementType
  hint?: string
  tile: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-lift text-start rounded-2xl border bg-card p-4 shadow-xs focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default group"
      disabled={!onClick}
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <div className={cn('rounded-xl p-2 transition-transform group-hover:scale-110', tile)}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
      </div>
      <p className="text-[26px] font-bold mt-2 tabular-nums leading-8">{toFa(value)}</p>
      {hint ? (
        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
          {hint}
          {onClick ? <ArrowLeft className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden /> : null}
        </p>
      ) : null}
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

  // جمله خلاصه مرکز کارها برای بنر خوش‌آمد
  const buildTaskSentence = (tc: DashboardData['taskCounts']): string => {
    const parts: string[] = []
    if (tc.awaitingReview > 0) parts.push(`${toFa(tc.awaitingReview)} مقاله منتظر بررسی شما`)
    if (tc.overdueReviews > 0) parts.push(`${toFa(tc.overdueReviews)} بازبینی محتوا از موعد گذشته`)
    if (tc.overdueTasks > 0) parts.push(`${toFa(tc.overdueTasks)} کار از موعد گذشته`)
    else if (tc.openTasks > 0) parts.push(`${toFa(tc.openTasks)} کار واگذارشده باز`)
    if (tc.needsRevision > 0) parts.push(`${toFa(tc.needsRevision)} مقاله نیازمند اصلاح`)
    if (tc.healthIssues > 0) parts.push(`${toFa(tc.healthIssues)} مورد در سلامت محتوا`)
    if (parts.length === 0) return 'هیچ اقدام فوری در انتظار شما نیست — همه‌چیز مرتب است.'
    return parts.join('، ') + ' دارید.'
  }

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
      {/* ── بنر خوش‌آمد گرادیانی ─────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground p-6 sm:p-7 shadow-md">
        <div className="absolute inset-0 bg-gradient-to-bl from-primary/30 via-transparent to-chart-3/15" aria-hidden />
        <div className="absolute inset-0 pattern-grid" aria-hidden />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-xs text-sidebar-foreground/60 mb-1.5">{faDateTime(data.generatedAt)}</p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {user?.name} عزیز، خوش آمدید
            </h1>
            <p className="text-sm text-sidebar-foreground/65 mt-1.5">
              {buildTaskSentence(data.taskCounts)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => navigate('/tasks')}
              className="gap-1.5 rounded-xl shadow-md shadow-primary/30 bg-primary hover:bg-primary/90"
            >
              <ListChecks className="h-4 w-4" />
              مرکز کارهای من
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/articles/new')}
              variant="outline"
              className="gap-1.5 rounded-xl border-sidebar-foreground/20 bg-sidebar-foreground/5 text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
            >
              <Plus className="h-4 w-4" />
              مقاله جدید
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={load}
              disabled={loading}
              className="gap-1.5 rounded-xl border-sidebar-foreground/20 bg-sidebar-foreground/5 text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              به‌روزرسانی
            </Button>
          </div>
        </div>
      </div>

      {/* ── راهنمای شروع کار متناسب با نقش ──────────────────────── */}
      <OnboardingChecklist />

      {/* ── شاخص‌های کلیدی ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <KpiCard label="کل مقالات" value={s.totalArticles} icon={FileText} tile={KPI_TILES[0]} onClick={() => navigate('/articles')} />
        <KpiCard label="منتشرشده" value={s.published} icon={CheckCircle2} hint="در دسترس عمومی" tile={KPI_TILES[1]} onClick={() => navigate('/articles')} />
        <KpiCard label="در انتظار بررسی" value={s.inReview} icon={Clock} hint="نیازمند بازبینی" tile={KPI_TILES[3]} onClick={hasReview ? () => navigate('/articles') : undefined} />
        <KpiCard label="بازدید کل" value={s.totalViews} icon={Eye} tile={KPI_TILES[2]} />
        <KpiCard label="دیدگاه در انتظار" value={s.pendingComments} icon={MessagesSquare} tile={KPI_TILES[4]} onClick={can('comments.moderate') ? () => navigate('/comments') : undefined} />
        <KpiCard label="کاربران فعال" value={s.totalUsers} icon={Users} tile={KPI_TILES[5]} onClick={can('users.manage') ? () => navigate('/users') : undefined} />
        <KpiCard label="فایل‌های رسانه" value={s.mediaCount} icon={ImageIcon} tile={KPI_TILES[6]} onClick={() => navigate('/media')} />
        <KpiCard label="پاسخ جدید فرم" value={s.newForms} icon={Wrench} tile={KPI_TILES[7]} onClick={can('forms.view') ? () => navigate('/forms') : undefined} />
      </div>

      {/* ── روند + وظایف ──────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* روند انتشار */}
        <Card className="lg:col-span-2 rounded-2xl shadow-xs">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="rounded-lg bg-primary/10 p-1.5 text-primary" aria-hidden>
                <FileText className="h-4 w-4" />
              </span>
              روند انتشار محتوا — ۱۴ روز گذشته
            </CardTitle>
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
                        <stop offset="0%" stopColor="currentColor" className="text-chart-1" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="currentColor" className="text-chart-1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
                    <Tooltip
                      contentStyle={{ direction: 'rtl', fontFamily: 'Vazirmatn, Tahoma', fontSize: 12, borderRadius: 12, borderColor: 'var(--border)' }}
                      formatter={(value) => [`${toFa(Number(value))} مقاله`, 'منتشرشده']}
                    />
                    <Area type="monotone" dataKey="count" stroke="currentColor" className="text-chart-1" strokeWidth={2.5} fill="url(#trendFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* وظایف کاربر */}
        <Card className="rounded-2xl shadow-xs">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="rounded-lg bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-500" aria-hidden>
                <Clock className="h-4 w-4" />
              </span>
              {hasReview ? 'در انتظار بررسی شما' : 'پیش‌نویس‌های من'}
            </CardTitle>
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
                    className="w-full text-start rounded-xl border p-3 transition hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring group"
                  >
                    <p className="text-sm font-medium line-clamp-1">{a.title}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-muted-foreground">
                        {a.author.name} · {timeAgo(a.updatedAt)}
                      </span>
                      <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:-translate-x-0.5 transition" aria-hidden />
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
                    className="w-full text-start rounded-xl border p-3 transition hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring group"
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

      {/* ── فعالیت‌های اخیر (خط زمانی) ─────────────────────────── */}
      <Card className="rounded-2xl shadow-xs card-accent-top">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="rounded-lg bg-violet-500/10 p-1.5 text-violet-600 dark:text-violet-400" aria-hidden>
                <Bell className="h-4 w-4" />
              </span>
              فعالیت‌های اخیر
            </CardTitle>
            <CardDescription>آخرین عملیات ثبت‌شده در سامانه</CardDescription>
          </div>
          {can('activity.view') ? (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate('/activity')}>
              مشاهده همه
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <EmptyState compact title="فعالیتی ثبت نشده" icon={<Inbox className="h-6 w-6" />} />
          ) : (
            <ul className="relative space-y-1">
              {data.recentActivity.map((log, idx) => {
                const ActionIcon = ACTION_ICONS[log.action] ?? Bell
                return (
                  <li key={log.id} className="relative flex items-start gap-3.5 pb-4 last:pb-0">
                    {/* خط اتصال خط زمانی */}
                    {idx < data.recentActivity.length - 1 ? (
                      <span className="absolute top-8 start-[15px] bottom-0 w-px bg-border" aria-hidden />
                    ) : null}
                    <span className="relative rounded-xl border bg-muted/60 p-1.5 shrink-0 text-muted-foreground">
                      <ActionIcon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-6">
                        <span className="font-semibold">{log.userName}</span>
                        <span className="text-muted-foreground"> — {ACTION_LABELS[log.action] ?? log.action}</span>
                        {log.entityTitle ? <span className="text-foreground/80"> «{log.entityTitle}»</span> : null}
                      </p>
                      {log.details ? <p className="text-xs text-muted-foreground mt-0.5">{log.details}</p> : null}
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 pt-1">{timeAgo(log.createdAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
