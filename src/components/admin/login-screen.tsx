'use client'

import * as React from 'react'
import { Loader2, Lock, LogIn, ShieldCheck, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiGet, apiPost } from '@/lib/client/api'
import { useAppStore, type CurrentUser } from '@/store/app-store'

type LoginResponse = { user: CurrentUser }

const DEMO_ACCOUNTS = [
  { role: 'مدیر کل', email: 'admin@demo.ir', password: 'admin1234' },
  { role: 'ویراستار', email: 'editor@demo.ir', password: 'editor1234' },
  { role: 'نویسنده', email: 'author@demo.ir', password: 'author1234' },
  { role: 'بیننده', email: 'viewer@demo.ir', password: 'viewer1234' },
]

export function LoginScreen() {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [loading, setLoading] = React.useState(false)
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
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-bl from-primary/10 via-background to-primary/5">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <div className="text-center space-y-2 mb-6">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">پ</div>
            <h1 className="text-2xl font-bold tracking-tight">پنل مدیریت محتوا</h1>
            <p className="text-sm text-muted-foreground">سامانه یکپارچه تولید، بازبینی و انتشار محتوا</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">ورود به حساب</CardTitle>
              <CardDescription>برای دسترسی به پنل، اطلاعات حساب خود را وارد کنید.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4" noValidate={false}>
                <div className="space-y-1.5">
                  <Label htmlFor="email">ایمیل</Label>
                  <div className="relative">
                    <User className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input
                      id="email"
                      type="email"
                      dir="ltr"
                      className="ps-8 text-start"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.ir"
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">رمز عبور</Label>
                  <div className="relative">
                    <Lock className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input
                      id="password"
                      type="password"
                      dir="ltr"
                      className="ps-8 text-start"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full gap-2" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  ورود به پنل
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                حساب‌های آزمایشی
              </CardTitle>
              <CardDescription className="text-xs">برای آزمون نقش‌ها و مجوزها، روی هر حساب کلیک کنید.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setEmail(acc.email)
                    setPassword(acc.password)
                    submit(undefined, acc)
                  }}
                  className="text-start rounded-lg border p-2.5 hover:border-primary/50 hover:bg-muted/50 transition disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="text-xs font-semibold">{acc.role}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5" dir="ltr">
                    {acc.email}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </main>
      <footer className="py-4 text-center text-xs text-muted-foreground">
        دسترسی‌ها سمت سرور کنترل می‌شوند · نشست‌ها با کوکی امن HttpOnly
      </footer>
    </div>
  )
}
