'use client'

import * as React from 'react'
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  EyeOff,
  HeartPulse,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Wrench,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingSpinner,
  Field,
} from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiDelete } from '@/lib/client/api'
import { faDate, timeAgo, toFa } from '@/lib/client/format'
import { navigate } from '@/hooks/use-hash-route'
import { cn } from '@/lib/utils'

type HealthSeverity = 'HIGH' | 'MEDIUM' | 'LOW'

type HealthIssue = {
  key: string
  type: string
  severity: HealthSeverity
  title: string
  detail: string
  fix: string
  link: string | null
  entityLabel: string
}

type IgnoredIssue = {
  id: string
  issueKey: string
  reason: string
  ignoredByName: string
  createdAt: string
}

type HealthResponse = {
  issues: HealthIssue[]
  counts: Record<HealthSeverity, number>
  ignored: IgnoredIssue[]
  total: number
  scannedAt: string
}

const SEVERITY_ORDER: HealthSeverity[] = ['HIGH', 'MEDIUM', 'LOW']

/** برچسب و رنگ نشان هر سطح اهمیت */
const SEVERITY_META: Record<HealthSeverity, { label: string; colorClass: string; bgClass: string }> = {
  HIGH: { label: 'بحرانی', colorClass: 'text-destructive', bgClass: 'bg-destructive/10' },
  MEDIUM: { label: 'نیازمند توجه', colorClass: 'text-warning', bgClass: 'bg-warning/10' },
  LOW: { label: 'کم‌اهمیت', colorClass: 'text-muted-foreground', bgClass: 'bg-muted' },
}

/** کاشی‌های شمارش سطح اهمیت — به سبک KpiCard داشبورد */
const SEVERITY_TILES: { severity: HealthSeverity; label: string; icon: React.ElementType; tile: string }[] = [
  { severity: 'HIGH', label: 'بحرانی', icon: AlertOctagon, tile: 'bg-destructive/10 text-destructive' },
  { severity: 'MEDIUM', label: 'نیازمند توجه', icon: AlertTriangle, tile: 'bg-warning/10 text-warning' },
  { severity: 'LOW', label: 'کم‌اهمیت', icon: Info, tile: 'bg-muted text-muted-foreground' },
]

