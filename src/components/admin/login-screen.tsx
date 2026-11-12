'use client'

import * as React from 'react'
import { Eye, EyeOff, FileText, Layers, Loader2, Lock, LogIn, MessagesSquare, ShieldCheck, Sparkles, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiGet, apiPost } from '@/lib/client/api'
import { useAppStore, type CurrentUser } from '@/store/app-store'
import { cn } from '@/lib/utils'

type LoginResponse = { user: CurrentUser }

const DEMO_ACCOUNTS = [
  { role: 'مدیر کل', email: 'admin@demo.ir', password: 'admin1234' },
  { role: 'ویراستار', email: 'editor@demo.ir', password: 'editor1234' },
  { role: 'نویسنده', email: 'author@demo.ir', password: 'author1234' },
  { role: 'بیننده', email: 'viewer@demo.ir', password: 'viewer1234' },
]

const BRAND_FEATURES = [
  {
    icon: Layers,
    title: 'گردش کار حرفه‌ای محتوا',
    desc: 'از پیش‌نویس تا انتشار، با بازبینی و نسخه‌بندی کامل',
  },
  {
    icon: MessagesSquare,
    title: 'تعامل با مخاطبان',
    desc: 'مدیریت دیدگاه‌ها و پیام‌های فرم در یک جا',
  },
  {
    icon: ShieldCheck,
    title: 'امنیت و شفافیت',
    desc: 'کنترل دسترسی نقش‌محور و ثبت کامل تاریخچه فعالیت‌ها',
  },
]

const BRAND_STATS = [
  { value: '۱۵', label: 'ماژول عملیاتی' },
  { value: '۴', label: 'سطح دسترسی' },
  { value: '۲۴/۷', label: 'ثبت فعالیت' },
]

