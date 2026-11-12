'use client'

/**
 * نمای «آزمایش A/B» (مرحله ۴)
 * - تعریف آزمایش با فرضیهٔ مشخص، نسخهٔ ثابت و برنامهٔ نمونه
 * - بررسی فنی پیش از شروع (نسخه، تأیید محتوا، یک آزمایش برای هر محل، A/A، شاخص‌ها)
 * - نتایج زنده با عدم‌قطعیت، SRM و شاخص‌های محافظ — بدون اعلام برندهٔ زودهنگام
 * - پایان طبق برنامه؛ تصمیم انسانی با دلیل و محدودیت‌ها؛ انتشار خودکار انجام نمی‌شود
 */

import * as React from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FlaskConical,
  History,
  Info,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  SquareX,
  XCircle,
} from 'lucide-react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import { apiGet, apiPost } from '@/lib/client/api'
import { faDateTime, timeAgo, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { cn } from '@/lib/utils'

// ─── انواع ───────────────────────────────────────────────────────

type ArticleLite = { id: string; title: string; slug: string; status: string }
type VersionLite = { id: string; title: string; note: string | null; editorName: string; createdAt: string }

type Experiment = {
  id: string
  title: string
  hypothesis: string
  ownerName: string | null
  targetContentId: string
  changeType: string
  slotLabel: string
  controlVersionId: string | null
  variantVersionId: string | null
  variantPayload: string
  trafficSplitPercent: number
  eligiblePopulation: string
  primaryMetricEvent: string
  attributionHours: number
  guardrailsJson: string
  plannedSamplePerGroup: number
  plannedDurationDays: number
  minDetectableEffectPp: number | null
  stoppingRule: string
  lastPreflightJson: string
  status: string
  isAaTest: boolean
  startedAt: string | null
  plannedEndAt: string | null
  endedAt: string | null
  endReason: string
  emergencyStoppedAt: string | null
  decision: string | null
  decisionReason: string | null
  decisionLimitations: string
  decidedByName: string | null
  decidedAt: string | null
  invalidReason: string | null
  createdByName: string
  createdAt: string
  history?: HistoryRow[]
  article?: ArticleLite
  _count?: { assignments: number }
}

type HistoryRow = { id: string; kind: string; message: string; userName: string; createdAt: string }

type ExperimentDetailResponse = {
  experiment: Experiment
  exposedCount: number
  controlVersion: VersionLite | null
  variantVersion: VersionLite | null
}

type PreflightCheck = { key: string; label: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }

type ResultsResponse = {
  experiment: {
    id: string
    title: string
    hypothesis: string
    status: string
    isAaTest: boolean
    trafficSplitPercent: number
    primaryMetricEvent: string
    startedAt: string | null
    plannedEndAt: string | null
    endedAt: string | null
    decision: string | null
    decisionReason: string | null
    decisionLimitations: string
    decidedByName: string | null
    decidedAt: string | null
    emergencyStoppedAt: string | null
  }
  results: {
    groups: { key: 'CONTROL' | 'VARIANT'; label: string; assigned: number; exposed: number; conversions: number; conversionRate: number | null; rateCi: [number, number] | null }[]
    comparison: { absoluteLiftPp: number | null; relativeLiftPct: number | null; diffCi: [number, number] | null }
    srm: { chi2: number; pValue: number; expectedControl: number; expectedVariant: number; severity: 'OK' | 'WARN' | 'FAIL'; label: string }
    guardrails: { key: string; label: string; controlRate: number | null; variantRate: number | null; liftPp: number | null; maxLiftPp: number; status: 'OK' | 'VIOLATED' | 'NO_DATA'; detail: string }[]
    progress: { exposedPerGroup: number; plannedSamplePerGroup: number; sampleProgressPct: number; daysElapsed: number | null; plannedDurationDays: number; plannedEndAt: string | null }
    readiness: { key: string; label: string; met: boolean }[]
    qualityWarnings: { key: string; label: string; detail: string }[]
    dataCaveats: string[]
  }
}

const STATUS_INFO: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'پیش‌نویس', color: 'text-muted-foreground', bg: 'bg-muted' },
  REVIEW: { label: 'در بررسی فنی', color: 'text-warning', bg: 'bg-warning/10' },
  RUNNING: { label: 'در حال اجرا', color: 'text-success', bg: 'bg-success/10' },
  PAUSED: { label: 'متوقف‌شده', color: 'text-warning', bg: 'bg-warning/10' },
  ENDED: { label: 'پایان‌یافته', color: 'text-primary', bg: 'bg-primary/10' },
  INVALID: { label: 'نامعتبر', color: 'text-destructive', bg: 'bg-destructive/10' },
}

function statusInfo(status: string) {
  return STATUS_INFO[status] ?? STATUS_INFO.DRAFT
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  TITLE: 'عنوان',
  CTA_TEXT: 'متن فراخوان اقدام',
  HERO_IMAGE: 'تصویر اصلی',
  BLOCK: 'یک بلوک مشخص',
}

const METRIC_EVENT_LABELS: Record<string, string> = {
  FORM_SUCCESS: 'ثبت موفق فرم',
  SIGNUP: 'ثبت‌نام موفق',
  PURCHASE: 'خرید موفق',
}

const DECISION_LABELS: Record<string, string> = {
  WIN_VARIANT: 'شواهد کافی به نفع نسخهٔ جایگزین',
  WIN_CONTROL: 'شواهد کافی به نفع نسخهٔ کنترل',
  INCONCLUSIVE: 'شواهد ناکافی برای تصمیم',
  INVALID_DATA: 'نتیجهٔ نامعتبر به‌دلیل مشکل داده یا اجرا',
}

