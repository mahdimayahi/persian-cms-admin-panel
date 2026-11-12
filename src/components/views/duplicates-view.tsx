'use client'

import * as React from 'react'
import {
  Archive,
  CheckCircle2,
  CopyMinus,
  Info,
  Loader2,
  Merge,
  MoveLeft,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorState, LoadingSpinner, PageHeader } from '@/components/shared/ui-bits'
import { apiGet, apiPost } from '@/lib/client/api'
import { faDate, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { cn } from '@/lib/utils'

type DupType = 'tag' | 'category'

/** سمتِ جفت تکراری — «a» قدیمی‌تر/الف و «b» نوی‌تر/ب (سمت سرور مرتب می‌کند) */
type SideKey = 'a' | 'b'

type DupSide = {
  id: string
  name: string
  slug: string
  description: string | null
  count: number
  createdAt: string // ISO — برای برچسب ممکن است رشتهٔ خالی باشد
  parentName?: string | null
  childrenCount?: number
  sharedCount: number
}

type DupPair = {
  key: string // `${a.id}|${b.id}`
  reason: string
  strength: 'strong' | 'weak'
  a: DupSide
  b: DupSide
}

type MergeResponse = {
  ok: boolean
  movedCount: number
  redirectCreated: boolean
  mergeLogId: string
}

const TABS: { value: DupType; label: string }[] = [
  { value: 'category', label: 'دسته‌بندی‌ها' },
  { value: 'tag', label: 'برچسب‌ها' },
]

/** پیشنهاد سامانه برای مقصد ادغام: سمت با تعداد استفادهٔ بیشتر (در تساوی، سمت «ب») */
function suggestTarget(pair: DupPair): SideKey {
  return pair.a.count > pair.b.count ? 'a' : 'b'
}

export function DuplicatesView() {
  const can = useCan()
  const canView = can('articles.view')

  const [tab, setTab] = React.useState<DupType>('category')
  const [pairs, setPairs] = React.useState<DupPair[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // مقصد انتخابی هر جفت (کلید: pair.key) — پیش‌فرض: پیشنهاد سامانه، قابل تغییر توسط کاربر
  const [choices, setChoices] = React.useState<Record<string, SideKey>>({})

  // گفت‌وگوی ادغام
  const [mergePair, setMergePair] = React.useState<DupPair | null>(null)
  const [nameChoice, setNameChoice] = React.useState<'target' | 'source'>('target')
  const [descChoice, setDescChoice] = React.useState<'target' | 'source' | 'clear'>('target')
  const [registerRedirect, setRegisterRedirect] = React.useState(true)
  const [notes, setNotes] = React.useState('')
  const [merging, setMerging] = React.useState(false)

  // گفت‌وگوی «تکراری نیستند»
  const [dismissPair, setDismissPair] = React.useState<DupPair | null>(null)
  const [dismissReason, setDismissReason] = React.useState('')
  const [dismissing, setDismissing] = React.useState(false)

  // مجوز ادغام/رد کردن بر اساس نوع موجودیت فعال
  const canManage = tab === 'tag' ? can('tags.manage') : can('categories.manage')

  const load = React.useCallback(async (type: DupType) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ type: string; pairs: DupPair[] }>(`/api/duplicates?type=${type}`)
      setPairs(res.pairs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت موارد مشابه')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setPairs([])
    setChoices({})
    load(tab)
  }, [load, tab])

  const choiceOf = (pair: DupPair): SideKey => choices[pair.key] ?? suggestTarget(pair)

  const strongCount = pairs.filter((p) => p.strength === 'strong').length
  const weakCount = pairs.length - strongCount

  // ─── باز کردن گفت‌وگوی ادغام با مقادیر پیش‌فرض ───────────────────
  const openMerge = (pair: DupPair) => {
    const targetKey = choiceOf(pair)
    const sourceSide = targetKey === 'a' ? pair.b : pair.a
    const targetSide = targetKey === 'a' ? pair.a : pair.b
    setNameChoice('target')
    setDescChoice(targetSide.description === null && sourceSide.description ? 'source' : 'target')
    setRegisterRedirect(true)
    setNotes('')
    setMergePair(pair)
  }

  const openDismiss = (pair: DupPair) => {
    setDismissReason('')
    setDismissPair(pair)
  }

  // ─── اجرای ادغام ─────────────────────────────────────────────────
  const executeMerge = async () => {
    if (!mergePair) return
    const targetKey = choiceOf(mergePair)
    const sourceSide = targetKey === 'a' ? mergePair.b : mergePair.a
    const targetSide = targetKey === 'a' ? mergePair.a : mergePair.b

    const fieldChoices: { name?: string; description?: string } = {}
    if (nameChoice === 'source') fieldChoices.name = sourceSide.name
    if (tab === 'category') {
      if (descChoice === 'source') fieldChoices.description = sourceSide.description ?? ''
      else if (descChoice === 'clear') fieldChoices.description = ''
    }

    setMerging(true)
    try {
      const res = await apiPost<MergeResponse>('/api/duplicates/merge', {
        type: tab,
        sourceId: sourceSide.id,
        targetId: targetSide.id,
        fieldChoices,
        registerRedirect: tab === 'category' && sourceSide.slug !== targetSide.slug ? registerRedirect : false,
        notes: notes.trim() || undefined,
      })
      toast.success(
        `ادغام انجام شد؛ روابط ${toFa(res.movedCount)} مقاله منتقل شد.` + (res.redirectCreated ? ' ریدایرکت ثبت شد.' : '')
      )
      setMergePair(null)
      load(tab)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ادغام ناموفق بود.')
    } finally {
      setMerging(false)
    }
  }

  // ─── ثبت «تکراری نیستند» ─────────────────────────────────────────
  const executeDismiss = async () => {
    if (!dismissPair) return
    setDismissing(true)
    try {
      await apiPost<{ ok: boolean }>('/api/duplicates/dismiss', {
        type: tab,
        idA: dismissPair.a.id,
        idB: dismissPair.b.id,
        reason: dismissReason.trim() || undefined,
      })
      toast.success('به‌عنوان غیرتکراری ثبت شد؛ این جفت دوباره پیشنهاد نمی‌شود.')
      setDismissPair(null)
      load(tab)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت غیرتکراری ناموفق بود.')
    } finally {
      setDismissing(false)
    }
  }

  const sideLabel = (key: SideKey) => (tab === 'tag' ? (key === 'a' ? 'الف' : 'ب') : key === 'a' ? 'قدیمی‌تر' : 'نوی‌تر')

  // مقادیر گفت‌وگوی ادغام (بر اساس انتخاب فعلی جفت باز شده)
  const mergeTargetKey = mergePair ? choiceOf(mergePair) : null
  const mergeSourceSide = mergePair ? (mergeTargetKey === 'a' ? mergePair.b : mergePair.a) : null
  const mergeTargetSide = mergePair ? (mergeTargetKey === 'a' ? mergePair.a : mergePair.b) : null
  const mergeLabel = tab === 'tag' ? 'برچسب' : 'دسته‌بندی'
  const mergeMovedEstimate = mergeSourceSide ? Math.max(0, mergeSourceSide.count - mergeSourceSide.sharedCount) : 0

  /** کارت یک سمت جفت — شامل انتخاب «ادغام در این سمت» (مقصد) */
  const renderSideCard = (pair: DupPair, key: SideKey) => {
    const side = pair[key]
    const isTarget = choiceOf(pair) === key
    const isSuggested = suggestTarget(pair) === key
    return (
      <div
        className={cn(
          'rounded-xl border p-4 space-y-2.5 transition-colors',
          isTarget ? 'border-primary bg-primary/5' : 'bg-background'
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {sideLabel(key)}
            </span>
            <p className="text-sm font-semibold line-clamp-1 min-w-0" title={side.name}>
              {side.name}
            </p>
          </div>
          {isSuggested ? (
            <Badge
              variant="outline"
              className="shrink-0 border-info/40 text-info text-[10px] px-1.5"
            >
              پیشنهاد سامانه
            </Badge>
          ) : null}
        </div>
        <p dir="ltr" className="font-mono text-xs text-muted-foreground truncate">
          {side.slug}
        </p>
        <p className="text-sm text-muted-foreground leading-6 line-clamp-2">
          {side.description ? side.description : '—'}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{toFa(side.count)} مقاله</span>
          {side.sharedCount > 0 ? (
            <Badge className="bg-warning/10 text-warning border-warning/40 text-[10px] px-1.5">
              {toFa(side.sharedCount)} مقاله مشترک
            </Badge>
          ) : null}
          {side.parentName ? <span>والد: {side.parentName}</span> : null}
          {side.childrenCount ? <span className="tabular-nums">{toFa(side.childrenCount)} زیرشاخه</span> : null}
          {side.createdAt ? <span>ایجاد: {faDate(side.createdAt)}</span> : null}
        </div>
        <div className="flex items-center gap-2 border-t pt-2.5">
          <RadioGroupItem
            value={key}
            id={`target-${pair.key}-${key}`}
            aria-label={`ادغام در سمت ${side.name}`}
          />
          <Label
            htmlFor={`target-${pair.key}-${key}`}
            className="text-xs font-medium text-muted-foreground cursor-pointer leading-5"
          >
            ادغام در این سمت
          </Label>
        </div>
      </div>
    )
  }

  // ─── گارد مجوز مشاهده (خود صفحه از طریق منو محافظت می‌شود؛ این لایهٔ داخلی است) ──
  if (!canView) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="موارد مشابه"
          description="پیشنهادهای احتمالی تکراری را بررسی، مقایسه و ادغام کنید؛ هیچ ادغامی بدون تأیید شما انجام نمی‌شود."
          icon={<CopyMinus className="h-5 w-5" />}
        />
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>شما مجوز مشاهده این بخش را ندارید.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="موارد مشابه"
        description="پیشنهادهای احتمالی تکراری را بررسی، مقایسه و ادغام کنید؛ هیچ ادغامی بدون تأیید شما انجام نمی‌شود."
        icon={<CopyMinus className="h-5 w-5" />}
        actions={
          <Button
            variant="outline"
            onClick={() => load(tab)}
            disabled={loading}
            className="gap-1.5"
            aria-label="به‌روزرسانی فهرست موارد مشابه"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            به‌روزرسانی
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as DupType)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {!loading && !error && pairs.length > 0 ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {toFa(pairs.length)} پیشنهاد
            <span className="mx-1.5" role="presentation">
              ·
            </span>
            <span>
              {toFa(strongCount)} محتمل، {toFa(weakCount)} برای بررسی
            </span>
          </p>
        ) : null}
      </div>

      {loading && pairs.length === 0 ? (
        <LoadingSpinner label="در حال بررسی موارد مشابه…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(tab)} />
      ) : pairs.length === 0 ? (
        <EmptyState
          title="مورد مشابهی یافت نشد."
          description="پیشنهادها پس از ایجاد محتوای مشابه جدید اینجا ظاهر می‌شوند."
          icon={<CheckCircle2 className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-4">
          {!canManage ? (
            <Alert className="rounded-xl">
              <Info className="h-4 w-4" />
              <AlertDescription>برای ادغام یا رد کردن، مجوز مدیریت لازم است.</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-4 max-h-[68vh] overflow-y-auto pe-1">
            {pairs.map((pair) => (
              <div key={pair.key} className="rounded-xl border bg-card p-4 space-y-3 shadow-xs">
                {/* سربرگ: شدت + دلیل + عملیات */}
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {pair.strength === 'strong' ? (
                      <Badge className="shrink-0 bg-warning/10 text-warning border-warning/40">
                        تکراری محتمل
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="shrink-0 bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800"
                      >
                        برای بررسی
                      </Badge>
                    )}
                    <p className="text-sm text-muted-foreground leading-6 min-w-0">{pair.reason}</p>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => openDismiss(pair)}
                        aria-label={`علامت‌گذاری ${pair.a.name} و ${pair.b.name} به‌عنوان غیرتکراری`}
                      >
                        <X className="h-3.5 w-3.5" />
                        تکراری نیستند
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => openMerge(pair)}
                        aria-label={`مقایسه و ادغام ${pair.a.name} و ${pair.b.name}`}
                      >
                        <Merge className="h-3.5 w-3.5" />
                        مقایسه و ادغام
                      </Button>
                    </div>
                  ) : null}
                </div>

                {/* انتخاب مقصد + کارت‌های دو سمت */}
                <RadioGroup
                  value={choiceOf(pair)}
                  onValueChange={(v) => setChoices((c) => ({ ...c, [pair.key]: v as SideKey }))}
                  className="grid gap-3 sm:grid-cols-2"
                  aria-label={`انتخاب مقصد ادغام برای «${pair.a.name}» و «${pair.b.name}»`}
                >
                  {renderSideCard(pair, 'a')}
                  {renderSideCard(pair, 'b')}
                </RadioGroup>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── گفت‌وگوی ادغام ─────────────────────────────────────────── */}
      <Dialog
        open={mergePair !== null}
        onOpenChange={(o) => {
          if (!o && !merging) setMergePair(null)
        }}
      >
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>ادغام {tab === 'tag' ? 'برچسب‌ها' : 'دسته‌بندی‌ها'}</DialogTitle>
            <DialogDescription>مقصد و مقادیر نهایی را بررسی کنید؛ هیچ داده‌ای حذف نمی‌شود.</DialogDescription>
          </DialogHeader>

          {mergePair && mergeSourceSide && mergeTargetSide ? (
            <div className="space-y-4 max-h-[58dvh] overflow-y-auto pe-1">
              <p className="text-sm font-medium leading-7 rounded-lg border bg-muted/40 px-3 py-2">
                {mergeLabel} «{mergeSourceSide.name}» در «{mergeTargetSide.name}» ادغام می‌شود.
              </p>

              <ul className="space-y-2.5 text-sm rounded-xl border bg-muted/20 p-3">
                <li className="flex items-start gap-2 leading-6">
                  <MoveLeft className="h-4 w-4 mt-1 shrink-0 text-success" aria-hidden />
                  <span>
                    ارتباط {toFa(mergeMovedEstimate)} مقاله منتقل می‌شود.
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      ارتباط‌های تکراری فقط یک‌بار حفظ می‌شوند.
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2 leading-6">
                  <Archive className="h-4 w-4 mt-1 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                  <span>
                    رکورد «{mergeSourceSide.name}» با وضعیت «ادغام‌شده» نگه داشته می‌شود و از انتخاب‌های جدید خارج
                    می‌شود.
                  </span>
                </li>
              </ul>

              {tab === 'category' && mergeSourceSide.slug !== mergeTargetSide.slug ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <Checkbox
                    id="merge-redirect"
                    checked={registerRedirect}
                    onCheckedChange={(c) => setRegisterRedirect(c === true)}
                    className="mt-1"
                    aria-label="ثبت ریدایرکت از آدرس قدیمی به مقصد"
                  />
                  <label htmlFor="merge-redirect" className="text-sm leading-6 cursor-pointer">
                    ریدایرکت از آدرس قدیمی{' '}
                    <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                      /category/{mergeSourceSide.slug}
                    </span>{' '}
                    به مقصد ثبت می‌شود.
                  </label>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-sm font-medium">نام</p>
                <RadioGroup
                  value={nameChoice}
                  onValueChange={(v) => setNameChoice(v as 'target' | 'source')}
                  className="gap-2"
                >
                  <label
                    htmlFor="merge-name-target"
                    className="flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer has-[[data-state=checked]]:border-primary/70 has-[[data-state=checked]]:bg-primary/5"
                  >
                    <RadioGroupItem value="target" id="merge-name-target" />
                    <span className="text-sm leading-6 min-w-0 line-clamp-1">مقصد: {mergeTargetSide.name}</span>
                  </label>
                  <label
                    htmlFor="merge-name-source"
                    className="flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer has-[[data-state=checked]]:border-primary/70 has-[[data-state=checked]]:bg-primary/5"
                  >
                    <RadioGroupItem value="source" id="merge-name-source" />
                    <span className="text-sm leading-6 min-w-0 line-clamp-1">منبع: {mergeSourceSide.name}</span>
                  </label>
                </RadioGroup>
              </div>

              {tab === 'category' ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">توضیح</p>
                  <RadioGroup
                    value={descChoice}
                    onValueChange={(v) => setDescChoice(v as 'target' | 'source' | 'clear')}
                    className="gap-2"
                  >
                    <label
                      htmlFor="merge-desc-target"
                      className="flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer has-[[data-state=checked]]:border-primary/70 has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem value="target" id="merge-desc-target" className="mt-1" />
                      <span className="min-w-0">
                        <span className="block text-sm leading-6">مقصد</span>
                        <span className="block text-xs text-muted-foreground line-clamp-1">
                          {mergeTargetSide.description ? mergeTargetSide.description : 'بدون توضیح'}
                        </span>
                      </span>
                    </label>
                    <label
                      htmlFor="merge-desc-source"
                      className="flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer has-[[data-state=checked]]:border-primary/70 has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem value="source" id="merge-desc-source" className="mt-1" />
                      <span className="min-w-0">
                        <span className="block text-sm leading-6">منبع</span>
                        <span className="block text-xs text-muted-foreground line-clamp-1">
                          {mergeSourceSide.description ? mergeSourceSide.description : 'بدون توضیح'}
                        </span>
                      </span>
                    </label>
                    <label
                      htmlFor="merge-desc-clear"
                      className="flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer has-[[data-state=checked]]:border-primary/70 has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem value="clear" id="merge-desc-clear" />
                      <span className="text-sm leading-6">خالی شود</span>
                    </label>
                  </RadioGroup>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="merge-notes">یادداشت (اختیاری)</Label>
                <Textarea
                  id="merge-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="یادداشت برای تاریخچه ادغام…"
                  maxLength={500}
                  aria-label="یادداشت ادغام (اختیاری)"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMergePair(null)} disabled={merging}>
              انصراف
            </Button>
            <Button onClick={executeMerge} disabled={merging} className="gap-1.5">
              {merging ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" />}
              اجرای ادغام
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── گفت‌وگوی «تکراری نیستند» ───────────────────────────────── */}
      <Dialog
        open={dismissPair !== null}
        onOpenChange={(o) => {
          if (!o && !dismissing) setDismissPair(null)
        }}
      >
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تکراری نیستند</DialogTitle>
            <DialogDescription>
              {dismissPair ? (
                <>
                  «{dismissPair.a.name}» و «{dismissPair.b.name}» به‌عنوان دو مورد متفاوت ثبت می‌شوند و این جفت دوباره
                  پیشنهاد نمی‌شود.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-reason">دلیل (اختیاری)</Label>
            <Textarea
              id="dismiss-reason"
              rows={3}
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="دلیل اختیاری — مثلاً: دو مفهوم متفاوت‌اند"
              maxLength={300}
              aria-label="دلیل غیرتکراری بودن (اختیاری)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissPair(null)} disabled={dismissing}>
              انصراف
            </Button>
            <Button onClick={executeDismiss} disabled={dismissing} className="gap-1.5">
              {dismissing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" />}
              ثبت
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
