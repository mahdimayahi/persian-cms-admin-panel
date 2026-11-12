'use client'

/**
 * راهنمای شروع کار (نسخهٔ ۲) — چک‌لیست گام‌های اولیه متناسب با مجوزهای کاربر.
 *
 * قاعدهٔ کلیدی: گام‌ها فقط با «رویداد موفق واقعی» در سرور ثبت می‌شوند
 * (POST /api/guide با event) — هیچ کلیک‌برای‌تکمیل وجود ندارد؛
 * کلیک روی هر ردیف فقط به بخش مربوطه هدایت می‌کند.
 *
 * variant='dashboard': در داشبورد؛ با رد کردن یا تکمیل همهٔ گام‌ها پنهان می‌شود.
 * variant='compact': در «حساب من»؛ همیشه نمایان است با دکمهٔ اجرای دوباره (reset سرور).
 *
 * پیشرفت از سرور خوانده می‌شود و با رویداد CustomEvent «guide-progress»
 * (پس از ثبت هر رویداد موفق در سایر بخش‌ها) به‌روز نگه داشته می‌شود.
 */

import * as React from 'react'
import { CheckCircle2, ChevronLeft, Circle, EyeOff, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { navigate } from '@/hooks/use-hash-route'
import { apiGet, apiPost } from '@/lib/client/api'
import { toFa } from '@/lib/client/format'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'

/** نسخهٔ محتوای راهنما — با تغییر گام‌ها باید با GUIDE_VERSION سرور هم‌راستا شود */
const GUIDE_VERSION = '1'

/** مالک محتوای راهنما */
const GUIDE_OWNER = 'تیم مستندات'

type StepGroup = 'author' | 'editor' | 'manager'

type Step = { id: string; label: string; hint: string; href: string; perm: string; group: StepGroup }

/** گام‌های راهنما به ترتیب نمایش — id دقیقاً با گام‌های سمت سرور یکی است */
const STEPS: Step[] = [
  { id: 'first_draft', label: 'ساخت اولین پیش‌نویس', hint: 'اولین ذخیرهٔ موفق یک مقالهٔ جدید', href: '/articles', perm: 'articles.create', group: 'author' },
  { id: 'content_complete', label: 'تکمیل محتوا', hint: 'ثبت تصویر شاخص، دسته‌بندی و متن مقاله', href: '/articles', perm: 'articles.create', group: 'author' },
  { id: 'sent_review', label: 'ارسال برای بررسی', hint: 'ارسال موفق پیش‌نویس به صف بازبینی', href: '/articles', perm: 'articles.create', group: 'author' },
  { id: 'review_done', label: 'بررسی محتوا', hint: 'ثبت نتیجهٔ بازبینی (تأیید یا درخواست اصلاح)', href: '/articles', perm: 'articles.review', group: 'editor' },
  { id: 'approve_version', label: 'تأیید نسخه', hint: 'تأیید موفق یک نسخه از محتوا', href: '/articles', perm: 'articles.review', group: 'editor' },
  { id: 'first_bundle', label: 'انتشار اولین بسته', hint: 'انتشار موفق یک بستهٔ انتشار', href: '/bundles', perm: 'articles.publish', group: 'manager' },
  { id: 'invite_teammate', label: 'دعوت همکار', hint: 'ساخت اولین حساب کاربری همکار', href: '/users', perm: 'users.manage', group: 'manager' },
  { id: 'permissions_set', label: 'تنظیم مجوزها', hint: 'به‌روزرسانی مجوزهای نقش‌ها', href: '/roles', perm: 'users.manage', group: 'manager' },
  { id: 'settings_reviewed', label: 'بررسی تنظیمات ضروری', hint: 'ذخیرهٔ موفق تنظیمات سایت', href: '/settings', perm: 'settings.manage', group: 'manager' },
]

const GROUP_ORDER: StepGroup[] = ['author', 'editor', 'manager']

const GROUP_LABELS: Record<StepGroup, string> = {
  author: 'مسیر نویسنده',
  editor: 'مسیر ویراستار',
  manager: 'مسیر مدیریتی',
}

/** شکل پاسخ GET/POST /api/guide */
type GuideState = { stepsDone: string[]; dismissedAt: string | null; version: string }

export function OnboardingChecklist({ variant = 'dashboard' }: { variant?: 'dashboard' | 'compact' }) {
  const user = useAppStore((s) => s.user)
  const permissions = useAppStore((s) => s.permissions)
  const isCompact = variant === 'compact'

  const [stepsDone, setStepsDone] = React.useState<string[]>([])
  const [dismissedAt, setDismissedAt] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  /** خواندن وضعیت از سرور (پیشرفت و رد کردن در سرور مانا هستند؛ localStorage لازم نیست) */
  const refresh = React.useCallback(async () => {
    try {
      const res = await apiGet<GuideState>('/api/guide')
      setStepsDone(res.stepsDone ?? [])
      setDismissedAt(res.dismissedAt ?? null)
    } catch {
      // خطای خواندن راهنما مزاحم کاربر نمی‌شود؛ کارت با پیشرفت خالی می‌ماند
    } finally {
      setLoaded(true)
    }
  }, [])

  React.useEffect(() => {
    if (user) void refresh()
  }, [user, refresh])

  // به‌روزرسانی زنده: پس از ثبت هر رویداد موفق در سایر بخش‌ها این رویداد پراکنده می‌شود
  React.useEffect(() => {
    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent<Partial<GuideState>>).detail
      if (!detail) return
      if (Array.isArray(detail.stepsDone)) setStepsDone(detail.stepsDone)
      if (detail.dismissedAt !== undefined) setDismissedAt(detail.dismissedAt)
    }
    window.addEventListener('guide-progress', onProgress)
    return () => window.removeEventListener('guide-progress', onProgress)
  }, [])

  /** رد کردن راهنما — مستقیم و بدون گفت‌وگوی تأیید */
  const dismiss = async () => {
    setBusy(true)
    try {
      const res = await apiPost<GuideState>('/api/guide', { dismiss: true })
      setStepsDone(res.stepsDone ?? [])
      setDismissedAt(res.dismissedAt ?? null)
      toast.success('راهنما مخفی شد؛ از بخش حساب من می‌توانید دوباره اجرا کنید.')
    } catch {
      // رد کردن نباید با خطای مزاحم همراه شود
    } finally {
      setBusy(false)
    }
  }

  /** اجرای دوباره راهنما — پیشرفت و رد کردن در سرور پاک می‌شود */
  const rerun = async () => {
    setBusy(true)
    try {
      const res = await apiPost<GuideState>('/api/guide', { reset: true })
      setStepsDone(res.stepsDone ?? [])
      setDismissedAt(res.dismissedAt ?? null)
      toast.success('راهنما از نو اجرا شد؛ گام‌ها با اقدام‌های بعدی شما تکمیل می‌شوند.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'اجرای دوباره راهنما ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  // «اقدامی که مجوزش را نداری پیشنهاد نمی‌شود» — فیلتر گام‌ها بر اساس مجوزهای مؤثر کاربر
  const visibleSteps = React.useMemo(() => STEPS.filter((s) => permissions.includes(s.perm)), [permissions])

  const doneCount = visibleSteps.filter((s) => stepsDone.includes(s.id)).length
  const total = visibleSteps.length
  const allDone = total > 0 && doneCount === total
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0

  if (!user || !loaded) return null
  // نسخهٔ داشبورد پس از رد کردن، تکمیل همهٔ گام‌ها یا خالی بودن فهرست پنهان می‌شود
  if (!isCompact && (dismissedAt || allDone || total === 0)) return null

  return (
    <Card className="gap-4 rounded-2xl py-5">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info"
            aria-hidden
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <CardTitle>شروع کار</CardTitle>
            <CardDescription className="mt-1">بر اساس مجوزهای شما — گام‌ها فقط با انجام واقعی تکمیل می‌شوند.</CardDescription>
          </div>
        </div>
        <CardAction className="flex items-center gap-2">
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {toFa(doneCount)} از {toFa(total)}
          </Badge>
          {isCompact ? (
            <Button variant="outline" size="sm" onClick={rerun} disabled={busy} className="gap-1.5 shrink-0">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
              اجرای دوباره راهنما
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={dismiss}
              disabled={busy}
              aria-label="مخفی کردن راهنمای شروع کار"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <EyeOff className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="pt-0">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="پیشرفت راهنمای شروع کار"
        >
          <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>

        {isCompact && dismissedAt ? (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
            راهنما مخفی شده — برای اجرای دوباره از دکمهٔ زیر استفاده کنید.
          </p>
        ) : null}

        <p className="mt-3 text-xs text-muted-foreground">با انجام موفق، هر گام خودکار تکمیل می‌شود.</p>

        {GROUP_ORDER.map((group) => {
          const groupSteps = visibleSteps.filter((s) => s.group === group)
          if (groupSteps.length === 0) return null
          return (
            <section key={group} className="mt-3">
              <h3 className="px-1 text-xs font-semibold text-muted-foreground">{GROUP_LABELS[group]}</h3>
              <ul className="mt-1 divide-y">
                {groupSteps.map((step) => {
                  const isDone = stepsDone.includes(step.id)
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => navigate(step.href)}
                        aria-label={`${step.label} — ${isDone ? 'تکمیل‌شده' : `رفتن به بخش مربوطه؛ با انجام موفق خودکار تکمیل می‌شود`}`}
                        className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-start text-sm transition-colors hover:bg-muted/50"
                      >
                        {isDone ? (
                          <CheckCircle2
                            className="h-5 w-5 shrink-0 fill-success text-success"
                            aria-hidden
                          />
                        ) : (
                          <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block font-medium',
                              isDone && 'text-muted-foreground line-through decoration-muted-foreground/40'
                            )}
                          >
                            {step.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{step.hint}</span>
                        </span>
                        {isDone ? (
                          <span className="shrink-0 text-xs font-medium text-success">تکمیل‌شده</span>
                        ) : null}
                        <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

        <p className="mt-4 px-1 text-xs text-muted-foreground">
          نسخهٔ راهنما: {GUIDE_VERSION} · مسئول: {GUIDE_OWNER}
        </p>
      </CardContent>
    </Card>
  )
}
