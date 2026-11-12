'use client'

import * as React from 'react'
import { CheckCircle2, CopyMinus, Info, Merge } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSpinner,
  PageHeader,
} from '@/components/shared/ui-bits'
import { apiGet, apiPost } from '@/lib/client/api'
import { faDate, toFa } from '@/lib/client/format'
import { useCan } from '@/store/app-store'
import { cn } from '@/lib/utils'

type DupType = 'category' | 'tag'

type DupSide = {
  id: string
  name: string
  count: number
  createdAt: string
}

type DupPair = {
  reason: string
  a: DupSide
  b: DupSide
}

/** کدام سمت جفت به‌عنوان نسخه اصلی انتخاب شده است */
type Chosen = 'a' | 'b'

const TABS: { value: DupType; label: string }[] = [
  { value: 'category', label: 'دسته‌بندی‌ها' },
  { value: 'tag', label: 'برچسب‌ها' },
]

export function DuplicatesView() {
  const can = useCan()

  const [tab, setTab] = React.useState<DupType>('category')
  const [pairs, setPairs] = React.useState<DupPair[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // انتخاب «اصلی» برای هر جفت (کلید: جایگاه جفت در فهرست فعلی)
  const [choices, setChoices] = React.useState<Record<number, Chosen>>({})

  // ادغام
  const [mergeIdx, setMergeIdx] = React.useState<number | null>(null)
  const [merging, setMerging] = React.useState(false)

  const canMerge = tab === 'category' ? can('categories.manage') : can('tags.manage')

  const load = React.useCallback(async (type: DupType) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ type: string; pairs: DupPair[] }>(`/api/duplicates?type=${type}`)
      setPairs(res.pairs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت موارد مشابه')
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load(tab)
  }, [load, tab])

  const selectSide = (idx: number, side: Chosen) => {
    setChoices((c) => ({ ...c, [idx]: side }))
  }

  /** جمله پیش‌نمایش انتقال روابط بر اساس انتخاب فعلی */
  const previewFor = (pair: DupPair, chosen: Chosen): string => {
    const primary = chosen === 'a' ? pair.a : pair.b
    const secondary = chosen === 'a' ? pair.b : pair.a
    return `روابط ${toFa(secondary.count)} مقاله از «${secondary.name}» به «${primary.name}» منتقل و «${secondary.name}» حذف می‌شود.`
  }

  const mergeTarget = mergeIdx !== null ? pairs[mergeIdx] : null
  const mergeChosen = mergeIdx !== null ? choices[mergeIdx] : undefined
  const mergePreview = mergeTarget && mergeChosen ? previewFor(mergeTarget, mergeChosen) : null

  const mergePair = async () => {
    if (!mergeTarget || !mergeChosen) return
    const primary = mergeChosen === 'a' ? mergeTarget.a : mergeTarget.b
    const secondary = mergeChosen === 'a' ? mergeTarget.b : mergeTarget.a
    setMerging(true)
    try {
      const res = await apiPost<{ ok: boolean; movedCount: number }>('/api/duplicates/merge', {
        type: tab,
        primaryId: primary.id,
        secondaryId: secondary.id,
      })
      toast.success(`ادغام انجام شد؛ روابط ${toFa(res.movedCount)} مقاله منتقل شد.`)
      setMergeIdx(null)
      setChoices({})
      load(tab)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ادغام ناموفق بود.')
    } finally {
      setMerging(false)
    }
  }

  const renderSide = (side: DupSide, chosen: boolean, onSelect: () => void) => (
    <div className={cn('rounded-xl border p-3 space-y-2', chosen && 'border-emerald-500/60 bg-emerald-500/5')}>
      <p className="font-semibold line-clamp-1" title={side.name}>
        {side.name}
      </p>
      <p className="text-sm text-muted-foreground tabular-nums">{toFa(side.count)} مقاله</p>
      {side.createdAt ? <p className="text-xs text-muted-foreground">ایجاد: {faDate(side.createdAt)}</p> : null}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={chosen}
        aria-label={`${side.name} — انتخاب به‌عنوان اصلی`}
        className={cn(
          'w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          chosen
            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'border-input text-muted-foreground hover:border-emerald-400 hover:bg-emerald-500/5 hover:text-emerald-700 dark:hover:text-emerald-400'
        )}
      >
        انتخاب به‌عنوان اصلی
      </button>
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="موارد مشابه"
        description="شناسایی داده‌های تکراری و ادغام امن با تأیید انسان"
        icon={<CopyMinus className="h-5 w-5" />}
      />

      <Alert className="rounded-2xl">
        <Info className="h-4 w-4" />
        <AlertDescription>
          ادغام با پیشنهاد سیستم انجام می‌شود اما همیشه با تأیید شما؛ تاریخچه کامل در بخش فعالیت‌ها ثبت می‌گردد.
        </AlertDescription>
      </Alert>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as DupType)
          setChoices({})
        }}
      >
        <TabsList className="w-full sm:w-fit">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {!loaded && loading ? (
        <LoadingSpinner label="در حال بررسی موارد مشابه…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(tab)} />
      ) : pairs.length === 0 ? (
        <EmptyState
          title="موارد مشابهی یافت نشد"
          description="داده‌ها تمیز است — چیزی برای ادغام نیست."
          icon={<CheckCircle2 className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-4">
          {pairs.map((pair, idx) => {
            const chosen = choices[idx]
            const ready = chosen !== undefined && canMerge
            return (
              <div key={`${pair.a.id}-${pair.b.id}`} className="rounded-2xl border bg-card p-4 space-y-3 shadow-xs">
                <div>
                  <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400">
                    دلیل شباهت: {pair.reason}
                  </Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {renderSide(pair.a, chosen === 'a', () => selectSide(idx, 'a'))}
                  {renderSide(pair.b, chosen === 'b', () => selectSide(idx, 'b'))}
                </div>
                <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground leading-6">
                    {chosen
                      ? previewFor(pair, chosen)
                      : 'برای ادغام، ابتدا نسخه اصلی را انتخاب کنید؛ نسخه دیگر حذف می‌شود.'}
                  </p>
                  <Button
                    className="gap-1.5 shrink-0 bg-amber-600 text-white hover:bg-amber-700"
                    disabled={!ready}
                    onClick={() => setMergeIdx(idx)}
                    aria-label={`ادغام ${pair.a.name} و ${pair.b.name}`}
                  >
                    <Merge className="h-4 w-4" />
                    ادغام
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* تأیید ادغام */}
      <ConfirmDialog
        open={mergeIdx !== null}
        onOpenChange={(o) => !o && setMergeIdx(null)}
        title="ادغام موارد مشابه"
        description={
          mergePreview
            ? `${mergePreview} این عملیات در تاریخچه ثبت می‌شود و قابل بازگردانی نیست.`
            : 'این عملیات در تاریخچه ثبت می‌شود و قابل بازگردانی نیست.'
        }
        confirmLabel="ادغام"
        loading={merging}
        onConfirm={mergePair}
      />
    </div>
  )
}