const stripHash = (link: string) => link.replace(/^#/, '')

export function HealthView() {
  const [data, setData] = React.useState<HealthResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // فیلتر سطح اهمیت — با کلیک روی کاشی‌ها
  const [severityFilter, setSeverityFilter] = React.useState<HealthSeverity | null>(null)

  // گفت‌وگوی نادیده‌گرفتن
  const [ignoreTarget, setIgnoreTarget] = React.useState<HealthIssue | null>(null)
  const [ignoreReason, setIgnoreReason] = React.useState('')
  const [ignoreError, setIgnoreError] = React.useState<string | null>(null)
  const [ignoring, setIgnoring] = React.useState(false)

  // بازگرداندن مورد نادیده‌گرفته‌شده
  const [restoringKey, setRestoringKey] = React.useState<string | null>(null)

  // بخش «موارد نادیده‌گرفته‌شده» — جمع‌شده، مگر وقتی مشکلی وجود ندارد
  const [ignoredOpen, setIgnoredOpen] = React.useState(false)
  const initializedRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<HealthResponse>('/api/health')
      setData(res)
      if (!initializedRef.current) {
        initializedRef.current = true
        if (res.issues.length === 0) setIgnoredOpen(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در پویش سلامت محتوا')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const openIgnore = (issue: HealthIssue) => {
    setIgnoreTarget(issue)
    setIgnoreReason('')
    setIgnoreError(null)
  }

  const confirmIgnore = async () => {
    if (!ignoreTarget) return
    const reason = ignoreReason.trim()
    if (reason.length < 3) {
      setIgnoreError('دلیل باید دست‌کم ۳ نویسه باشد.')
      return
    }
    setIgnoring(true)
    setIgnoreError(null)
    try {
      await apiPost('/api/health', { issueKey: ignoreTarget.key, reason })
      toast.success('مورد نادیده گرفته شد.')
      setIgnoreTarget(null)
      setIgnoreReason('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'نادیده‌گرفتن مورد ناموفق بود.')
    } finally {
      setIgnoring(false)
    }
  }

  const restoreIgnored = async (issueKey: string) => {
    setRestoringKey(issueKey)
    try {
      await apiDelete(`/api/health?issueKey=${encodeURIComponent(issueKey)}`)
      toast.success('مورد به فهرست سلامت بازگشت.')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'بازگرداندن مورد ناموفق بود.')
    } finally {
      setRestoringKey(null)
    }
  }

  if (loading && !data) return <LoadingSpinner label="در حال پویش سلامت محتوا…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const visibleIssues = severityFilter ? data.issues.filter((i) => i.severity === severityFilter) : data.issues
  const groups = SEVERITY_ORDER.filter(
    (s) => (!severityFilter || severityFilter === s) && data.issues.some((i) => i.severity === s)
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="سلامت محتوا"
        description="شناسایی خودکار محتواهای نیازمند رسیدگی، پیش از گزارش کاربران"
        icon={<HeartPulse className="h-5 w-5" />}
        actions={
          <>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              آخرین پویش: {timeAgo(data.scannedAt)}
            </span>
            <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              پویش مجدد
            </Button>
          </>
        }
      />

      {/* ── کاشی‌های شمارش سطح اهمیت ────────────────────────── */}
      <div className="grid grid-cols-3 gap-3.5">
        {SEVERITY_TILES.map(({ severity, label, icon: TileIcon, tile }) => {
          const count = data.counts[severity] ?? 0
          const active = severityFilter === severity
          return (
            <button
              key={severity}
              type="button"
              onClick={count > 0 ? () => setSeverityFilter((f) => (f === severity ? null : severity)) : undefined}
              disabled={count === 0}
              aria-pressed={active}
              aria-label={`فیلتر موارد ${label}: ${toFa(count)}`}
              className={cn(
                'card-lift text-start rounded-2xl border bg-card p-4 shadow-xs focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default group',
                active && 'ring-2 ring-ring border-primary/40'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] text-muted-foreground">{label}</p>
                <div className={cn('rounded-xl p-2 transition-transform group-hover:scale-110', tile)}>
                  <TileIcon className="h-4 w-4" aria-hidden />
                </div>
              </div>
              <p className="text-[26px] font-bold mt-2 tabular-nums leading-8">{toFa(count)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {active ? 'در حال نمایش فقط این سطح' : count > 0 ? 'برای فیلتر کلیک کنید' : 'موردی نیست'}
              </p>
            </button>
          )
        })}
      </div>

      {/* ── فهرست مشکل‌ها به تفکیک اهمیت ────────────────────── */}
      {data.total === 0 ? (
        <EmptyState
          icon={<HeartPulse className="h-8 w-8" />}
          title="همه‌چیز سالم است"
          description="هیچ مشکل کیفی شناسایی نشد. پویش بعدی را بعد از تغییرات محتوا انجام دهید."
        />
      ) : visibleIssues.length === 0 ? (
        <EmptyState
          compact
          title={`موردی در سطح «${SEVERITY_META[severityFilter as HealthSeverity].label}» یافت نشد`}
          description="ممکن است موارد این سطح به‌تازگی برطرف یا نادیده گرفته شده باشند."
          icon={<Info className="h-6 w-6" />}
          action={
            <Button variant="outline" size="sm" onClick={() => setSeverityFilter(null)} className="gap-1.5">
              <X className="h-4 w-4" />
              حذف فیلتر
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((severity) => {
            const list = data.issues.filter((i) => i.severity === severity)
            const meta = SEVERITY_META[severity]
            return (
              <section key={severity} id={`severity-${severity}`} className="space-y-2.5" aria-label={`موارد ${meta.label}`}>
                <div className="flex items-center gap-2">
                  <StatusBadge label={`${meta.label} · ${toFa(list.length)}`} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                  {severityFilter === severity ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSeverityFilter(null)}
                      className="h-7 gap-1 text-xs text-muted-foreground"
                      aria-label="حذف فیلتر سطح اهمیت"
                    >
                      <X className="h-3 w-3" aria-hidden />
                      حذف فیلتر
                    </Button>
                  ) : null}
                </div>
                {list.map((issue) => (
                  <div key={issue.key} className="rounded-xl border p-4 transition hover:border-primary/40">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{issue.title}</p>
                      <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
                        {issue.entityLabel}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 leading-6">{issue.detail}</p>
                    <p className="text-xs mt-2 flex items-start gap-1.5 text-success leading-5">
                      <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                      <span>
                        <span className="font-medium">راه اصلاح:</span> {issue.fix}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {issue.link ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => navigate(stripHash(issue.link as string))}
                        >
                          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                          رفتن به محل اصلاح
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => openIgnore(issue)}
                        aria-label={`نادیده‌گرفتن «${issue.title}»`}
                      >
                        <EyeOff className="h-3.5 w-3.5" aria-hidden />
                        نادیده گرفتن
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      )}

      {/* ── موارد نادیده‌گرفته‌شده ──────────────────────────── */}
      <Collapsible open={ignoredOpen} onOpenChange={setIgnoredOpen}>
        <Card className="rounded-2xl shadow-xs">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="rounded-lg bg-muted p-1.5 text-muted-foreground" aria-hidden>
                  <EyeOff className="h-4 w-4" />
                </span>
                موارد نادیده‌گرفته‌شده
              </CardTitle>
              <CardDescription>مواردی که عمداً از گزارش سلامت حذف شده‌اند و در پویش نمایش داده نمی‌شوند</CardDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-label={ignoredOpen ? 'بستن فهرست موارد نادیده‌گرفته‌شده' : 'نمایش فهرست موارد نادیده‌گرفته‌شده'}
              >
                {ignoredOpen ? 'بستن' : 'نمایش'}
                <ChevronDown className={cn('h-4 w-4 transition-transform', ignoredOpen && 'rotate-180')} aria-hidden />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-2">
              {data.ignored.length === 0 ? (
                <p className="text-sm text-muted-foreground">تاکنون موردی نادیده گرفته نشده است.</p>
              ) : (
                data.ignored.map((it) => (
                  <div key={it.id} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0" dir="ltr">
                          {it.issueKey}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{faDate(it.createdAt)}</span>
                      </div>
                      <p className="text-sm mt-1.5">{it.reason}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">نادیده‌گرفته توسط {it.ignoredByName}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      disabled={restoringKey === it.issueKey}
                      onClick={() => restoreIgnored(it.issueKey)}
                      aria-label={`بازگرداندن مورد ${it.issueKey} به فهرست سلامت`}
                    >
                      {restoringKey === it.issueKey ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      )}
                      بازگشت به فهرست
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ── گفت‌وگوی نادیده‌گرفتن با دلیل ───────────────────── */}
      <Dialog open={!!ignoreTarget} onOpenChange={(o) => !o && setIgnoreTarget(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>نادیده‌گرفتن مورد</DialogTitle>
            <DialogDescription>
              این مورد از فهرست سلامت حذف می‌شود و در پویش‌های بعدی نمایش داده نمی‌شود.
            </DialogDescription>
          </DialogHeader>
          {ignoreTarget ? (
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-sm font-medium line-clamp-1">{ignoreTarget.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ignoreTarget.detail}</p>
            </div>
          ) : null}
          <div className="space-y-4 py-1">
            <Field label="دلیل" required htmlFor="ignore-reason" error={ignoreError ?? undefined}>
              <Textarea
                id="ignore-reason"
                rows={2}
                value={ignoreReason}
                onChange={(e) => setIgnoreReason(e.target.value)}
                placeholder="چرا این مورد نادیده گرفته می‌شود؟ (حداقل ۳ نویسه)"
                maxLength={300}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreTarget(null)} disabled={ignoring}>
              انصراف
            </Button>
            <Button onClick={confirmIgnore} disabled={ignoring || ignoreReason.trim().length < 3}>
              {ignoring ? <Loader2 className="h-4 w-4 animate-spin me-1.5" aria-hidden /> : null}
              ثبت نادیده‌گرفتن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