export function LoginScreen() {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [activeDemo, setActiveDemo] = React.useState<string | null>(null)
  const setUser = useAppStore((s) => s.setUser)

  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault()
    const em = creds?.email ?? email
    const pw = creds?.password ?? password
    if (!em.trim() || !pw) {
      toast.error('ایمیل و رمز عبور الزامی است.')
      return
    }
    setLoading(true)
    try {
      const res = await apiPost<LoginResponse>('/api/auth/login', { email: em, password: pw })
      // دریافت مجوزهای نقش برای فعال‌سازی درست رابط کاربری
      const me = await apiGet<{ user: CurrentUser; permissions: string[] }>('/api/auth/me')
      setUser(me.user)
      useAppStore.getState().setPermissions(me.permissions)
      toast.success(`خوش آمدید، ${res.user.name}!`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ورود ناموفق بود.')
    } finally {
      setLoading(false)
      setActiveDemo(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* ── پنل برند (سطح تیره زمردی) ─────────────────────────── */}
      <aside
        className="relative hidden lg:flex lg:w-[46%] xl:w-[44%] flex-col justify-between overflow-hidden bg-sidebar text-sidebar-foreground p-10 xl:p-14"
        aria-label="معرفی سامانه"
      >
        {/* لایه‌های تزئینی */}
        <div className="absolute inset-0 bg-gradient-to-bl from-primary/25 via-transparent to-primary/10" aria-hidden />
        <div className="absolute inset-0 pattern-grid" aria-hidden />
        <div className="glow-emerald inset-0" aria-hidden />

        {/* لوگو و نام */}
        <div className="relative z-10 flex items-center gap-3.5">
          <div className="logo-ring animate-gradient-x h-14 w-14 rounded-2xl bg-gradient-to-br from-primary via-primary to-chart-3 text-primary-foreground flex items-center justify-center text-2xl font-bold">
            پ
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">پنل مدیریت محتوا</p>
            <p className="text-sm text-sidebar-foreground/60">سامانه عملیاتی تولید و انتشار</p>
          </div>
        </div>

        {/* پیام مرکزی */}
        <div className="relative z-10 space-y-10">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sidebar-foreground/15 bg-sidebar-foreground/5 px-3 py-1 text-xs font-medium text-sidebar-foreground/80">
              <Sparkles className="h-3.5 w-3.5 text-chart-2" aria-hidden />
              نسخه جدید رابط کاربری
            </span>
            <h1 className="text-3xl xl:text-4xl font-bold leading-[1.5] tracking-tight">
              محتوای سازمانی خود را
              <br />
              <span className="text-chart-2">یک‌جا</span> مدیریت کنید
            </h1>
            <p className="text-sm leading-7 text-sidebar-foreground/65 max-w-md">
              زنجیره کامل تولید، بازبینی و انتشار محتوا با کنترل دسترسی دقیق،
              تاریخچه فعالیت و گزارش‌های عملیاتی — همه در یک سامانه یکپارچه.
            </p>
          </div>

          {/* ویژگی‌ها */}
          <ul className="space-y-5">
            {BRAND_FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 rounded-xl bg-sidebar-foreground/8 border border-sidebar-foreground/10 p-2.5 shrink-0">
                  <f.icon className="h-4.5 w-4.5 text-chart-2" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs text-sidebar-foreground/55 mt-0.5 leading-5">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* آمار پایین */}
        <div className="relative z-10 grid grid-cols-3 gap-3">
          {BRAND_STATS.map((st) => (
            <div
              key={st.label}
              className="rounded-xl border border-sidebar-foreground/10 bg-sidebar-foreground/5 px-4 py-3 text-center"
            >
              <p className="text-xl font-bold text-chart-2 tabular-nums">{st.value}</p>
              <p className="text-[11px] text-sidebar-foreground/55 mt-0.5">{st.label}</p>
            </div>
          ))}
        </div>
      </aside>

      {/* ── پنل فرم ورود ──────────────────────────────────────── */}
      <main className="relative flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
        {/* هاله نوری ملایم پشت فرم */}
        <div
          className="pointer-events-none absolute -top-24 start-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />

        {/* هدر موبایل (چون پنل برند پنهان است) */}
        <div className="lg:hidden mb-8 text-center space-y-3">
          <div className="logo-ring animate-gradient-x mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-chart-3 text-primary-foreground flex items-center justify-center text-2xl font-bold">
            پ
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">پنل مدیریت محتوا</h1>
            <p className="text-sm text-muted-foreground">سامانه یکپارچه تولید و انتشار محتوا</p>
          </div>
        </div>

        <div className="relative z-10 w-full max-w-md">
          {/* عنوان برای دسکتاپ */}
          <div className="hidden lg:block mb-8 space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">ورود به حساب کاربری</h2>
            <p className="text-sm text-muted-foreground">
              برای دسترسی به پنل، اطلاعات حساب خود را وارد کنید.
            </p>
          </div>

          <div className="card-accent-top rounded-2xl border bg-card shadow-sm">
            <form onSubmit={submit} className="p-6 sm:p-7 space-y-5" noValidate={false}>
              {/* ایمیل */}
              <div className="space-y-2">
                <Label htmlFor="email">ایمیل</Label>
                <div className="relative">
                  <User
                    className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="email"
                    type="email"
                    dir="ltr"
                    className="ps-9 h-11 text-start rounded-xl bg-background"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.ir"
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              {/* رمز عبور */}
              <div className="space-y-2">
                <Label htmlFor="password">رمز عبور</Label>
                <div className="relative">
                  <Lock
                    className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    className="ps-9 pe-10 h-11 text-start rounded-xl bg-background"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? 'پنهان‌کردن رمز' : 'نمایش رمز'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 gap-2 rounded-xl text-sm font-semibold shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/25 transition-shadow"
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                ورود به پنل
              </Button>
            </form>
          </div>

          {/* حساب‌های آزمایشی */}
          <div className="mt-5 rounded-2xl border bg-muted/40 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-3">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
              حساب‌های آزمایشی — برای ورود سریع کلیک کنید
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setActiveDemo(acc.email)
                    setEmail(acc.email)
                    setPassword(acc.password)
                    submit(undefined, acc)
                  }}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-xl border bg-card p-2.5 text-start transition hover:border-primary/50 hover:shadow-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring',
                    activeDemo === acc.email && 'border-primary/60 bg-primary/5'
                  )}
                >
                  <span className="rounded-lg bg-primary/10 p-1.5 text-primary shrink-0">
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold truncate">{acc.role}</span>
                    <span className="block text-[10px] text-muted-foreground truncate" dir="ltr">
                      {acc.email}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground leading-5">
            دسترسی‌ها سمت سرور کنترل می‌شوند
            <span className="mx-1.5" aria-hidden>·</span>
            نشست‌ها با کوکی امن HttpOnly
          </p>
        </div>
      </main>
    </div>
  )
}