const HISTORY_KIND_LABELS: Record<string, string> = {
  CREATED: 'تعریف آزمایش',
  UPDATED: 'ویرایش طرح',
  REVIEW: 'بررسی فنی',
  START: 'شروع اجرا',
  PAUSE: 'توقف موقت',
  RESUME: 'ادامهٔ اجرا',
  EMERGENCY_STOP: 'توقف اضطراری',
  END: 'پایان آزمایش',
  DECISION: 'ثبت تصمیم',
  INVALID: 'اعلام نامعتبری',
}

function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${toFa(n * 100, { maximumFractionDigits: digits })}٪`
}

function pp(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${toFa(n, { maximumFractionDigits: digits })} واحد درصد`
}

function parsePayload(payload: string): Record<string, string> {
  try {
    return JSON.parse(payload || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

// ─── گفت‌وگوی تعریف آزمایش ───────────────────────────────────────

function CreateExperimentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const [articles, setArticles] = React.useState<ArticleLite[]>([])
  const [versions, setVersions] = React.useState<VersionLite[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [form, setForm] = React.useState({
    title: '',
    hypothesis: '',
    isAaTest: false,
    targetContentId: '',
    controlVersionId: '',
    changeType: 'TITLE',
    slotLabel: '',
    variantTitle: '',
    variantCtaText: '',
    trafficSplitPercent: '50',
    eligiblePopulation: 'CONSENTED',
    primaryMetricEvent: 'FORM_SUCCESS',
    attributionHours: '24',
    plannedSamplePerGroup: '300',
    plannedDurationDays: '7',
    minDetectableEffectPp: '1',
    stoppingRule: '',
  })

  const setField = (key: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }))

  React.useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const arts = await apiGet<{ items: ArticleLite[] }>('/api/articles?pageSize=100')
        setArticles(arts.items.filter((a) => ['PUBLISHED', 'APPROVED'].includes(a.status)))
      } catch {
        // اختیاری
      }
    })()
  }, [open])

  // نسخه‌های محتوای هدف — اتصال نسخهٔ کنترل به شناسهٔ نسخهٔ مشخص
  React.useEffect(() => {
    if (!open || !form.targetContentId) {
      setVersions([])
      setField('controlVersionId', '')
      return
    }
    ;(async () => {
      try {
        const res = await apiGet<{ items: VersionLite[] }>(`/api/articles/${form.targetContentId}/versions`)
        setVersions(res.items)
        setField('controlVersionId', res.items[0]?.id ?? '')
      } catch {
        setVersions([])
      }
    })()
  }, [form.targetContentId, open])

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await apiPost<{ experiment: Experiment }>('/api/experiments', {
        title: form.title,
        hypothesis: form.hypothesis,
        isAaTest: form.isAaTest,
        targetContentId: form.targetContentId,
        controlVersionId: form.controlVersionId,
        changeType: form.changeType,
        slotLabel: form.slotLabel,
        variantTitle: form.changeType === 'CTA_TEXT' ? undefined : form.variantTitle,
        variantCtaText: form.changeType === 'CTA_TEXT' ? form.variantCtaText : undefined,
        trafficSplitPercent: Number(form.trafficSplitPercent),
        eligiblePopulation: form.eligiblePopulation,
        primaryMetricEvent: form.primaryMetricEvent,
        attributionHours: Number(form.attributionHours),
        plannedSamplePerGroup: Number(form.plannedSamplePerGroup),
        plannedDurationDays: Number(form.plannedDurationDays),
        minDetectableEffectPp: Number(form.minDetectableEffectPp) || undefined,
        stoppingRule: form.stoppingRule,
      })
      toast.success(form.isAaTest ? 'آزمایش A/A تعریف شد؛ پس از بررسی فنی شروع کنید.' : 'آزمایش تعریف شد؛ پیش از شروع، بررسی فنی را اجرا کنید.')
      onOpenChange(false)
      onCreated(res.experiment.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در تعریف آزمایش')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعریف آزمایش جدید</DialogTitle>
          <DialogDescription>
            فرضیهٔ خوب مشخص است: «روشن‌ترکردن مزیت اصلی در عنوان، نرخ ثبت درخواست مشاوره را افزایش می‌دهد.» فرضیهٔ ضعیف: «این نسخه احتمالاً بهتر است.»
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div>
              <p className="text-sm font-semibold">آزمایش A/A (اعتبارسنجی اندازه‌گیری)</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-5">هر دو نسخه یکسان‌اند؛ صحت تخصیص و رویدادها پیش از نخستین آزمایش واقعی سنجیده می‌شود.</p>
            </div>
            <Switch checked={form.isAaTest} onCheckedChange={(v) => setField('isAaTest', v)} aria-label="آزمایش A/A" />
          </div>
          <Field label="عنوان آزمایش" required htmlFor="exp-title">
            <Input id="exp-title" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder={form.isAaTest ? 'اعتبارسنجی اندازه‌گیری صفحهٔ معرفی خدمت (A/A)' : 'آزمون عنوان مزیت‌محور صفحهٔ معرفی خدمت'} />
          </Field>
          <Field label="فرضیه" required htmlFor="exp-hypothesis" hint="چه تغییری، چه اثری روی کدام شاخص دارد؟">
            <Textarea id="exp-hypothesis" rows={2} value={form.hypothesis} onChange={(e) => setField('hypothesis', e.target.value)} placeholder="روشن‌ترکردن مزیت اصلی در عنوان، نرخ ثبت درخواست مشاوره را افزایش می‌دهد." />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="محتوای هدف" required>
              <Select value={form.targetContentId} onValueChange={(v) => setField('targetContentId', v)}>
                <SelectTrigger aria-label="محتوای هدف">
                  <SelectValue placeholder="انتخاب مقالهٔ تأییدشده…" />
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
            <Field label="نسخهٔ کنترل" required hint="به شناسهٔ نسخه متصل می‌شود و در حین اجرا ثابت می‌ماند">
              <Select value={form.controlVersionId} onValueChange={(v) => setField('controlVersionId', v)} disabled={versions.length === 0}>
                <SelectTrigger aria-label="نسخهٔ کنترل">
                  <SelectValue placeholder={versions.length === 0 ? 'ابتدا محتوا را انتخاب کنید' : 'انتخاب نسخه…'} />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title} — {v.editorName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {!form.isAaTest ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="نوع تغییر" required hint="در نسخهٔ اول فقط یک تغییر آزمایش می‌شود">
                  <Select value={form.changeType} onValueChange={(v) => setField('changeType', v)}>
                    <SelectTrigger aria-label="نوع تغییر">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TITLE">عنوان</SelectItem>
                      <SelectItem value="CTA_TEXT">متن فراخوان اقدام</SelectItem>
                      <SelectItem value="HERO_IMAGE">تصویر اصلی</SelectItem>
                      <SelectItem value="BLOCK">یک بلوک مشخص</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="محل تغییر" htmlFor="exp-slot">
                  <Input id="exp-slot" value={form.slotLabel} onChange={(e) => setField('slotLabel', e.target.value)} placeholder="مثلاً: عنوان صفحهٔ معرفی خدمت" />
                </Field>
              </div>
              {form.changeType === 'CTA_TEXT' ? (
                <Field label="متن فراخوان نسخهٔ جایگزین" required htmlFor="exp-cta">
                  <Input id="exp-cta" value={form.variantCtaText} onChange={(e) => setField('variantCtaText', e.target.value)} placeholder="مثلاً: درخواست مشاورهٔ رایگان" />
                </Field>
              ) : (
                <Field
                  label={form.changeType === 'TITLE' ? 'عنوان نسخهٔ جایگزین' : 'توضیح نسخهٔ جایگزین'}
                  required
                  htmlFor="exp-variant"
                  hint={form.changeType === 'TITLE' ? 'مثلاً: مشاورهٔ رشد کسب‌وکار — نقشهٔ راه شما در یک جلسه' : 'در نسخهٔ اول نمایشی، تغییر تصویر/بلوک با توضیح متنی ثابت ثبت می‌شود.'}
                >
                  <Input id="exp-variant" value={form.variantTitle} onChange={(e) => setField('variantTitle', e.target.value)} />
                </Field>
              )}
            </>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="نسبت تقسیم ترافیک">
              <Select value={form.trafficSplitPercent} onValueChange={(v) => setField('trafficSplitPercent', v)}>
                <SelectTrigger aria-label="نسبت تقسیم">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">۵۰٪ جایگزین / ۵۰٪ کنترل</SelectItem>
                  <SelectItem value="60">۶۰٪ جایگزین</SelectItem>
                  <SelectItem value="70">۷۰٪ جایگزین</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="جمعیت واجد شرایط">
              <Select value={form.eligiblePopulation} onValueChange={(v) => setField('eligiblePopulation', v)}>
                <SelectTrigger aria-label="جمعیت واجد شرایط">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONSENTED">فقط دارای رضایت ردیابی</SelectItem>
                  <SelectItem value="ALL">همهٔ بازدیدکننده‌ها</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="شاخص اصلی">
              <Select value={form.primaryMetricEvent} onValueChange={(v) => setField('primaryMetricEvent', v)}>
                <SelectTrigger aria-label="شاخص اصلی">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FORM_SUCCESS">ثبت موفق فرم</SelectItem>
                  <SelectItem value="SIGNUP">ثبت‌نام موفق</SelectItem>
                  <SelectItem value="PURCHASE">خرید موفق</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="حجم نمونهٔ هر گروه" required>
              <Input type="number" min={50} max={1000000} value={form.plannedSamplePerGroup} onChange={(e) => setField('plannedSamplePerGroup', e.target.value)} />
            </Field>
            <Field label="مدت اجرا (روز)" required>
              <Input type="number" min={1} max={90} value={form.plannedDurationDays} onChange={(e) => setField('plannedDurationDays', e.target.value)} />
            </Field>
            <Field label="حداقل اثر ارزشمند (واحد درصد)">
              <Input type="number" min={0} max={50} value={form.minDetectableEffectPp} onChange={(e) => setField('minDetectableEffectPp', e.target.value)} />
            </Field>
          </div>
          <Field label="قواعد توقف و تصمیم‌گیری" htmlFor="exp-stopping" hint="پایان طبق برنامه انجام می‌شود؛ نگاه مکرر و توقف به‌محض مثبت‌شدن نتیجه نتیجه‌گیری را منحرف می‌کند.">
            <Textarea id="exp-stopping" rows={2} value={form.stoppingRule} onChange={(e) => setField('stoppingRule', e.target.value)} placeholder="پایان پس از تأمین حجم نمونه و مدت برنامه؛ تصمیم با بررسی عدم‌قطعیت و شاخص‌های محافظ." />
          </Field>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs leading-6">
              شاخص محافظ پیش‌فرض «نرخ خطای فرم» ثبت می‌شود؛ «کلیک بیشتر» به‌تنهایی معیار موفقیت نیست. در نسخهٔ اول برای هر محل فقط یک آزمایش فعال مجاز است.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !form.title || form.hypothesis.length < 15 || !form.targetContentId || (!form.isAaTest && !form.controlVersionId) || (!form.isAaTest && form.changeType === 'TITLE' && !form.variantTitle) || (!form.isAaTest && form.changeType === 'CTA_TEXT' && !form.variantCtaText)}
          >
            ثبت آزمایش
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── پنل نتایج زنده ──────────────────────────────────────────────

function ResultsPanel({ experimentId, refreshKey }: { experimentId: string; refreshKey: number }) {
  const [data, setData] = React.useState<ResultsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<ResultsResponse>(`/api/experiments/${experimentId}/results`)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت نتایج')
    } finally {
      setLoading(false)
    }
  }, [experimentId])

  React.useEffect(() => {
    load()
  }, [load, refreshKey])

  if (loading && !data) return <LoadingSpinner label="در حال محاسبهٔ نتایج…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const { experiment, results } = data

  return (
    <div className="space-y-5">
      {/* هشدارهای کیفیت داده — مقدم بر نتیجه */}
      {results.qualityWarnings.length > 0 ? (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>کیفیت داده مقدم بر نتیجه است</AlertTitle>
          <AlertDescription className="text-xs leading-6">
            {results.qualityWarnings.map((w) => (
              <span key={w.key} className="block">
                <strong>{w.label}:</strong> {w.detail}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="text-xs leading-6">{results.srm.label}</AlertDescription>
        </Alert>
      )}

      {/* جدول گروه‌ها */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4 text-primary" aria-hidden />
            مقایسهٔ گروه‌ها — شاخص اصلی: {METRIC_EVENT_LABELS[experiment.primaryMetricEvent] ?? experiment.primaryMetricEvent}
          </CardTitle>
          <CardDescription>
            {experiment.isAaTest
              ? 'این آزمایش A/A است؛ هر دو نسخه یکسان‌اند. نتیجهٔ انتظار: «شواهد ناکافی» — اختلاف بزرگ نشانهٔ مشکل تخصیص یا ثبت داده است.'
              : 'نرخ‌ها توصیفی‌اند؛ اعلام برنده فقط پس از پایان آزمایش و با تصمیم انسانی انجام می‌شود.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>شاخص</TableHead>
                  {results.groups.map((g) => (
                    <TableHead key={g.key} className="text-center">
                      {g.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">تخصیص‌یافته</TableCell>
                  {results.groups.map((g) => (
                    <TableCell key={g.key} className="text-center tabular-nums">{toFa(g.assigned)}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">مواجه‌شدهٔ واقعی</TableCell>
                  {results.groups.map((g) => (
                    <TableCell key={g.key} className="text-center tabular-nums">{toFa(g.exposed)}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">تبدیل‌ها</TableCell>
                  {results.groups.map((g) => (
                    <TableCell key={g.key} className="text-center tabular-nums">{toFa(g.conversions)}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">نرخ تبدیل</TableCell>
                  {results.groups.map((g) => (
                    <TableCell key={g.key} className="text-center tabular-nums font-bold">{pct(g.conversionRate)}</TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">بازهٔ عدم‌قطعیت ۹۵٪</TableCell>
                  {results.groups.map((g) => (
                    <TableCell key={g.key} className="text-center tabular-nums text-xs text-muted-foreground">
                      {g.rateCi ? `${pct(g.rateCi[0])} تا ${pct(g.rateCi[1])}` : '—'}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mt-4">
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="text-xs text-muted-foreground">اختلاف مطلق</p>
              <p className="font-bold tabular-nums mt-1">{pp(results.comparison.absoluteLiftPp)}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="text-xs text-muted-foreground">اختلاف نسبی</p>
              <p className="font-bold tabular-nums mt-1">
                {results.comparison.relativeLiftPct === null ? '—' : `${toFa(results.comparison.relativeLiftPct, { maximumFractionDigits: 1 })}٪`}
              </p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="text-xs text-muted-foreground">بازهٔ عدم‌قطعیت اختلاف</p>
              <p className="font-bold tabular-nums mt-1 text-xs leading-6">
                {results.comparison.diffCi ? `${pp(results.comparison.diffCi[0])} تا ${pp(results.comparison.diffCi[1])}` : '—'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* پیشرفت برنامه */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">پیشرفت نسبت به برنامه</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span>مواجه‌شدهٔ هر گروه (حداقل دو گروه)</span>
                <span className="tabular-nums font-semibold">
                  {toFa(results.progress.exposedPerGroup)} / {toFa(results.progress.plannedSamplePerGroup)}
                </span>
              </div>
              <Progress value={results.progress.sampleProgressPct} aria-label="پیشرفت حجم نمونه" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>روزهای سپری‌شده از برنامه</span>
              <span className="tabular-nums font-semibold">
                {results.progress.daysElapsed === null ? '—' : `${toFa(results.progress.daysElapsed)} / ${toFa(results.progress.plannedDurationDays)}`}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>پایان برنامه‌ریزی‌شده (تهران)</span>
              <span className="font-semibold">{results.progress.plannedEndAt ? faDateTime(results.progress.plannedEndAt) : '—'}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-6">
              دیدن نتیجهٔ مثبت در یک روز، دلیل پایان آزمایش نیست؛ پایان طبق برنامه انجام می‌شود تا چرخه‌های معمول ترافیک پوشش داده شوند.
            </p>
          </CardContent>
        </Card>

        {/* چک‌لیست آمادگی */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">شاخص‌های آمادگی برای تصمیم (اطلاعاتی)</CardTitle>
            <CardDescription>پر بودن این موارد تصمیم را آسان‌تر می‌کند اما برنده را به‌صورت خودکار اعلام نمی‌کند.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-sm">
              {results.readiness.map((r) => (
                <li key={r.key} className="flex items-start gap-2">
                  {r.met ? (
                    <BadgeCheck className="h-4 w-4 text-success mt-0.5 shrink-0" aria-hidden />
                  ) : (
                    <CircleAlert className="h-4 w-4 text-warning mt-0.5 shrink-0" aria-hidden />
                  )}
                  <span className={r.met ? '' : 'text-muted-foreground'}>{r.label}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* شاخص‌های محافظ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">شاخص‌های محافظ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {results.guardrails.length === 0 ? (
            <EmptyState compact title="شاخص محافظی ثبت نشده است" />
          ) : (
            results.guardrails.map((g) => (
              <div key={g.key} className={cn('rounded-xl border p-3 text-sm', g.status === 'VIOLATED' && 'border-destructive/50 bg-destructive/5')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{g.label}</span>
                  <StatusBadge
                    label={g.status === 'OK' ? 'در حد مجاز' : g.status === 'VIOLATED' ? 'نقض حد مجاز' : 'دادهٔ کافی نیست'}
                    colorClass={g.status === 'OK' ? 'text-success' : g.status === 'VIOLATED' ? 'text-destructive' : 'text-warning'}
                    bgClass={g.status === 'OK' ? 'bg-success/10' : g.status === 'VIOLATED' ? 'bg-destructive/10' : 'bg-warning/10'}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 leading-6">
                  کنترل: {pct(g.controlRate)} — جایگزین: {pct(g.variantRate)} — اختلاف: {pp(g.liftPp)} (حد مجاز بدترشدن: {toFa(g.maxLiftPp)} واحد درصد)
                </p>
                <p className="text-xs mt-1 leading-6">{g.detail}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* محدودیت‌های تحلیل */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">محدودیت‌های تفسیر</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs leading-7 text-muted-foreground list-disc ps-5 space-y-1">
            {results.dataCaveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── گفت‌وگوی ثبت تصمیم انسانی ───────────────────────────────────

function DecisionDialog({
  experimentId,
  open,
  onOpenChange,
  onDecided,
}: {
  experimentId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onDecided: () => void
}) {
  const [decision, setDecision] = React.useState<string>('')
  const [reason, setReason] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const submit = async () => {
    setSubmitting(true)
    try {
      await apiPost(`/api/experiments/${experimentId}/actions`, { action: 'DECISION', decision, reason })
      toast.success('تصمیم با دلیل و محدودیت‌های تحلیل ثبت شد. انتشار نسخهٔ منتخب از مسیر عادی مجوز انجام می‌شود.')
      onOpenChange(false)
      onDecided()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در ثبت تصمیم')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ثبت تصمیم آزمایش</DialogTitle>
          <DialogDescription>
            انتخاب و انتشار برنده خودکار نیست؛ مسئول آزمایش نتیجه را بررسی و تصمیم را با دلیل ثبت می‌کند. «نامشخص» نتیجهٔ معتبر است.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <RadioGroup value={decision} onValueChange={setDecision} className="grid gap-2.5" aria-label="نتیجهٔ آزمایش">
            {Object.entries(DECISION_LABELS).map(([value, label]) => (
              <Label
                key={value}
                htmlFor={`decision-${value}`}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 cursor-pointer font-normal transition-colors hover:bg-muted/40',
                  decision === value && 'border-primary bg-primary/5 ring-1 ring-primary/40'
                )}
              >
                <RadioGroupItem id={`decision-${value}`} value={value} className="mt-1" />
                <span className="text-sm leading-6">{label}</span>
              </Label>
            ))}
          </RadioGroup>
          <Field label="دلیل تصمیم" required htmlFor="decision-reason" hint="دلیل به‌همراه محدودیت‌های تحلیل ثبت می‌شود؛ نبود شواهد تفاوت لزوماً یعنی دو نسخه یکسان نیستند.">
            <Textarea id="decision-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: بازهٔ عدم‌قطعیت اختلاف صفر را کنار گذاشته و شاخص محافظ در حد مجاز بود؛ اما پوشش رضایت حدود ۸۵٪ بود…" />
          </Field>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs leading-6">
              پایان آزمایش به معنی انتشار خودکار نسخهٔ جایگزین نیست. انتشار نسخهٔ منتخب از مسیر عادی مجوز، بررسی اثر و ثبت سابقه انجام می‌شود.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={submit} disabled={submitting || !decision || reason.trim().length < 10}>
            ثبت تصمیم
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── جزئیات آزمایش ───────────────────────────────────────────────

function ExperimentDetail({ experimentId, canManage, onChanged }: { experimentId: string; canManage: boolean; onChanged: () => void }) {
  const [data, setData] = React.useState<ExperimentDetailResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState('plan')
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [decisionOpen, setDecisionOpen] = React.useState(false)
  const [stopDialogOpen, setStopDialogOpen] = React.useState(false)
  const [stopReason, setStopReason] = React.useState('')
  // گفت‌وگوی «اعلام نامعتبری» — جایگزین window.prompt با فرم مستند
  const [invalidateOpen, setInvalidateOpen] = React.useState(false)
  const [invalidateReason, setInvalidateReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<ExperimentDetailResponse>(`/api/experiments/${experimentId}`)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت آزمایش')
    } finally {
      setLoading(false)
    }
  }, [experimentId])

  React.useEffect(() => {
    load()
  }, [load])

  const doAction = async (body: Record<string, unknown>, successMsg: string) => {
    setBusy(true)
    try {
      const res = await apiPost<{ checks?: PreflightCheck[]; canStart?: boolean }>(`/api/experiments/${experimentId}/actions`, body)
      toast.success(successMsg)
      await load()
      onChanged()
      setRefreshKey((k) => k + 1)
      return res
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در اجرای اقدام')
      return null
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <LoadingSpinner label="در حال دریافت آزمایش…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const exp = data.experiment
  const status = statusInfo(exp.status)
  const payload = parsePayload(exp.variantPayload)
  let preflight: PreflightCheck[] = []
  try {
    preflight = JSON.parse(exp.lastPreflightJson || '[]') as PreflightCheck[]
  } catch {
    preflight = []
  }
  const hasFail = preflight.some((c) => c.status === 'FAIL')
  const isEmergencyPaused = exp.status === 'PAUSED' && !!exp.emergencyStoppedAt
  const guardrails: { key: string; label: string; maxLiftPp: number }[] = (() => {
    try {
      return JSON.parse(exp.guardrailsJson || '[]')
    } catch {
      return []
    }
  })()

  return (
    <div className="space-y-5">
      {/* سربرگ */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{exp.title}</h2>
            <StatusBadge label={status.label} colorClass={status.color} bgClass={status.bg} />
            {exp.isAaTest ? <Badge variant="outline" className="gap-1">A/A — اعتبارسنجی</Badge> : null}
            {exp.decision ? <Badge variant="outline" className="gap-1">{DECISION_LABELS[exp.decision] ?? exp.decision}</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-6">{exp.hypothesis}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManage && exp.status === 'DRAFT' ? (
            <Button size="sm" onClick={() => doAction({ action: 'PREFLIGHT' }, 'بررسی فنی اجرا شد.')} disabled={busy} className="gap-1.5">
              <ClipboardCheck className="h-4 w-4" />
              بررسی فنی
            </Button>
          ) : null}
          {canManage && exp.status === 'REVIEW' ? (
            <>
              <Button size="sm" onClick={() => doAction({ action: 'PREFLIGHT' }, 'بررسی فنی مجدد اجرا شد.')} disabled={busy} variant="outline" className="gap-1.5">
                <RefreshCw className="h-4 w-4" />
                بررسی مجدد
              </Button>
              <Button size="sm" onClick={() => doAction({ action: 'START' }, 'تخصیص ترافیک شروع شد؛ پایان طبق برنامه است.')} disabled={busy || hasFail} className="gap-1.5">
                <Play className="h-4 w-4" />
                شروع آزمایش
              </Button>
            </>
          ) : null}
          {canManage && exp.status === 'RUNNING' ? (
            <>
              <Button size="sm" variant="outline" onClick={() => doAction({ action: 'PAUSE' }, 'آزمایش موقتاً متوقف شد؛ نسخهٔ کنترل نمایش داده می‌شود.')} disabled={busy}>
                توقف موقت
              </Button>
              <Button size="sm" variant="outline" onClick={() => doAction({ action: 'END', endReason: 'پایان طبق برنامه' }, 'آزمایش پایان یافت؛ انتشار خودکار انجام نمی‌شود.')} disabled={busy}>
                پایان آزمایش
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setStopDialogOpen(true)} disabled={busy} className="gap-1.5">
                <SquareX className="h-4 w-4" />
                توقف اضطراری
              </Button>
            </>
          ) : null}
          {canManage && exp.status === 'PAUSED' && !isEmergencyPaused ? (
            <>
              <Button size="sm" variant="outline" onClick={() => doAction({ action: 'RESUME' }, 'آزمایش ادامه یافت.')} disabled={busy}>
                ادامهٔ آزمایش
              </Button>
              <Button size="sm" variant="outline" onClick={() => doAction({ action: 'END', endReason: 'پایان پس از توقف' }, 'آزمایش پایان یافت.')} disabled={busy}>
                پایان آزمایش
              </Button>
            </>
          ) : null}
          {canManage && exp.status === 'PAUSED' && isEmergencyPaused ? (
            <Button size="sm" variant="outline" onClick={() => doAction({ action: 'END', endReason: 'پایان پس از توقف اضطراری' }, 'آزمایش پایان یافت.')} disabled={busy}>
              پایان آزمایش
            </Button>
          ) : null}
          {canManage && exp.status === 'ENDED' && !exp.decision ? (
            <Button size="sm" onClick={() => setDecisionOpen(true)} className="gap-1.5">
              <BadgeCheck className="h-4 w-4" />
              ثبت تصمیم
            </Button>
          ) : null}
          {canManage && ['RUNNING', 'PAUSED', 'ENDED'].includes(exp.status) && !exp.decision ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setInvalidateReason('')
                setInvalidateOpen(true)
              }}
            >
              اعلام نامعتبری
            </Button>
          ) : null}
        </div>
      </div>

      {/* هشدار وضعیت‌های خاص */}
      {isEmergencyPaused ? (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>توقف اضطراری فعال است</AlertTitle>
          <AlertDescription className="text-xs leading-6">
            از {faDateTime(exp.emergencyStoppedAt)} همهٔ بازدیدکنندگان نسخهٔ کنترل را به‌صورت امن می‌بینند. پس از بررسی علت، نتیجه را نامعتبر اعلام یا آزمایش را پایان دهید.
          </AlertDescription>
        </Alert>
      ) : null}
      {exp.status === 'INVALID' ? (
        <Alert variant="destructive">
          <Ban className="h-4 w-4" />
          <AlertTitle>نتیجهٔ نامعتبر</AlertTitle>
          <AlertDescription className="text-xs leading-6">{exp.invalidReason}</AlertDescription>
        </Alert>
      ) : null}
      {exp.decision ? (
        <Alert>
          <BadgeCheck className="h-4 w-4" />
          <AlertTitle>تصمیم ثبت‌شده: {DECISION_LABELS[exp.decision] ?? exp.decision}</AlertTitle>
          <AlertDescription className="text-xs leading-6">
            <span className="block">{exp.decisionReason}</span>
            {exp.decisionLimitations ? <span className="block mt-1 text-muted-foreground">محدودیت‌ها: {exp.decisionLimitations}</span> : null}
            <span className="block mt-1">تصمیم‌گیرنده: {exp.decidedByName} — {faDateTime(exp.decidedAt)}</span>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="بخش‌های آزمایش">
          <TabsTrigger value="plan">طرح آزمایش</TabsTrigger>
          <TabsTrigger value="preflight">بررسی فنی</TabsTrigger>
          <TabsTrigger value="results">نتایج</TabsTrigger>
          <TabsTrigger value="history">سابقه</TabsTrigger>
        </TabsList>

        {/* طرح آزمایش */}
        <TabsContent value="plan" className="mt-4">
          <Card>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2 pt-5">
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">محتوای هدف</p>
                <p className="font-semibold">{exp.article?.title}</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">نوع و محل تغییر</p>
                <p className="font-semibold">
                  {CHANGE_TYPE_LABELS[exp.changeType] ?? exp.changeType}
                  {exp.slotLabel ? ` — ${exp.slotLabel}` : ''}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">نسخهٔ کنترل (A)</p>
                <p className="font-semibold line-clamp-2">{data.controlVersion?.title ?? '—'}</p>
                {data.controlVersion?.note ? <p className="text-xs text-muted-foreground mt-1">{data.controlVersion.note}</p> : null}
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">نسخهٔ جایگزین (B) — ثابت و قابل رهگیری</p>
                {exp.isAaTest ? (
                  <p className="font-semibold">یکسان با نسخهٔ کنترل (آزمایش A/A)</p>
                ) : (
                  <>
                    {payload.title ? <p className="font-semibold line-clamp-2">{payload.title}</p> : null}
                    {payload.ctaText ? <p className="text-xs mt-1">متن فراخوان: {payload.ctaText}</p> : null}
                  </>
                )}
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">تخصیص</p>
                <p className="font-semibold">
                  واحد: بازدیدکننده — نسبت جایگزین: {toFa(exp.trafficSplitPercent)}٪ — جمعیت: {exp.eligiblePopulation === 'CONSENTED' ? 'دارای رضایت ردیابی' : 'همه'}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">شاخص اصلی و انتساب تبدیل</p>
                <p className="font-semibold">
                  {METRIC_EVENT_LABELS[exp.primaryMetricEvent] ?? exp.primaryMetricEvent} — پنجرهٔ {toFa(exp.attributionHours)} ساعت از مواجهه
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">برنامهٔ نمونه و مدت</p>
                <p className="font-semibold">
                  {toFa(exp.plannedSamplePerGroup)} مواجه‌شده در هر گروه طی {toFa(exp.plannedDurationDays)} روز
                  {exp.minDetectableEffectPp ? ` — حداقل اثر ارزشمند: ${toFa(exp.minDetectableEffectPp)} واحد درصد` : ''}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">شاخص‌های محافظ</p>
                <p className="font-semibold">{guardrails.map((g) => `${g.label} (حد ${toFa(g.maxLiftPp)} واحد درصد)`).join('، ') || '—'}</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3 sm:col-span-2">
                <p className="text-xs text-muted-foreground mb-1">قواعد توقف و تصمیم‌گیری</p>
                <p className="leading-6">{exp.stoppingRule || '—'}</p>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3 sm:col-span-2">
                <p className="text-xs text-muted-foreground mb-1">مسئول و زمان‌ها</p>
                <p className="leading-6">
                  مسئول: {exp.ownerName ?? exp.createdByName} — تعریف: {faDateTime(exp.createdAt)}
                  {exp.startedAt ? ` — شروع: ${faDateTime(exp.startedAt)}` : ''}
                  {exp.plannedEndAt ? ` — پایان برنامه: ${faDateTime(exp.plannedEndAt)}` : ''}
                  {exp.endedAt ? ` — پایان واقعی: ${faDateTime(exp.endedAt)}` : ''}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* بررسی فنی */}
        <TabsContent value="preflight" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">بررسی فنی پیش از شروع</CardTitle>
              <CardDescription>
                هر دو نسخه پیش از شروع بررسی و تأیید می‌شوند؛ در حین اجرا هیچ نسخه‌ای آزاد نمی‌شود و اصلاح ضروری فقط با توقف یا آزمایش جدید ثبت می‌گردد.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {preflight.length === 0 ? (
                <EmptyState compact title="بررسی فنی هنوز اجرا نشده است" description={canManage ? 'با دکمهٔ «بررسی فنی» صحت شرایط شروع را بسنجید.' : undefined} />
              ) : (
                <ul className="space-y-2.5">
                  {preflight.map((c) => (
                    <li key={c.key} className={cn('rounded-xl border p-3', c.status === 'FAIL' && 'border-destructive/50 bg-destructive/5')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{c.label}</span>
                        <StatusBadge
                          label={c.status === 'PASS' ? 'گذشته' : c.status === 'FAIL' ? 'مانع شروع' : 'توصیه'}
                          colorClass={c.status === 'PASS' ? 'text-success' : c.status === 'FAIL' ? 'text-destructive' : 'text-warning'}
                          bgClass={c.status === 'PASS' ? 'bg-success/10' : c.status === 'FAIL' ? 'bg-destructive/10' : 'bg-warning/10'}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-6">{c.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
              {exp.status === 'REVIEW' && !hasFail ? (
                <Alert className="mt-4">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription className="text-xs">بررسی فنی گذرانده شده و آزمایش آمادهٔ شروع است. تخصیص ترافیک فقط پس از این مرحله آغاز می‌شود.</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* نتایج */}
        <TabsContent value="results" className="mt-4">
          <ResultsPanel experimentId={exp.id} refreshKey={refreshKey} />
        </TabsContent>

        {/* سابقه */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-primary" aria-hidden />
                سابقهٔ آزمایش
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-s ps-5">
                {exp.history?.length ? (
                  exp.history.map((h) => (
                    <li key={h.id} className="text-sm">
                      <span className="absolute -start-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary/60" aria-hidden />
                      <p className="font-semibold">{HISTORY_KIND_LABELS[h.kind] ?? h.kind}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-6">{h.message}</p>
                      <p className="text-xs text-muted-foreground">{faDateTime(h.createdAt)} — {h.userName}</p>
                    </li>
                  ))
                ) : (
                  <EmptyState compact title="سابقه‌ای ثبت نشده است" />
                )}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* گفت‌وگوی توقف اضطراری */}
      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>توقف اضطراری آزمایش</DialogTitle>
            <DialogDescription>
              در صورت اختلال، همهٔ بازدیدکنندگان نسخهٔ کنترل را به‌صورت امن می‌بینند و اختلال ثبت می‌شود. ادامهٔ خودکار پس از توقف اضطراری مجاز نیست.
            </DialogDescription>
          </DialogHeader>
          <Field label="علت توقف اضطراری" required htmlFor="stop-reason">
            <Textarea id="stop-reason" rows={3} value={stopReason} onChange={(e) => setStopReason(e.target.value)} placeholder="مثلاً: افت محسوس سرعت صفحه یا افزایش خطای فرم در نسخهٔ جایگزین" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopDialogOpen(false)}>
              انصراف
            </Button>
            <Button
              variant="destructive"
              disabled={stopReason.trim().length < 4 || busy}
              onClick={async () => {
                const okRes = await doAction({ action: 'EMERGENCY_STOP', reason: stopReason.trim() }, 'توقف اضطراری انجام شد؛ نسخهٔ کنترل نمایش داده می‌شود.')
                if (okRes) {
                  setStopDialogOpen(false)
                  setStopReason('')
                }
              }}
            >
              توقف اضطراری
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DecisionDialog experimentId={exp.id} open={decisionOpen} onOpenChange={setDecisionOpen} onDecided={() => { load(); onChanged(); setRefreshKey((k) => k + 1) }} />

      {/* گفت‌وگوی اعلام نامعتبری نتیجه — با ثبت دلیل مستند */}
      <Dialog open={invalidateOpen} onOpenChange={setInvalidateOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>اعلام نامعتبری نتیجه</DialogTitle>
            <DialogDescription>
              نتایج این آزمایش به‌عنوان «نامعتبر» ثبت می‌شود؛ دلیل آن در تاریخچه باقی می‌ماند و قابل بازگشت نیست.
            </DialogDescription>
          </DialogHeader>
          <Field label="علت نامعتبری" required hint="حداقل ۱۰ نویسه" htmlFor="invalidate-reason">
            <Textarea
              id="invalidate-reason"
              rows={3}
              value={invalidateReason}
              onChange={(e) => setInvalidateReason(e.target.value)}
              placeholder="مثلاً: نسبت نمایش نسخه‌ها با تقسیم‌بندی برنامه همخوان نیست (SRM)"
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvalidateOpen(false)}>
              انصراف
            </Button>
            <Button
              variant="destructive"
              disabled={invalidateReason.trim().length < 10 || busy}
              onClick={async () => {
                const okRes = await doAction(
                  { action: 'INVALIDATE', invalidReason: invalidateReason.trim() },
                  'نتیجهٔ آزمایش نامعتبر اعلام شد.'
                )
                if (okRes) {
                  setInvalidateOpen(false)
                  setInvalidateReason('')
                }
              }}
            >
              اعلام نامعتبری
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── نمای اصلی ───────────────────────────────────────────────────

export function ExperimentsView() {
  const can = useCan()
  const canManage = can('analytics.manage')
  const [experiments, setExperiments] = React.useState<Experiment[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ items: Experiment[] }>('/api/experiments')
      setExperiments(res.items)
      setSelectedId((prev) => prev ?? res.items[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت آزمایش‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <PageHeader
        title="آزمایش A/B"
        description="مقایسهٔ کنترل‌شدهٔ دو نسخه برای تصمیم‌گیری مبتنی بر داده. تخصیص پایدار، مواجههٔ واقعی و پایان طبق برنامه؛ تصمیم همیشه با انسان است."
        icon={<FlaskConical className="h-6 w-6" aria-hidden />}
        actions={
          <>
            {canManage ? (
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                آزمایش جدید
              </Button>
            ) : null}
            <Button variant="ghost" onClick={load} className="gap-1.5" aria-label="بارگذاری مجدد">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </>
        }
      />

      {loading && !experiments ? <LoadingSpinner /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {experiments && experiments.length === 0 ? (
        <EmptyState
          title="هنوز آزمایشی تعریف نشده است"
          description="ترتیب مهم است: ابتدا اندازه‌گیری قابل‌اعتماد (هدف و قرارداد رویداد)، سپس آزمایش. نخستین آزمایش را با A/A اعتبارسنجی کنید."
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                تعریف نخستین آزمایش
              </Button>
            ) : null
          }
        />
      ) : null}

      {experiments && experiments.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-2.5 max-h-[560px] overflow-y-auto pe-1" role="list" aria-label="فهرست آزمایش‌ها">
            {experiments.map((e) => {
              const info = statusInfo(e.status)
              const active = selectedId === e.id
              return (
                <button
                  key={e.id}
                  type="button"
                  role="listitem"
                  onClick={() => setSelectedId(e.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'w-full text-start rounded-xl border p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring outline-none',
                    active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'bg-card'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm line-clamp-1">{e.title}</span>
                    <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{e.article?.title ?? '—'}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                    {e.isAaTest ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">A/A</Badge> : null}
                    <span>{CHANGE_TYPE_LABELS[e.changeType] ?? e.changeType}</span>
                    <span aria-hidden>•</span>
                    <span className="tabular-nums">{toFa(e._count?.assignments ?? 0)} تخصیص</span>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
            {selectedId ? <ExperimentDetail key={selectedId} experimentId={selectedId} canManage={canManage} onChanged={load} /> : <EmptyState compact title="یک آزمایش را انتخاب کنید" />}
          </div>
        </div>
      ) : null}

      <CreateExperimentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => { load(); setSelectedId(id) }} />
    </div>
  )
}
