'use client'

import * as React from 'react'
import {
  BarChart3,
  ClipboardList,
  Download,
  FileText,
  FolderTree,
  MessagesSquare,
  RefreshCw,
  Users,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorState, LoadingSpinner, PageHeader, StatusBadge } from '@/components/shared/ui-bits'
import { apiGet } from '@/lib/client/api'
import { downloadCsv, faBytes, shortFaDate, toFa } from '@/lib/client/format'
import { ARTICLE_STATUSES, articleStatusInfo, COMMENT_STATUSES, FORM_STATUSES } from '@/lib/constants'
import { cn } from '@/lib/utils'

type ReportsData = {
  articlesByStatus: { status: string; count: number }[]
  articlesByCategory: { name: string; color: string; count: number }[]
  publishTrend: { date: string; count: number }[]
  topArticles: { id: string; title: string; views: number; status: string }[]
  commentsByStatus: { status: string; count: number }[]
  formsByStatus: { status: string; count: number }[]
  storageUsed: number
  mediaCount: number
  usersByRole: { role: string; label: string; count: number }[]
}

/** کارت شاخص کلیدی گزارش */
function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string
  value: number
  icon: React.ElementType
  hint?: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4" aria-label={`${label}: ${toFa(value)}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
        </div>
      </div>
      <p className="text-2xl font-bold mt-2 tabular-nums">{toFa(value)}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  )
}

/** ردیف نمودار میله‌ای افقی با Progress */
function BarRow({ label, count, max, dotColor }: { label: string; count: number; max: number; dotColor?: string }) {
  const percent = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm w-28 sm:w-36 shrink-0 flex items-center gap-1.5 min-w-0">
        {dotColor ? <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden /> : null}
        <span className="line-clamp-1">{label}</span>
      </span>
      <Progress value={percent} className="h-2 flex-1" aria-label={`${label}: ${toFa(count)}`} />
      <span className="text-sm font-medium tabular-nums w-10 text-end">{toFa(count)}</span>
    </div>
  )
}

/** لیست خلاصه وضعیت با نقطه رنگی */
function StatusSummaryList({
  items,
}: {
  items: { label: string; count: number; color: string }[]
}) {
  const total = items.reduce((a, b) => a + b.count, 0)
  if (total === 0) return <EmptyState compact title="داده‌ای ثبت نشده" />
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 min-w-0">
            <span className={cn('h-2 w-2 rounded-full shrink-0 bg-current', it.color)} aria-hidden />
            {it.label}
          </span>
          <span className="font-semibold tabular-nums">{toFa(it.count)}</span>
        </li>
      ))}
    </ul>
  )
}

