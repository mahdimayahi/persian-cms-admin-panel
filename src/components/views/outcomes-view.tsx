'use client'

/**
 * نمای «اهداف و نتایج محتوا» (مرحله ۴ — سنجش نتیجه)
 * - تعریف هدف با قرارداد شاخص شفاف (صورت/مخرج/انتساب/بازه/مسئول)
 * - داشبورد عملکرد: دسترسی، تعامل، نتیجه، قیف ساده، روند، کیفیت داده و سابقهٔ انتشار
 * - اصل تفسیر: تغییر نشان داده می‌شود اما اثر بدون آزمایش اثبات نمی‌شود؛ «داده نداریم» ≠ «نتیجهٔ صفر»
 * - شبیه‌ساز ترافیک نمایشی برای اعتبارسنجی قرارداد رویداد (با نشانهٔ «شبیه‌سازی‌شده»)
 */

import * as React from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Eye,
  FlaskConical,
  Gauge,
  History,
  Info,
  ListFilter,
  MousePointerClick,
  Play,
  RefreshCw,
  ShieldOff,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorState, Field, LoadingSpinner, PageHeader, StatusBadge } from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiPut } from '@/lib/client/api'
import { faDateTime, shortFaDate, timeAgo, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { cn } from '@/lib/utils'

// ─── انواع داده ──────────────────────────────────────────────────

type ArticleLite = { id: string; title: string; slug: string; status: string }

type Goal = {
  id: string
  title: string
  contentId: string
  primaryGoal: string
  successEvent: string
  metricLabel: string
  metricNumerator: string
  metricDenominator: string
  attributionRule: string
  attributionHours: number
  ownerUserId: string | null
  ownerName: string | null
  status: string
  createdByName: string
  createdAt: string
  article?: ArticleLite
}

type GoalReport = {
  range: { days: number; fromDay: string; toDay: string; timezone: string }
  access: { views: number; measurableVisitors: number; totalVisitors: number }
  engagement: { ctaVisitors: number; formStartVisitors: number }
  outcome: {
    conversions: number
    conversionVisitors: number
    conversionRate: number | null
    rateCi: [number, number] | null
    previousRate: number | null
  }
  funnel: { key: string; label: string; visitors: number; shareOfFirst: number; dropFromPrevPct: number | null }[]
  trend: { day: string; views: number; conversions: number }[]
  quality: {
    hasSufficientData: boolean
    coveragePercent: number | null
    excludedInternalViews: number
    excludedBotViews: number
    noConsentVisitors: number
    lastEventAt: string | null
    notes: string[]
  }
}

type PublishHistoryItem = { kind: 'VERSION' | 'PUBLISH'; label: string; at: string; by: string | null }

type GoalReportResponse = {
  goal: Goal
  report: GoalReport
  publishHistory: PublishHistoryItem[]
  experiments: { id: string; title: string; status: string; decision: string | null; changeType: string }[]
}

type QualityResponse = {
  timezone: string
  today: string
  totals: { events: number; views: number }
  excluded: { internal: number; bots: number; noConsent: number }
  coveragePercent: number | null
  ingest: { accepted24h: number; duplicates24h: number; invalid24h: number; duplicatesTotal: number }
  updateDelayMinutes: number | null
  lastEventAt: string | null
  notes: string[]
}

type RecentEvent = {
  eventId: string
  eventType: string
  occurredAt: string
  contentId: string | null
  visitorId: string
  referrer: string
  variantGroup: string | null
  isInternal: boolean
  isBot: boolean
  isConsented: boolean
  isSimulated: boolean
}

type AssignableUser = { id: string; name: string; roleLabel: string }

const EVENT_TYPE_LABELS: Record<string, string> = {
  PAGE_VIEW: 'مشاهده محتوا',
  CTA_CLICK: 'کلیک فراخوان',
  FORM_START: 'شروع فرم',
  FORM_SUCCESS: 'ثبت موفق فرم',
  FORM_INVALID: 'ثبت نامعتبر',
  SIGNUP: 'ثبت‌نام موفق',
  PURCHASE: 'خرید موفق',
}

const SUCCESS_EVENT_OPTIONS = [
  { value: 'FORM_SUCCESS', label: 'ثبت موفق فرم (درخواست/تماس)' },
  { value: 'SIGNUP', label: 'ثبت‌نام موفق' },
  { value: 'PURCHASE', label: 'خرید موفق' },
]

const GOAL_STATUS_INFO: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE: { label: 'فعال', color: 'text-success', bg: 'bg-success/10' },
  PAUSED: { label: 'موقتاً متوقف', color: 'text-warning', bg: 'bg-warning/10' },
  ARCHIVED: { label: 'بایگانی‌شده', color: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800' },
}

function goalStatusInfo(status: string) {
  return GOAL_STATUS_INFO[status] ?? GOAL_STATUS_INFO.ACTIVE
}

const ATTRIBUTION_LABELS: Record<string, string> = {
  AFTER_FIRST_VIEW: 'پس از اولین مشاهده (پنجرهٔ انتساب)',
  SAME_SESSION: 'در همان نشست مشاهده',
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${toFa(n * 100, { maximumFractionDigits: digits })}٪`
}

function pctAbs(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${toFa(n, { maximumFractionDigits: digits })} واحد درصد`
}

// ─── کارت شاخص ───────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string
  hint?: string
  icon: React.ElementType
}) {
  return (
    <div className="rounded-xl border bg-card p-4" aria-label={`${label}: ${value}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
        </div>
      </div>
      <p className="text-2xl font-bold mt-2 tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  )
}

// ─── قیف ساده ────────────────────────────────────────────────────

function FunnelPanel({ funnel }: { funnel: GoalReport['funnel'] }) {
  const max = funnel[0]?.visitors ?? 0
  return (
    <div className="space-y-3">
      {funnel.map((step, i) => (
        <div key={step.key} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary shrink-0" aria-hidden>
                {toFa(i + 1)}
              </span>
              <span className="line-clamp-1">{step.label}</span>
            </span>
            <span className="tabular-nums font-semibold whitespace-nowrap">
              {toFa(step.visitors)} بازدیدکننده
              <span className="text-xs font-normal text-muted-foreground ms-2">{pct(step.shareOfFirst)}</span>
            </span>
          </div>
          <Progress
            value={max > 0 ? (step.visitors / max) * 100 : 0}
            className="h-2.5"
            aria-label={`${step.label}: ${toFa(step.visitors)}`}
          />
          {step.dropFromPrevPct !== null && step.dropFromPrevPct > 0 ? (
            <p className="text-xs text-muted-foreground ps-8">
              افت از گام قبل: {pct(step.dropFromPrevPct)} — محل افت را نشان می‌دهد اما علت افت را اثبات نمی‌کند.
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ─── نمودار روند ─────────────────────────────────────────────────

function TrendChart({ trend }: { trend: GoalReport['trend'] }) {
  if (trend.length === 0) return <EmptyState compact title="دادهٔ روندی در این بازه ثبت نشده است" />
  const data = trend.map((t) => ({ ...t, label: shortFaDate(t.day) }))
  return (
    <div className="h-56 w-full" dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" className="text-chart-1" stopOpacity={0.3} />
              <stop offset="100%" stopColor="currentColor" className="text-chart-1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" className="text-chart-3" stopOpacity={0.4} />
              <stop offset="100%" stopColor="currentColor" className="text-chart-3" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={38} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={34} allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 12, direction: 'rtl', backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            formatter={(value: number | string, name: string) => [toFa(Number(value)), name === 'views' ? 'مشاهده' : 'تبدیل']}
          />
          <Area yAxisId="left" type="monotone" dataKey="views" name="views" stroke="currentColor" className="text-chart-1" strokeWidth={2} fill="url(#viewsFill)" />
          <Area yAxisId="right" type="monotone" dataKey="conversions" name="conversions" stroke="currentColor" className="text-chart-3" strokeWidth={2} fill="url(#convFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── گفت‌وگوی تعریف هدف ──────────────────────────────────────────

type GoalFormState = {
  title: string
  contentId: string
  primaryGoal: string
  successEvent: string
  metricLabel: string
  metricNumerator: string
  metricDenominator: string
  attributionRule: string
  attributionHours: string
  ownerUserId: string
}

const METRIC_PRESETS: Record<string, { metricLabel: string; metricNumerator: string; metricDenominator: string }> = {
  FORM_SUCCESS: {
    metricLabel: 'نرخ ثبت درخواست مشاوره',
    metricNumerator: 'بازدیدکنندگان واجد شرایط (بدون ترافیک داخلی و ربات، دارای رضایت ردیابی) که «ثبت موفق فرم» را در پنجرهٔ انتساب پس از اولین مشاهده ثبت کرده‌اند',
    metricDenominator: 'بازدیدکنندگان واجد شرایط که در بازهٔ گزارش صفحه را مشاهده کرده‌اند',
  },
  SIGNUP: {
    metricLabel: 'نرخ ثبت‌نام',
    metricNumerator: 'بازدیدکنندگان واجد شرایط که «ثبت‌نام موفق» را در پنجرهٔ انتساب پس از اولین مشاهده ثبت کرده‌اند',
    metricDenominator: 'بازدیدکنندگان واجد شرایط که در بازهٔ گزارش صفحه را مشاهده کرده‌اند',
  },
  PURCHASE: {
    metricLabel: 'نرخ خرید',
    metricNumerator: 'بازدیدکنندگان واجد شرایط که «خرید موفق» را در پنجرهٔ انتساب پس از اولین مشاهده ثبت کرده‌اند',
    metricDenominator: 'بازدیدکنندگان واجد شرایط که در بازهٔ گزارش صفحه را مشاهده کرده‌اند',
  },
}

function CreateGoalDialog({
  open,
  onOpenChange,
  articles,
  users,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  articles: ArticleLite[]
  users: AssignableUser[]
  onCreated: () => void
}) {
  const [form, setForm] = React.useState<GoalFormState>({
    title: '',
    contentId: '',
    primaryGoal: '',
    successEvent: 'FORM_SUCCESS',
    metricLabel: METRIC_PRESETS.FORM_SUCCESS.metricLabel,
    metricNumerator: METRIC_PRESETS.FORM_SUCCESS.metricNumerator,
    metricDenominator: METRIC_PRESETS.FORM_SUCCESS.metricDenominator,
    attributionRule: 'AFTER_FIRST_VIEW',
    attributionHours: '24',
    ownerUserId: '',
  })
  const [submitting, setSubmitting] = React.useState(false)

  const setField = (key: keyof GoalFormState, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const onEventChange = (v: string) => {
    const preset = METRIC_PRESETS[v]
    setForm((f) => ({
      ...f,
      successEvent: v,
      metricLabel: preset.metricLabel,
      metricNumerator: preset.metricNumerator,
      metricDenominator: preset.metricDenominator,
    }))
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      await apiPost('/api/goals', {
        ...form,
        attributionHours: Number(form.attributionHours) || 24,
        ownerUserId: form.ownerUserId || undefined,
      })
      toast.success('هدف تعریف شد. گزارش نتیجه پس از ثبت رویدادها در دسترس است.')
      onOpenChange(false)
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در تعریف هدف')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعریف هدف برای محتوا</DialogTitle>
          <DialogDescription>
            هدف را به رویداد موفقیت مشخص و شاخصی با تعریف ثابت صورت و مخرج متصل کنید. کلیک روی «ارسال فرم» با ثبت موفق فرم یکسان نیست؛ موفقیت در محل معتبر تأیید می‌شود.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field label="عنوان هدف" required htmlFor="goal-title">
            <Input id="goal-title" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="مثلاً: افزایش درخواست مشاوره از صفحهٔ معرفی خدمت" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="محتوای هدف" required>
              <Select value={form.contentId} onValueChange={(v) => setField('contentId', v)}>
                <SelectTrigger aria-label="انتخاب محتوای هدف">
                  <SelectValue placeholder="انتخاب مقالهٔ منتشرشده…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {articles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="رویداد موفقیت" required>
              <Select value={form.successEvent} onValueChange={onEventChange}>
                <SelectTrigger aria-label="انتخاب رویداد موفقیت">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUCCESS_EVENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="هدف اصلی کسب‌وکار" required htmlFor="goal-primary">
            <Input id="goal-primary" value={form.primaryGoal} onChange={(e) => setField('primaryGoal', e.target.value)} placeholder="مثلاً: دریافت درخواست مشاورهٔ معتبر از بازدیدکنندگان واجد شرایط" />
          </Field>
          <Field label="شاخص اصلی" required htmlFor="goal-metric" hint="برچسب شاخصی که پایش می‌شود">
            <Input id="goal-metric" value={form.metricLabel} onChange={(e) => setField('metricLabel', e.target.value)} />
          </Field>
          <Field label="تعریف صورت نرخ" required htmlFor="goal-num" hint="دقیقاً چه چیزی در صورت نرخ شمرده می‌شود؟ این تعریف پس از ثبت گزارش‌ها ثابت می‌ماند">
            <Textarea id="goal-num" rows={3} value={form.metricNumerator} onChange={(e) => setField('metricNumerator', e.target.value)} />
          </Field>
          <Field label="تعریف مخرج نرخ" required htmlFor="goal-den">
            <Textarea id="goal-den" rows={3} value={form.metricDenominator} onChange={(e) => setField('metricDenominator', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="قاعدهٔ انتساب">
              <Select value={form.attributionRule} onValueChange={(v) => setField('attributionRule', v)}>
                <SelectTrigger aria-label="قاعدهٔ انتساب">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AFTER_FIRST_VIEW">پس از اولین مشاهده</SelectItem>
                  <SelectItem value="SAME_SESSION">در همان نشست</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="پنجرهٔ انتساب (ساعت)">
              <Input type="number" min={1} max={168} value={form.attributionHours} onChange={(e) => setField('attributionHours', e.target.value)} />
            </Field>
            <Field label="مسئول پیگیری">
              <Select value={form.ownerUserId} onValueChange={(v) => setField('ownerUserId', v)}>
                <SelectTrigger aria-label="مسئول پیگیری">
                  <SelectValue placeholder="انتخاب…" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} — {u.roleLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs leading-6">
              منطقهٔ زمانی همهٔ گزارش‌ها «Asia/Tehran» است. فقط رویدادهای محدود و مشخص (مشاهده، کلیک فراخوان، شروع فرم، ثبت موفق) جمع‌آوری می‌شود؛ دادهٔ شخصی و متن فرم برای تحلیل محتوا جمع‌آوری نمی‌شود.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={submit} disabled={submitting || !form.title || !form.contentId || !form.primaryGoal}>
            ثبت هدف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── جزئیات هدف: داشبورد عملکرد ──────────────────────────────────

function GoalDetail({ goalId, canManage, onChanged }: { goalId: string; canManage: boolean; onChanged: () => void }) {
  const [days, setDays] = React.useState(7)
  const [data, setData] = React.useState<GoalReportResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<GoalReportResponse>(`/api/goals/${goalId}/report?days=${days}`)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت گزارش')
    } finally {
      setLoading(false)
    }
  }, [goalId, days])

  React.useEffect(() => {
    load()
  }, [load])

  const setStatus = async (status: string) => {
    try {
      await apiPut(`/api/goals/${goalId}`, { status })
      toast.success('وضعیت هدف به‌روزرسانی شد.')
      onChanged()
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در تغییر وضعیت هدف')
    }
  }

  if (loading && !data) return <LoadingSpinner label="در حال محاسبهٔ گزارش…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const { goal, report, publishHistory, experiments } = data
  const statusInfo = goalStatusInfo(goal.status)
  const r = report

  return (
    <div className="space-y-5">
      {/* سربرگ هدف */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{goal.title}</h2>
            <StatusBadge label={statusInfo.label} colorClass={statusInfo.color} bgClass={statusInfo.bg} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            محتوا: {goal.article?.title} — هدف: {goal.primaryGoal}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-36" aria-label="بازهٔ گزارش">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">۷ روز اخیر</SelectItem>
              <SelectItem value="14">۱۴ روز اخیر</SelectItem>
              <SelectItem value="30">۳۰ روز اخیر</SelectItem>
            </SelectContent>
          </Select>
          {canManage && goal.status !== 'PAUSED' ? (
            <Button size="sm" variant="outline" onClick={() => setStatus('PAUSED')}>
              توقف موقت
            </Button>
          ) : null}
          {canManage && goal.status === 'PAUSED' ? (
            <Button size="sm" variant="outline" onClick={() => setStatus('ACTIVE')}>
              ادامهٔ پایش
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={load} aria-label="بارگذاری مجدد گزارش">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* تعریف شاخص — همیشه در دسترس */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListFilter className="h-4 w-4 text-primary" aria-hidden />
            تعریف شاخص
          </CardTitle>
          <CardDescription className="leading-6">
            تعریف صورت و مخرج نرخ‌ها ثابت و روشن است؛ منطقهٔ زمانی گزارش «{r.range.timezone}» و بازهٔ گزارش روزهای {r.range.fromDay} تا {r.range.toDay} است.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-1">شاخص اصلی</p>
            <p className="font-semibold">{goal.metricLabel}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-1">قاعدهٔ انتساب</p>
            <p className="font-semibold">
              {ATTRIBUTION_LABELS[goal.attributionRule] ?? goal.attributionRule} — پنجره: {toFa(goal.attributionHours)} ساعت
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 sm:col-span-2">
            <p className="text-xs text-muted-foreground mb-1">صورت نرخ</p>
            <p className="leading-6">{goal.metricNumerator}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 sm:col-span-2">
            <p className="text-xs text-muted-foreground mb-1">مخرج نرخ</p>
            <p className="leading-6">{goal.metricDenominator}</p>
          </div>
        </CardContent>
      </Card>

      {/* دادهٔ ناکافی هرگز «نتیجهٔ صفر» نمایش داده نمی‌شود */}
      {!r.quality.hasSufficientData ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>دادهٔ کافی برای نتیجه‌گیری وجود ندارد</AlertTitle>
          <AlertDescription className="text-xs leading-6">
            در این بازه مخاطبِ قابل‌اندازه‌گیری ثبت نشده است. «داده نداشتن» به معنی «نتیجهٔ صفر» نیست؛ پوشش جمع‌آوری و بازهٔ گزارش را بررسی کنید.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* کارت‌های شاخص */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="مشاهدهٔ محتوا" value={toFa(r.access.views)} hint="رویدادهای مشاهده از مخاطب واجد شرایط" icon={Eye} />
        <KpiCard label="مخاطب قابل‌اندازه‌گیری" value={toFa(r.access.measurableVisitors)} hint="بازدیدکنندهٔ یکتا با رضایت و بدون ترافیک داخلی/ربات" icon={Users} />
        <KpiCard label="تعامل" value={`${toFa(r.engagement.ctaVisitors)} / ${toFa(r.engagement.formStartVisitors)}`} hint="کلیک فراخوان / شروع فرم" icon={MousePointerClick} />
        <KpiCard
          label="نرخ تبدیل"
          value={pct(r.outcome.conversionRate)}
          hint={r.outcome.rateCi ? `بازهٔ عدم‌قطعیت ۹۵٪: ${pct(r.outcome.rateCi[0])} تا ${pct(r.outcome.rateCi[1])}` : undefined}
          icon={TrendingUp}
        />
      </div>

      {/* نتیجه و مقایسهٔ توصیفی */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-primary" aria-hidden />
            نتیجه
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            تبدیل‌های یکتا: <span className="font-bold tabular-nums">{toFa(r.outcome.conversionVisitors)}</span> بازدیدکننده — {goal.successEvent === 'FORM_SUCCESS' ? 'ثبت موفق فرم' : goal.successEvent === 'SIGNUP' ? 'ثبت‌نام موفق' : 'خرید موفق'}
          </p>
          {r.outcome.previousRate !== null && r.outcome.conversionRate !== null ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs leading-6">
                نرخ بازهٔ قبل: {pct(r.outcome.previousRate)} — تغییر فعلی: {pct(r.outcome.conversionRate)} ({pctAbs((r.outcome.conversionRate - r.outcome.previousRate) * 100)}). این فقط «تغییر» را نشان می‌دهد؛ علت تغییر بدون آزمایش اثبات نمی‌شود (تغییر منبع ترافیک، تبلیغات، روزهای هفته یا پیشنهاد فروش).
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* قیف ساده */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListFilter className="h-4 w-4 text-primary" aria-hidden />
              قیف ساده
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelPanel funnel={r.funnel} />
          </CardContent>
        </Card>

        {/* روند */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
              روند روزانه (Asia/Tehran)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart trend={r.trend} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* کیفیت داده */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldOff className="h-4 w-4 text-primary" aria-hidden />
              کیفیت داده و محدودیت‌ها
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-2">
              <li className="flex items-center justify-between gap-2">
                <span>پوشش تخمینی (رویدادهای دارای رضایت)</span>
                <span className="font-semibold tabular-nums">{r.quality.coveragePercent === null ? 'دادهٔ کافی نیست' : pct(r.quality.coveragePercent / 100)}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>مشاهدهٔ خارج‌شده (ترافیک داخلی)</span>
                <span className="font-semibold tabular-nums">{toFa(r.quality.excludedInternalViews)}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>مشاهدهٔ خارج‌شده (ربات شناخته‌شده)</span>
                <span className="font-semibold tabular-nums">{toFa(r.quality.excludedBotViews)}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>بازدیدکنندهٔ بدون رضایت ردیابی</span>
                <span className="font-semibold tabular-nums">{toFa(r.quality.noConsentVisitors)}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>آخرین رویداد</span>
                <span className="font-semibold tabular-nums">{timeAgo(r.quality.lastEventAt)}</span>
              </li>
            </ul>
            {r.quality.notes.length > 0 ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs leading-6">
                  {r.quality.notes.map((n, i) => (
                    <span key={i} className="block">
                      • {n}
                    </span>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {/* سابقهٔ انتشار + آزمایش‌های مرتبط */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" aria-hidden />
              سابقهٔ انتشار و تغییرات مهم
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {publishHistory.length === 0 ? (
              <EmptyState compact title="تغییری ثبت نشده" />
            ) : (
              <ul className="max-h-48 overflow-y-auto space-y-2 pe-1">
                {publishHistory.map((h, i) => (
                  <li key={`${h.kind}-${h.at}-${i}`} className="flex items-start gap-2 text-sm">
                    <span className={cn('mt-1 h-2 w-2 rounded-full shrink-0', h.kind === 'PUBLISH' ? 'bg-success' : 'bg-chart-1')} aria-hidden />
                    <span className="min-w-0">
                      <span className="block leading-6">{h.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {faDateTime(h.at)}
                        {h.by ? ` — ${h.by}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {experiments.length > 0 ? (
              <div>
                <p className="text-xs text-muted-foreground mb-2">آزمایش‌های مرتبط با این محتوا</p>
                <div className="flex flex-wrap gap-2">
                  {experiments.map((e) => (
                    <Badge key={e.id} variant="outline" className="gap-1.5">
                      <FlaskConical className="h-3 w-3" aria-hidden />
                      {e.title}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ─── فهرست هدف‌ها + جزئیات ───────────────────────────────────────

function GoalsTab({ canManage }: { canManage: boolean }) {
  const [goals, setGoals] = React.useState<Goal[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [articles, setArticles] = React.useState<ArticleLite[]>([])
  const [users, setUsers] = React.useState<AssignableUser[]>([])
  const [seeding, setSeeding] = React.useState(false)

  const can = useCan()
  const canManageNow = canManage && can('analytics.manage')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ items: Goal[] }>('/api/goals')
      setGoals(res.items)
      setSelectedId((prev) => prev ?? res.items.find((g) => g.status === 'ACTIVE')?.id ?? res.items[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت هدف‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  // گزینه‌های فرم: مقاله‌های منتشرشده/تأییدشده + کاربران فعال
  React.useEffect(() => {
    if (!createOpen) return
    ;(async () => {
      try {
        const [arts, usrs] = await Promise.all([
          apiGet<{ items: ArticleLite[] }>('/api/articles?pageSize=100'),
          apiGet<{ items: AssignableUser[] }>('/api/users/assignable'),
        ])
        setArticles(arts.items.filter((a) => ['PUBLISHED', 'APPROVED'].includes(a.status)))
        setUsers(usrs.items)
      } catch {
        // پر کردن گزینه‌ها خراب نشود
      }
    })()
  }, [createOpen])

  const runDemoSetup = async () => {
    setSeeding(true)
    try {
      const res = await apiPost<{ articleTitle: string; goalTitle: string }>('/api/analytics/demo-setup')
      toast.success(`دادهٔ نمایشی آماده شد: «${res.articleTitle}» و هدف «${res.goalTitle}»`)
      setCreateOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در راه‌اندازی دادهٔ نمایشی')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {canManageNow ? (
          <>
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Target className="h-4 w-4" />
              هدف جدید
            </Button>
            <Button variant="outline" onClick={runDemoSetup} disabled={seeding} className="gap-1.5">
              <Sparkles className={cn('h-4 w-4', seeding && 'animate-pulse')} />
              راه‌اندازی دادهٔ نمایشی
            </Button>
          </>
        ) : null}
        <Button variant="ghost" onClick={load} className="gap-1.5" aria-label="بارگذاری مجدد">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          بارگذاری مجدد
        </Button>
      </div>

      {loading && !goals ? <LoadingSpinner /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {goals && goals.length === 0 ? (
        <EmptyState
          title="هنوز هدفی تعریف نشده است"
          description="پنل فقط تعداد بازدید نشان نمی‌دهد؛ با تعریف هدف، نتیجهٔ محتوا به هدف کسب‌وکار متصل می‌شود."
          action={
            canManageNow ? (
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Target className="h-4 w-4" />
                تعریف نخستین هدف
              </Button>
            ) : null
          }
        />
      ) : null}

      {goals && goals.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-2.5 max-h-[520px] overflow-y-auto pe-1" role="list" aria-label="فهرست هدف‌ها">
            {goals.map((g) => {
              const info = goalStatusInfo(g.status)
              const active = selectedId === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  role="listitem"
                  onClick={() => setSelectedId(g.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'w-full text-start rounded-xl border p-3 transition-colors hover:bg-muted/50',
                    active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'bg-card'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm line-clamp-1">{g.title}</span>
                    <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{g.article?.title ?? '—'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{g.metricLabel}</p>
                </button>
              )
            })}
          </div>
          <div className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
            {selectedId ? <GoalDetail key={selectedId} goalId={selectedId} canManage={canManageNow} onChanged={load} /> : <EmptyState compact title="یک هدف را انتخاب کنید" />}
          </div>
        </div>
      ) : null}

      <CreateGoalDialog open={createOpen} onOpenChange={setCreateOpen} articles={articles} users={users} onCreated={load} />
    </div>
  )
}

// ─── کیفیت دادهٔ رویدادها ─────────────────────────────────────────

function QualityTab() {
  const [quality, setQuality] = React.useState<QualityResponse | null>(null)
  const [events, setEvents] = React.useState<RecentEvent[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [q, ev] = await Promise.all([
        apiGet<QualityResponse>('/api/analytics/quality'),
        apiGet<{ items: RecentEvent[] }>('/api/analytics/events?take=30'),
      ])
      setQuality(q)
      setEvents(ev.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت کیفیت داده')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  if (loading && !quality) return <LoadingSpinner label="در حال بررسی کیفیت داده…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!quality) return null

  return (
    <div className="space-y-5">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-6">
          {quality.notes.map((n, i) => (
            <span key={i} className="block">
              • {n}
            </span>
          ))}
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="پوشش تخمینی"
          value={quality.coveragePercent === null ? 'دادهٔ کافی نیست' : pct(quality.coveragePercent / 100)}
          hint="سهم رویدادهای دارای رضایت ردیابی از کل مشاهدات عمومی"
          icon={Gauge}
        />
        <KpiCard label="خارج‌شده: داخلی" value={toFa(quality.excluded.internal)} hint="پیش‌نمایش مدیر و ترافیک تست وارد تحلیل نمی‌شوند" icon={ShieldOff} />
        <KpiCard label="خارج‌شده: ربات" value={toFa(quality.excluded.bots)} hint="ربات‌های شناخته‌شده تفکیک شده‌اند" icon={Bot} />
        <KpiCard label="بدون رضایت ردیابی" value={toFa(quality.excluded.noConsent)} hint="فقط برای سنجش پوشش؛ وارد نتیجه نمی‌شوند" icon={ShieldOff} />
        <KpiCard label="پذیرفته‌شده (۲۴ ساعت)" value={toFa(quality.ingest.accepted24h)} icon={CheckCircle2} />
        <KpiCard label="رویداد تکراری (۲۴ ساعت)" value={toFa(quality.ingest.duplicates24h)} hint={`مجموع تکراری‌ها: ${toFa(quality.ingest.duplicatesTotal)} — ارسال مجدد شمارش تکراری ایجاد نمی‌کند`} icon={AlertTriangle} />
        <KpiCard label="نامعتبر (۲۴ ساعت)" value={toFa(quality.ingest.invalid24h)} hint="رویدادهای خارج از قرارداد" icon={AlertTriangle} />
        <KpiCard label="آخرین به‌روزرسانی" value={timeAgo(quality.lastEventAt)} hint="گزارش‌ها با تأخیر جمع‌آوری همراه‌اند" icon={Timer} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">رویدادهای اخیر (بدون دادهٔ شخصی)</CardTitle>
          <CardDescription>نمایش شفاف برای پایش کیفیت؛ منبع ورود پالایش‌شده است و هیچ متن فرمی ذخیره نمی‌شود.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState compact title="رویدادی ثبت نشده است" description="از شبیه‌ساز ترافیک می‌توانید دادهٔ آزمایشی تولید کنید." />
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">نوع رویداد</TableHead>
                    <TableHead className="w-40">زمان</TableHead>
                    <TableHead>منبع ورود</TableHead>
                    <TableHead className="w-28">نسخهٔ آزمایش</TableHead>
                    <TableHead className="w-44">نشان‌ها</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((ev) => (
                    <TableRow key={ev.eventId}>
                      <TableCell className="font-medium">{EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(ev.occurredAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-40 truncate" title={ev.referrer}>
                        {ev.referrer || 'مستقیم'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {ev.variantGroup === 'CONTROL' ? 'کنترل' : ev.variantGroup === 'VARIANT' ? 'جایگزین' : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {ev.isSimulated ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">شبیه‌سازی‌شده</Badge> : null}
                          {ev.isInternal ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">داخلی</Badge> : null}
                          {ev.isBot ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">ربات</Badge> : null}
                          {!ev.isConsented ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">بدون رضایت</Badge> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── شبیه‌ساز ترافیک نمایشی ───────────────────────────────────────

type SimulatorState = {
  contentId: string
  visitors: number
  ctaPercent: number
  startPercent: number
  successPercent: number
  invalidPercent: number
  noConsentPercent: number
  botVisitors: number
  internalVisitors: number
  spreadDays: number
  seed: number
  includeDuplicates: boolean
  underExperiment: boolean
  variantEffectPercent: number
}

type SimRunSummary = {
  accepted: number
  duplicates: number
  invalid: number
  converted: number
  assigned: { CONTROL: number; VARIANT: number }
  excludedNoConsent: number
  fallbackCount: number
}

function SimulatorTab() {
  const [articles, setArticles] = React.useState<ArticleLite[]>([])
  const [experiments, setExperiments] = React.useState<{ id: string; title: string; targetContentId: string; status: string; isAaTest: boolean; startedAt: string | null }[]>([])
  const [state, setState] = React.useState<SimulatorState>({
    contentId: '',
    visitors: 120,
    ctaPercent: 35,
    startPercent: 60,
    successPercent: 45,
    invalidPercent: 15,
    noConsentPercent: 10,
    botVisitors: 6,
    internalVisitors: 4,
    spreadDays: 7,
    seed: 42,
    includeDuplicates: true,
    underExperiment: true,
    variantEffectPercent: 30,
  })
  const [running, setRunning] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [summary, setSummary] = React.useState<SimRunSummary | null>(null)
  const [done, setDone] = React.useState(false)

  const loadOptions = React.useCallback(async () => {
    try {
      const [arts, exps] = await Promise.all([
        apiGet<{ items: ArticleLite[] }>('/api/articles?pageSize=100'),
        apiGet<{ items: { id: string; title: string; targetContentId: string; status: string; isAaTest: boolean; startedAt: string | null }[] }>('/api/experiments'),
      ])
      const published = arts.items.filter((a) => ['PUBLISHED', 'APPROVED'].includes(a.status))
      setArticles(published)
      setExperiments(exps.items)
      setState((s) => ({ ...s, contentId: s.contentId || published[0]?.id || '' }))
    } catch {
      // گزینه‌ها اختیاری‌اند
    }
  }, [])

  React.useEffect(() => {
    loadOptions()
  }, [loadOptions])

  const runningExp = experiments.find(
    (e) => e.status === 'RUNNING' && e.targetContentId === state.contentId
  )

  const setField = <K extends keyof SimulatorState>(key: K, value: SimulatorState[K]) => setState((s) => ({ ...s, [key]: value }))

  const run = async () => {
    if (!state.contentId) {
      toast.error('محتوای هدف را انتخاب کنید.')
      return
    }
    setRunning(true)
    setProgress(0)
    setSummary(null)
    setDone(false)

    // فهرست آزمایش‌ها پیش از هر اجرا تازه می‌شود تا آزمایش فعال و زمان شروع آن دقیق باشد
    let activeExperiment: typeof runningExp = undefined
    if (state.underExperiment) {
      try {
        const exps = await apiGet<{ items: { id: string; title: string; targetContentId: string; status: string; isAaTest: boolean; startedAt: string | null }[] }>('/api/experiments')
        setExperiments(exps.items)
        activeExperiment = exps.items.find((e) => e.status === 'RUNNING' && e.targetContentId === state.contentId)
      } catch {
        activeExperiment = runningExp
      }
    }
    const runningExpLocal = activeExperiment

    const rand = mulberry(state.seed)
    const summary: SimRunSummary = { accepted: 0, duplicates: 0, invalid: 0, converted: 0, assigned: { CONTROL: 0, VARIANT: 0 }, excludedNoConsent: 0, fallbackCount: 0 }
    const allEvents: Record<string, unknown>[] = []

    const base = Date.now() - state.spreadDays * 24 * 3600 * 1000
    const N = Math.min(500, Math.max(10, state.visitors))

    // ── ترافیک ربات (فقط مشاهده؛ سرور با UA نشانه‌گذاری می‌کند)
    for (let i = 0; i < state.botVisitors; i++) {
      const vid = `sim-bot-${state.seed}-${i}`
      const t = base + rand() * state.spreadDays * 24 * 3600 * 1000
      allEvents.push(makeEvent(vid, 'PAGE_VIEW', t, state.contentId, { simulated: true, ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }))
    }

    // ── ترافیک داخلی (پیش‌نمایش مدیر؛ هرگز وارد تحلیل نمی‌شود)
    for (let i = 0; i < state.internalVisitors; i++) {
      const vid = `sim-admin-${state.seed}-${i}`
      const t = base + rand() * state.spreadDays * 24 * 3600 * 1000
      allEvents.push(makeEvent(vid, 'PAGE_VIEW', t, state.contentId, { simulated: true, ua: 'CMS-Admin-Preview', hint: 'admin-preview' }))
    }

    // ── بازدیدکننده‌های عمومی
    for (let i = 0; i < N; i++) {
      const vid = `sim-v-${state.seed}-${i}`
      const consent = rand() >= state.noConsentPercent / 100
      let group: 'CONTROL' | 'VARIANT' | null = null
      let expId: string | null = null

      if (runningExpLocal && state.underExperiment) {
        expId = runningExpLocal.id
        try {
          const res = await apiPost<{ group: string | null; fallback: boolean; reason?: string; excluded?: string }>(
            `/api/experiments/${runningExpLocal.id}/assign`,
            { visitorId: vid, consent }
          )
          if (res.excluded === 'NO_CONSENT') {
            summary.excludedNoConsent++
            expId = null
          } else if (res.fallback) {
            summary.fallbackCount++
            expId = null
          } else if (res.group === 'CONTROL' || res.group === 'VARIANT') {
            group = res.group
            summary.assigned[res.group]++
            // ترافیک آزمایش بین شروع آزمایش تا اکنون توزیع می‌شود (مواجههٔ واقعی پیش از رویدادها)
            const expStartMs = runningExpLocal.startedAt ? Date.parse(runningExpLocal.startedAt) : base
            const latestStartMs = Date.now() - 100_000
            const spanMs = Math.max(90_000, latestStartMs - expStartMs)
            const tView = Math.min(latestStartMs + 60_000, expStartMs + rand() * spanMs)
            await apiPost(`/api/experiments/${runningExpLocal.id}/expose`, {
              visitorId: vid,
              group: res.group,
              occurredAt: new Date(tView).toISOString(),
            })
            pushVisitorEvents(allEvents, vid, tView, state, rand, consent, expId, group, runningExpLocal.isAaTest ? 0 : state.variantEffectPercent, true)
            continue
          }
        } catch {
          expId = null
        }
      }

      const tView = base + rand() * state.spreadDays * 24 * 3600 * 1000
      pushVisitorEvents(allEvents, vid, tView, state, rand, consent, expId, group, 0)
    }

    // ── آزمون ضد شمارش تکراری: ارسال مجدد رویدادهای بازدیدکنندهٔ اول
    if (state.includeDuplicates) {
      const firstVisitorEvents = allEvents.filter((e) => e.visitorId === `sim-v-${state.seed}-0`)
      allEvents.push(...firstVisitorEvents)
    }

    // ── ارسال دسته‌ای با نمایش پیشرفت
    const CHUNK = 100
    const chunks = Math.max(1, Math.ceil(allEvents.length / CHUNK))
    for (let c = 0; c < chunks; c++) {
      const batch = allEvents.slice(c * CHUNK, (c + 1) * CHUNK)
      try {
        const res = await apiPost<{ results: { status: string }[] }>('/api/analytics/events', { events: batch })
        for (const r of res.results) {
          if (r.status === 'ACCEPTED' || r.status === 'CONVERTED') {
            summary.accepted++
            if (r.status === 'CONVERTED') summary.converted++
          } else if (r.status === 'DUPLICATE') summary.duplicates++
          else summary.invalid++
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'خطا در ارسال دستهٔ رویدادها')
        summary.invalid += batch.length
      }
      setProgress(Math.round(((c + 1) / chunks) * 100))
    }

    setSummary(summary)
    setDone(true)
    setRunning(false)
    toast.success(`شبیه‌سازی کامل شد — ${toFa(summary.accepted)} پذیرفته، ${toFa(summary.duplicates)} تکراری ردشده`)
  }

  return (
    <div className="space-y-5">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>دادهٔ شبیه‌سازی‌شدهٔ نمایشی</AlertTitle>
        <AlertDescription className="text-xs leading-6">
          این شبیه‌ساز ترافیک عمومی سایت را برای اعتبارسنجی قرارداد رویدادها بازسازی می‌کند؛ همهٔ رویدادها با نشانهٔ «شبیه‌سازی‌شده» ثبت می‌شوند و از پیش‌نمایش مدیر تفکیک می‌گردند. شناسهٔ بازدیدکننده‌ها مستعار و بدون دادهٔ شخصی است.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4 text-primary" aria-hidden />
              تنظیمات شبیه‌سازی
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="محتوای هدف" className="sm:col-span-2">
              <Select value={state.contentId} onValueChange={(v) => setField('contentId', v)}>
                <SelectTrigger aria-label="محتوای شبیه‌سازی">
                  <SelectValue placeholder="انتخاب مقالهٔ منتشرشده…" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {articles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <NumField label="تعداد بازدیدکنندهٔ عمومی" value={state.visitors} min={10} max={500} onChange={(v) => setField('visitors', v)} />
            <NumField label="شناسهٔ پایه (پایداری تخصیص)" value={state.seed} min={1} max={9999} onChange={(v) => setField('seed', v)} hint="همان شناسهٔ پایه همان بازدیدکننده‌ها و همان گروه‌ها را می‌سازد" />
            <NumField label="نرخ کلیک فراخوان (٪)" value={state.ctaPercent} min={5} max={90} onChange={(v) => setField('ctaPercent', v)} />
            <NumField label="نرخ شروع فرم پس از کلیک (٪)" value={state.startPercent} min={10} max={95} onChange={(v) => setField('startPercent', v)} />
            <NumField label="نرخ ثبت موفق پس از شروع (٪)" value={state.successPercent} min={10} max={95} onChange={(v) => setField('successPercent', v)} />
            <NumField label="نرخ خطای فرم (٪) — شاخص محافظ" value={state.invalidPercent} min={0} max={60} onChange={(v) => setField('invalidPercent', v)} />
            <NumField label="بازدیدکنندهٔ بدون رضایت (٪)" value={state.noConsentPercent} min={0} max={50} onChange={(v) => setField('noConsentPercent', v)} />
            <NumField label="بازدید ربات (تعداد)" value={state.botVisitors} min={0} max={50} onChange={(v) => setField('botVisitors', v)} />
            <NumField label="بازدید داخلی (تعداد)" value={state.internalVisitors} min={0} max={50} onChange={(v) => setField('internalVisitors', v)} />
            <NumField label="پخش زمانی (روز)" value={state.spreadDays} min={1} max={30} onChange={(v) => setField('spreadDays', v)} />

            {runningExp ? (
              <div className="sm:col-span-2 space-y-3 rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold line-clamp-1">آزمایش فعال: {runningExp.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {runningExp.isAaTest ? 'آزمایش A/A — هر دو نسخه یکسان‌اند؛ اثر نسخهٔ جایگزین صفر است.' : 'بازدیدکننده‌ها از تخصیص پایدار می‌گذرند و مواجهه ثبت می‌شود.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      id="sim-under-experiment"
                      checked={state.underExperiment}
                      onCheckedChange={(v) => setField('underExperiment', v)}
                      aria-label="شبیه‌سازی تحت آزمایش فعال"
                    />
                    <Label htmlFor="sim-under-experiment" className="text-xs">
                      تحت آزمایش
                    </Label>
                  </div>
                </div>
                {!runningExp.isAaTest && state.underExperiment ? (
                  <NumField
                    label="اثر نسخهٔ B بر نرخ موفقیت (٪)"
                    value={state.variantEffectPercent}
                    min={-30}
                    max={100}
                    onChange={(v) => setField('variantEffectPercent', v)}
                    hint="برای سنجش توان تشخیص، اثر واقعی فرضی نسخهٔ جایگزین"
                  />
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 sm:col-span-2 rounded-xl border p-3">
              <div>
                <p className="text-sm font-semibold">آزمون ضد شمارش تکراری</p>
                <p className="text-xs text-muted-foreground mt-0.5">رویدادهای یک بازدیدکننده با همان شناسه دوباره ارسال می‌شود؛ باید شمارش تکراری ایجاد نکند.</p>
              </div>
              <Switch checked={state.includeDuplicates} onCheckedChange={(v) => setField('includeDuplicates', v)} aria-label="ارسال مجدد رویدادهای تکراری" />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-5 space-y-4">
              <Button onClick={run} disabled={running} className="w-full gap-2" size="lg">
                <Play className="h-4 w-4" />
                {running ? 'در حال شبیه‌سازی…' : 'اجرای شبیه‌سازی'}
              </Button>
              {running ? <Progress value={progress} aria-label="پیشرفت شبیه‌سازی" /> : null}
              <p className="text-xs text-muted-foreground leading-6">
                رویدادها از مسیر واقعی پذیرش عبور می‌کنند (اعتبارسنجی، پالایش منبع، تشخیص ربات/داخلی، ضد تکرار). هیچ مسیر میان‌بری به گزارش‌ها وجود ندارد.
              </p>
            </CardContent>
          </Card>

          {done && summary ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">نتیجهٔ اجرا</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <SummaryRow label="پذیرفته‌شده" value={summary.accepted} />
                <SummaryRow label="تکراری ردشده (شمارش نشد)" value={summary.duplicates} />
                <SummaryRow label="نامعتبر" value={summary.invalid} />
                <SummaryRow label="تبدیل منتسب به آزمایش" value={summary.converted} />
                <SummaryRow label="تخصیص کنترل" value={summary.assigned.CONTROL} />
                <SummaryRow label="تخصیص جایگزین" value={summary.assigned.VARIANT} />
                <SummaryRow label="خارج‌شده: بدون رضایت" value={summary.excludedNoConsent} />
                <SummaryRow label="نمایش امن کنترل (آزمایش غیرفعال)" value={summary.fallbackCount} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{toFa(value)}</span>
    </div>
  )
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
      />
    </Field>
  )
}

/** تولید اعداد شبه‌تصادفی قطعی برای پایداری تخصیص و تکرارپذیری آزمون */
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeEvent(
  visitorId: string,
  eventType: string,
  atMs: number,
  contentId: string,
  opts: { simulated?: boolean; ua?: string; hint?: string; consent?: boolean; experimentId?: string }
): Record<string, unknown> {
  return {
    eventId: `${visitorId}:${eventType}`,
    eventType,
    occurredAt: new Date(atMs).toISOString(),
    contentId,
    visitorId,
    sessionId: `${visitorId}:session`,
    referrer: ['https://www.google.com/', 'https://t.me/persiancms', 'https://duckduckgo.com/', ''][Math.floor(Math.random() * 4)],
    simulated: opts.simulated ?? true,
    consent: opts.consent ?? true,
    userAgent: opts.ua ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PersianDemoBrowser/1.0',
    clientHint: opts.hint ?? 'public-site',
    experimentId: opts.experimentId,
  }
}

/** ساخت زنجیرهٔ رفتار یک بازدیدکننده: مشاهده → کلیک → شروع فرم → موفق/نامعتبر */
function pushVisitorEvents(
  sink: Record<string, unknown>[],
  vid: string,
  tViewMs: number,
  state: SimulatorState,
  rand: () => number,
  consent: boolean,
  experimentId: string | null,
  group: 'CONTROL' | 'VARIANT' | null,
  variantEffectPercent: number,
  fastMode = false
) {
  // در حالت آزمایش، زنجیرهٔ رفتار در بازهٔ کوتاه (ثانیه‌ای) فشرده می‌شود تا در بازهٔ اجرا بماند
  const step = fastMode ? (5 + rand() * 25) * 1000 : (1 + rand() * 9) * 60_000
  const stepShort = fastMode ? (5 + rand() * 25) * 1000 : (1 + rand() * 4) * 60_000
  const stepTail = fastMode ? (5 + rand() * 25) * 1000 : (2 + rand() * 6) * 60_000
  const push = (type: string, atMs: number) => {
    const ev = makeEvent(vid, type, atMs, state.contentId, { consent, experimentId: experimentId ?? undefined })
    if (experimentId && group) ev.variantGroup = group
    sink.push(ev)
  }

  push('PAGE_VIEW', tViewMs)
  if (rand() >= state.ctaPercent / 100) return
  const tClick = tViewMs + step
  push('CTA_CLICK', tClick)
  if (rand() >= state.startPercent / 100) return
  const tStart = tClick + stepShort
  push('FORM_START', tStart)

  // نسخهٔ B اثر فرضی خود را فقط بر نرخ موفقیت اعمال می‌کند
  const successThreshold = state.successPercent / 100 * (group === 'VARIANT' ? 1 + variantEffectPercent / 100 : 1)
  const invalidThreshold = state.invalidPercent / 100
  const roll = rand()
  if (roll < invalidThreshold) {
    push('FORM_INVALID', tStart + stepTail)
  } else if (roll < Math.max(invalidThreshold, Math.min(0.95, successThreshold))) {
    push('FORM_SUCCESS', tStart + stepTail)
  }
}

// ─── نمای اصلی ───────────────────────────────────────────────────

export function OutcomesView() {
  const can = useCan()
  const canManage = can('analytics.manage')

  return (
    <div>
      <PageHeader
        title="اهداف و نتایج محتوا"
        description="پنل فقط تعداد بازدید نشان نمی‌دهد؛ مشخص می‌کند محتوا تا چه اندازه به هدف خود کمک کرده است. ابتدا اندازه‌گیری قابل‌اعتماد، سپس آزمایش."
        icon={<Target className="h-6 w-6" aria-hidden />}
      />
      <Tabs defaultValue="goals" className="mt-2">
        <TabsList aria-label="بخش‌های سنجش نتیجه">
          <TabsTrigger value="goals">اهداف و نتایج</TabsTrigger>
          <TabsTrigger value="quality">کیفیت دادهٔ رویدادها</TabsTrigger>
          <TabsTrigger value="simulator">شبیه‌ساز ترافیک</TabsTrigger>
        </TabsList>
        <TabsContent value="goals" className="mt-4">
          <GoalsTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          <QualityTab />
        </TabsContent>
        <TabsContent value="simulator" className="mt-4">
          <SimulatorTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
