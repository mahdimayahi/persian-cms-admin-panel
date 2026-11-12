'use client'

/**
 * بخش «عملکرد» در صفحهٔ جزئیات محتوا (مرحله ۴)
 * خلاصهٔ نتیجهٔ هدف‌های تعریف‌شده برای این محتوا: دسترسی، نتیجه، روند و کیفیت داده
 * نمایش «داده نداریم» به شکل «نتیجهٔ صفر» ممنوع است
 */

import * as React from 'react'
import { Eye, Target, TrendingUp, Users } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, LoadingSpinner, StatusBadge } from '@/components/shared/ui-bits'
import { apiGet } from '@/lib/client/api'
import { shortFaDate, toFa } from '@/lib/client/format'
import { cn } from '@/lib/utils'

type Performance = {
  goal: { id: string; title: string; metricLabel: string; status: string }
  views: number
  measurableVisitors: number
  conversions: number
  conversionRate: number | null
  hasSufficientData: boolean
  trend: { day: string; views: number; conversions: number }[]
  timezone: string
}

function pct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  return `${toFa(n * 100, { maximumFractionDigits: 1 })}٪`
}

function MiniTrend({ trend }: { trend: Performance['trend'] }) {
  if (trend.length === 0) return null
  const data = trend.map((t) => ({ ...t, label: shortFaDate(t.day) }))
  return (
    <div className="h-36 w-full" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" className="text-chart-1" stopOpacity={0.3} />
              <stop offset="100%" stopColor="currentColor" className="text-chart-1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={32} allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 12, direction: 'rtl', backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            formatter={(value: number | string, name: string) => [toFa(Number(value)), name === 'views' ? 'مشاهده' : 'تبدیل']}
          />
          <Area type="monotone" dataKey="views" name="views" stroke="currentColor" className="text-chart-1" strokeWidth={2} fill="url(#perfFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ArticlePerformancePanel({ articleId }: { articleId: string }) {
  const [performances, setPerformances] = React.useState<Performance[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ performances: Performance[] }>(`/api/articles/${articleId}/performance`)
      setPerformances(res.performances)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت عملکرد')
    } finally {
      setLoading(false)
    }
  }, [articleId])

  React.useEffect(() => {
    load()
  }, [load])

  if (loading) return <LoadingSpinner label="در حال محاسبهٔ عملکرد…" />
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!performances || performances.length === 0) {
    return (
      <EmptyState
        compact
        title="برای این محتوا هدفی تعریف نشده است"
        description="با تعریف هدف، نتیجهٔ محتوا به رویداد موفقیت کسب‌وکار متصل می‌شود. از بخش «اهداف و نتایج محتوا» هدف را تعریف کنید."
      />
    )
  }

  return (
    <div className="space-y-4">
      {performances.map((p) => (
        <Card key={p.goal.id}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-primary" aria-hidden />
                {p.goal.title}
              </CardTitle>
              <StatusBadge
                label={p.goal.status === 'ACTIVE' ? 'فعال' : 'موقتاً متوقف'}
                colorClass={p.goal.status === 'ACTIVE' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}
                bgClass={p.goal.status === 'ACTIVE' ? 'bg-emerald-100 dark:bg-emerald-950' : 'bg-amber-100 dark:bg-amber-950'}
              />
            </div>
            <CardDescription>بازهٔ ۷ روز اخیر — منطقهٔ زمانی {p.timezone} — شاخص: {p.goal.metricLabel}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!p.hasSufficientData ? (
              <Alert>
                <AlertDescription className="text-xs leading-6">
                  در این بازه مخاطبِ قابل‌اندازه‌گیری ثبت نشده است؛ «داده نداشتن» به معنی «نتیجهٔ صفر» نیست.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  مشاهدهٔ محتوا
                </div>
                <p className="text-xl font-bold tabular-nums mt-1">{toFa(p.views)}</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  مخاطب قابل‌اندازه‌گیری
                </div>
                <p className="text-xl font-bold tabular-nums mt-1">{toFa(p.measurableVisitors)}</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                  تبدیل‌های یکتا
                </div>
                <p className="text-xl font-bold tabular-nums mt-1">{toFa(p.conversions)}</p>
              </div>
              <div className={cn('rounded-xl border p-3', p.hasSufficientData ? 'bg-muted/30' : 'bg-muted/20')}>
                <p className="text-xs text-muted-foreground">نرخ تبدیل</p>
                <p className="text-xl font-bold tabular-nums mt-1">{p.hasSufficientData ? pct(p.conversionRate) : 'دادهٔ کافی نیست'}</p>
              </div>
            </div>
            <MiniTrend trend={p.trend} />
            <p className="text-xs text-muted-foreground leading-6">
              تغییر شاخص علت را اثبات نمی‌کند؛ سنجش اثر تغییرات از طریق «آزمایش A/B» انجام می‌شود. گزارش با مجوزهای شما محدود است و بدون دادهٔ شخصی محاسبه می‌شود.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