export function ReportsView() {
  const [data, setData] = React.useState<ReportsData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<ReportsData>('/api/reports')
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت گزارش‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const exportTopArticles = () => {
    if (!data) return
    if (data.topArticles.length === 0) {
      toast.info('مقاله‌ای برای خروجی گرفتن وجود ندارد.')
      return
    }
    downloadCsv(
      'top-articles.csv',
      ['عنوان', 'بازدید', 'وضعیت'],
      data.topArticles.map((a) => [a.title, a.views, articleStatusInfo(a.status).label]),
    )
    toast.success('خروجی CSV پربازدیدترین مقالات آماده شد.')
  }

  if (loading && !data) return <LoadingSpinner label="در حال بارگذاری گزارش‌ها…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const totalUsers = data.usersByRole.reduce((a, b) => a + b.count, 0)
  const totalComments = data.commentsByStatus.reduce((a, b) => a + b.count, 0)
  const totalForms = data.formsByStatus.reduce((a, b) => a + b.count, 0)
  const maxStatusCount = Math.max(...data.articlesByStatus.map((s) => s.count), 1)
  const maxCategoryCount = Math.max(...data.articlesByCategory.map((c) => c.count), 1)
  const totalArticles = data.articlesByStatus.reduce((a, b) => a + b.count, 0)
  const trendData = data.publishTrend.map((t) => ({ ...t, label: shortFaDate(t.date) }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="گزارش‌ها"
        description="نمای کلی آمار محتوا، کاربران و تعامل‌های سامانه"
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              به‌روزرسانی
            </Button>
            <Button variant="outline" onClick={exportTopArticles} disabled={exporting} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              خروجی CSV
            </Button>
          </>
        }
      />

      {/* شاخص‌های کلیدی */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="کل فایل‌های رسانه" value={data.mediaCount} icon={FolderTree} hint={faBytes(data.storageUsed)} />
        <KpiCard label="کل کاربران" value={totalUsers} icon={Users} />
        <KpiCard label="کل دیدگاه‌ها" value={totalComments} icon={MessagesSquare} />
        <KpiCard label="کل پاسخ‌های فرم" value={totalForms} icon={ClipboardList} />
      </div>

      {/* روند انتشار ۳۰ روز اخیر */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">روند انتشار — ۳۰ روز گذشته</CardTitle>
          <CardDescription>تعداد مقالات منتشرشده در هر روز (منطقه زمانی تهران)</CardDescription>
        </CardHeader>
        <CardContent dir="ltr">
          {trendData.every((t) => t.count === 0) ? (
            <div className="h-56 flex items-center justify-center">
              <EmptyState
                compact
                title="در این بازه مطلبی منتشر نشده"
                description="با انتشار مقاله، نمودار روند در اینجا نمایش داده می‌شود."
                icon={<FileText className="h-6 w-6" />}
              />
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="reportsTrendFill" x1="0" y1="0" x2="0" y2="1">
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
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="currentColor"
                    className="text-primary"
                    strokeWidth={2}
                    fill="url(#reportsTrendFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* مقالات به تفکیک وضعیت */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">مقالات به تفکیک وضعیت</CardTitle>
            <CardDescription>مجموع {toFa(totalArticles)} مقاله در گردش کار محتوا</CardDescription>
          </CardHeader>
          <CardContent>
            {totalArticles === 0 ? (
              <EmptyState compact title="مقاله‌ای ثبت نشده" icon={<FileText className="h-6 w-6" />} />
            ) : (
              <div className="space-y-3">
                {ARTICLE_STATUSES.map((s) => {
                  const count = data.articlesByStatus.find((x) => x.status === s.value)?.count ?? 0
                  return <BarRow key={s.value} label={s.label} count={count} max={maxStatusCount} />
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* مقالات به تفکیک دسته‌بندی */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">مقالات به تفکیک دسته‌بندی</CardTitle>
            <CardDescription>توزیع محتوا میان دسته‌بندی‌ها</CardDescription>
          </CardHeader>
          <CardContent>
            {data.articlesByCategory.length === 0 ? (
              <EmptyState compact title="دسته‌بندی‌ای ثبت نشده" icon={<FolderTree className="h-6 w-6" />} />
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto pe-1">
                {data.articlesByCategory.map((c) => (
                  <BarRow key={c.name} label={c.name} count={c.count} max={maxCategoryCount} dotColor={c.color} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* پربازدیدترین مقالات */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">پربازدیدترین مقالات</CardTitle>
            <CardDescription>۵ مقاله با بیشترین بازدید</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topArticles.length === 0 ? (
              <EmptyState compact title="مقاله‌ای ثبت نشده" icon={<BarChart3 className="h-6 w-6" />} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>عنوان</TableHead>
                    <TableHead className="text-center">بازدید</TableHead>
                    <TableHead className="text-end">وضعیت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topArticles.map((a) => {
                    const info = articleStatusInfo(a.status)
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="max-w-56">
                          <span className="text-sm font-medium line-clamp-1">{a.title}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm font-bold tabular-nums">{toFa(a.views)}</span>
                        </TableCell>
                        <TableCell className="text-end">
                          <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* دیدگاه‌ها */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">دیدگاه‌ها</CardTitle>
              <CardDescription>به تفکیک وضعیت بازبینی</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusSummaryList
                items={COMMENT_STATUSES.map((s) => ({
                  label: s.label,
                  count: data.commentsByStatus.find((x) => x.status === s.value)?.count ?? 0,
                  color: s.color,
                }))}
              />
            </CardContent>
          </Card>

          {/* پاسخ‌های فرم */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">پاسخ‌های فرم</CardTitle>
              <CardDescription>به تفکیک وضعیت پیگیری</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusSummaryList
                items={FORM_STATUSES.map((s) => ({
                  label: s.label,
                  count: data.formsByStatus.find((x) => x.status === s.value)?.count ?? 0,
                  color: s.color,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* کاربران به تفکیک نقش */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">کاربران به تفکیک نقش</CardTitle>
          <CardDescription>مجموع {toFa(totalUsers)} کاربر ثبت‌شده</CardDescription>
        </CardHeader>
        <CardContent>
          {totalUsers === 0 ? (
            <EmptyState compact title="کاربری ثبت نشده" icon={<Users className="h-6 w-6" />} />
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {data.usersByRole.map((r) => (
                <li key={r.role} className="rounded-lg border p-3 text-center">
                  <p className="text-xl font-bold tabular-nums">{toFa(r.count)}</p>
                  <Badge variant="secondary" className="mt-1.5">
                    {r.label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
