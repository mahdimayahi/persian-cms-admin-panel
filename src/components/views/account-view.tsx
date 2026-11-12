'use client'

import * as React from 'react'
import { AlertTriangle, KeyRound, LifeBuoy, Loader2, LogOut, Monitor, ShieldAlert, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState, ErrorState, Field, LoadingSpinner, PageHeader, StatusBadge } from '@/components/shared/ui-bits'
import { OnboardingChecklist } from '@/components/shared/onboarding-checklist'
import { SupportReportDialog } from '@/components/shared/support-dialog'
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/client/api'
import { supportStatusInfo } from '@/lib/client/support-status'
import { faDate, faDateTime, timeAgo } from '@/lib/client/format'
import { userStatusInfo } from '@/lib/constants'
import { ROLE_LABELS, type Role } from '@/lib/permissions'
import { useAppStore } from '@/store/app-store'
import { useHashRoute } from '@/hooks/use-hash-route'

type SessionRow = {
  id: string
  userAgent: string | null
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  isCurrent: boolean
}

/** ردیف نمایشی فقط‌خواندنی پروفایل */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-3 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground sm:w-32 shrink-0">{label}</span>
      <div className="text-sm font-medium min-w-0">{children}</div>
    </div>
  )
}

export function AccountView() {
  const { segments } = useHashRoute()
  const activeTab = segments.includes('security') ? 'security' : 'profile'

  const user = useAppStore((s) => s.user)

  // ─── تغییر رمز عبور ─────────────────────────────────────────────
  const [pwForm, setPwForm] = React.useState({ current: '', next: '', confirm: '' })
  const [pwBusy, setPwBusy] = React.useState(false)

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pwForm.current || !pwForm.next) {
      toast.error('رمز عبور فعلی و رمز عبور جدید الزامی است.')
      return
    }
    if (pwForm.next.length < 8) {
      toast.error('رمز عبور جدید باید حداقل ۸ نویسه باشد.')
      return
    }
    if (pwForm.next !== pwForm.confirm) {
      toast.error('تکرار رمز عبور مطابقت ندارد.')
      return
    }
    setPwBusy(true)
    try {
      await apiPost('/api/auth/change-password', {
        currentPassword: pwForm.current,
        newPassword: pwForm.next,
      })
      toast.success('رمز عبور تغییر کرد و نشست‌های دیگر خروج داده شدند.')
      setPwForm({ current: '', next: '', confirm: '' })
      loadSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در تغییر رمز عبور')
    } finally {
      setPwBusy(false)
    }
  }

  // ─── نشست‌های فعال ──────────────────────────────────────────────
  const [sessions, setSessions] = React.useState<SessionRow[] | null>(null)
  const [sessionsLoading, setSessionsLoading] = React.useState(true)
  const [sessionsError, setSessionsError] = React.useState<string | null>(null)
  const [revokeBusy, setRevokeBusy] = React.useState(false)

  const loadSessions = React.useCallback(async () => {
    setSessionsLoading(true)
    setSessionsError(null)
    try {
      const res = await apiGet<{ items: SessionRow[] }>('/api/auth/sessions')
      setSessions(res.items)
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : 'خطا در دریافت نشست‌ها')
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const revokeOthers = async () => {
    setRevokeBusy(true)
    try {
      await apiDelete('/api/auth/sessions')
      toast.success('از همه نشست‌های دیگر خارج شدید.')
      await loadSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در خروج نشست‌ها')
    } finally {
      setRevokeBusy(false)
    }
  }

  const otherSessions = (sessions ?? []).filter((s) => !s.isCurrent).length

  return (
    <div>
      <PageHeader title="حساب من" description="مشاهده اطلاعات حساب و مدیریت امنیت نشست‌ها" icon={<UserRound className="h-5 w-5" />} />

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          window.location.hash = v === 'security' ? '/account/security' : '/account'
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="profile">پروفایل</TabsTrigger>
          <TabsTrigger value="security">امنیت</TabsTrigger>
        </TabsList>

        {/* ─── تب پروفایل ─────────────────────────────────────────── */}
        <TabsContent value="profile">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">اطلاعات حساب</CardTitle>
              <CardDescription>این اطلاعات توسط مدیر سامانه مدیریت می‌شود.</CardDescription>
            </CardHeader>
            <CardContent>
              <InfoRow label="نام">{user?.name ?? '—'}</InfoRow>
              <InfoRow label="ایمیل">
                <span dir="ltr">{user?.email ?? '—'}</span>
              </InfoRow>
              <InfoRow label="نقش">
                <Badge variant="secondary">{ROLE_LABELS[(user?.role ?? '') as Role] ?? user?.role ?? '—'}</Badge>
              </InfoRow>
              <InfoRow label="وضعیت حساب">
                {(() => {
                  const info = userStatusInfo(user?.status ?? '')
                  return <StatusBadge label={info.label} colorClass={info.color} bgClass={info.bg} />
                })()}
              </InfoRow>
              <InfoRow label="تاریخ عضویت">{faDate(user?.createdAt)}</InfoRow>
              <InfoRow label="آخرین ورود">
                {user?.lastLoginAt ? faDateTime(user.lastLoginAt) : '—'}
              </InfoRow>

              <Alert className="mt-5">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>برای تغییر نام یا ایمیل با مدیر سامانه تماس بگیرید.</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── تب امنیت ───────────────────────────────────────────── */}
        <TabsContent value="security" className="space-y-4 max-w-2xl">
          {/* تغییر رمز عبور */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-primary" aria-hidden />
                تغییر رمز عبور
              </CardTitle>
              <CardDescription>پس از تغییر، همه نشست‌های دیگر به‌طور خودکار خارج می‌شوند.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitPassword} className="space-y-4">
                <Field label="رمز عبور فعلی" required htmlFor="current-password">
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={pwForm.current}
                    onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
                    required
                  />
                </Field>
                <Field label="رمز عبور جدید" required htmlFor="new-password" hint="حداقل ۸ نویسه">
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={pwForm.next}
                    onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
                    required
                  />
                </Field>
                <Field label="تکرار رمز جدید" required htmlFor="confirm-password">
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={pwForm.confirm}
                    onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                    required
                  />
                </Field>
                <Button type="submit" disabled={pwBusy} className="gap-1.5">
                  {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {pwBusy ? 'در حال تغییر…' : 'تغییر رمز عبور'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* نشست‌های فعال */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-1.5">
                  <Monitor className="h-4 w-4 text-primary" aria-hidden />
                  نشست‌های فعال
                </CardTitle>
                <CardDescription>دستگاه‌هایی که با حساب شما وارد سامانه شده‌اند</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={revokeOthers} disabled={revokeBusy || otherSessions === 0} className="gap-1.5">
                {revokeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                خروج از نشست‌های دیگر
              </Button>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <LoadingSpinner label="در حال بارگذاری نشست‌ها…" />
              ) : sessionsError ? (
                <ErrorState message={sessionsError} onRetry={loadSessions} />
              ) : (sessions ?? []).length === 0 ? (
                <EmptyState compact title="نشستی یافت نشد" />
              ) : (
                <ul className="divide-y max-h-96 overflow-y-auto">
                  {(sessions ?? []).map((s) => (
                    <li key={s.id} className="flex items-start gap-3 py-3">
                      <div className="rounded-full bg-muted p-2 shrink-0">
                        <Monitor className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium line-clamp-1" title={s.userAgent ?? undefined}>
                            {s.userAgent ?? 'دستگاه ناشناس'}
                          </p>
                          {s.isCurrent ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-transparent dark:bg-emerald-950 dark:text-emerald-300">
                              نشست فعلی
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          آخرین فعالیت: {timeAgo(s.lastSeenAt)} · انقضا: {faDate(s.expiresAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* هشدار امنیتی */}
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              اگر فعالیت مشکوکی می‌بینید رمز عبور را تغییر دهید و نشست‌های دیگر را خروج دهید.
            </AlertDescription>
          </Alert>

          <Separator />
        </TabsContent>
      </Tabs>

      {/* ─── راهنمای شروع کار (نسخهٔ compact با اجرای دوباره) ────────── */}
      <div className="mt-6 max-w-2xl">
        <OnboardingChecklist variant="compact" />
      </div>

      {/* ─── گزارش‌های من ─────────────────────────────────────────────── */}
      <SupportTicketsSection />
    </div>
  )
}

type SupportMineItem = {
  id: string
  code: string
  subject: string
  status: string
  createdAt: string
  updatedAt: string
}

/** بخش «گزارش‌های من» — وضعیت آخرین گزارش‌های مشکل کاربر جاری (تا ۲۰ مورد) */
function SupportTicketsSection() {
  const [supportTickets, setSupportTickets] = React.useState<SupportMineItem[] | null>(null)
  const [supportLoading, setSupportLoading] = React.useState(true)
  const [supportError, setSupportError] = React.useState<string | null>(null)
  const [supportDialogOpen, setSupportDialogOpen] = React.useState(false)

  const loadSupportTickets = React.useCallback(async () => {
    setSupportLoading(true)
    setSupportError(null)
    try {
      const res = await apiGet<{ items: SupportMineItem[] }>('/api/support/mine')
      setSupportTickets(res.items)
    } catch (e) {
      // انقضای نشست (۴۰۱) بی‌صدا مدیریت می‌شود — خروج در store انجام می‌شود
      if (e instanceof ApiError && e.status === 401) {
        setSupportTickets([])
        return
      }
      setSupportError(e instanceof Error ? e.message : 'خطا در دریافت گزارش‌های شما')
    } finally {
      setSupportLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadSupportTickets()
  }, [loadSupportTickets])

  return (
    <Card className="max-w-2xl mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-1.5">
          <LifeBuoy className="h-4 w-4 text-teal-600" aria-hidden />
          گزارش‌های من
        </CardTitle>
        <CardDescription>وضعیت گزارش‌های مشکل شما؛ کد رهگیری برای پیگیری تلفنی هم قابل استفاده است.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">گزارش‌ها و پیوست‌ها تا ۱۸۰ روز نگهداری می‌شوند.</p>
        {supportLoading ? (
          <LoadingSpinner label="در حال بارگذاری گزارش‌های شما…" />
        ) : supportError ? (
          <ErrorState message={supportError} onRetry={loadSupportTickets} />
        ) : (supportTickets ?? []).length === 0 ? (
          <EmptyState
            compact
            title="گزارش ثبت‌شده‌ای ندارید."
            description="اگر مشکلی در سامانه دیدید، از دکمهٔ «گزارش مشکل» در سربرگ استفاده کنید."
            action={
              <Button size="sm" onClick={() => setSupportDialogOpen(true)}>
                ثبت گزارش جدید
              </Button>
            }
          />
        ) : (
          <ul className="divide-y max-h-64 overflow-y-auto mt-3">
            {(supportTickets ?? []).map((t) => {
              const info = supportStatusInfo(t.status)
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-3">
                  <Badge variant="secondary" className="font-mono" dir="ltr">
                    {t.code}
                  </Badge>
                  <StatusBadge label={info.label} colorClass={info.colorClass} bgClass={info.bgClass} />
                  <p className="text-sm font-medium line-clamp-1 min-w-0 flex-1" title={t.subject}>
                    {t.subject}
                  </p>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(t.createdAt)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      <SupportReportDialog
        open={supportDialogOpen}
        onOpenChange={setSupportDialogOpen}
        onSuccess={loadSupportTickets}
      />
    </Card>
  )
}
