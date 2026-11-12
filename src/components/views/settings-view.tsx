'use client'

import * as React from 'react'
import { AlertTriangle, Loader2, Save, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState, Field, LoadingSpinner, PageHeader } from '@/components/shared/ui-bits'
import { apiGet, apiPut } from '@/lib/client/api'
import { notifyGuideEvent } from '@/lib/client/guide'
import { useCan } from '@/store/app-store'

type SettingsForm = {
  siteName: string
  siteDescription: string
  contactEmail: string
  defaultLanguage: string
  timezone: string
  postsPerPage: string
  allowComments: boolean
  maintenanceMode: boolean
}

const EMPTY_FORM: SettingsForm = {
  siteName: '',
  siteDescription: '',
  contactEmail: '',
  defaultLanguage: 'fa',
  timezone: 'Asia/Tehran',
  postsPerPage: '10',
  allowComments: true,
  maintenanceMode: false,
}

/** تبدیل داده خام تنظیمات (همه مقادیر رشته‌ای) به فرم رابط کاربری */
function toForm(raw: Record<string, string>): SettingsForm {
  return {
    siteName: raw.siteName ?? '',
    siteDescription: raw.siteDescription ?? '',
    contactEmail: raw.contactEmail ?? '',
    defaultLanguage: raw.defaultLanguage || 'fa',
    timezone: raw.timezone || 'Asia/Tehran',
    postsPerPage: raw.postsPerPage || '10',
    allowComments: raw.allowComments === 'true',
    maintenanceMode: raw.maintenanceMode === 'true',
  }
}

export function SettingsView() {
  const can = useCan()
  const canManage = can('settings.manage')

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState<SettingsForm>(EMPTY_FORM)
  const [form, setForm] = React.useState<SettingsForm>(EMPTY_FORM)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<Record<string, string>>('/api/settings')
      const f = toForm(res ?? {})
      setLoaded(f)
      setForm(f)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت تنظیمات')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const dirty = React.useMemo(() => JSON.stringify(form) !== JSON.stringify(loaded), [form, loaded])

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManage) return
    if (!form.siteName.trim()) {
      toast.error('نام سامانه الزامی است.')
      return
    }
    const perPage = Number(form.postsPerPage)
    if (!Number.isFinite(perPage) || perPage < 5 || perPage > 50) {
      toast.error('تعداد آیتم در هر صفحه باید بین ۵ تا ۵۰ باشد.')
      return
    }
    setSaving(true)
    try {
      const res = await apiPut<Record<string, string>>('/api/settings', {
        values: {
          siteName: form.siteName.trim(),
          siteDescription: form.siteDescription.trim(),
          contactEmail: form.contactEmail.trim(),
          defaultLanguage: form.defaultLanguage,
          timezone: form.timezone,
          postsPerPage: perPage,
          allowComments: form.allowComments,
          maintenanceMode: form.maintenanceMode,
        },
      })
      const f = toForm(res ?? {})
      setLoaded(f)
      setForm(f)
      toast.success('تنظیمات ذخیره شد.')
      // راهنما: ذخیرهٔ موفق تنظیمات سایت
      void notifyGuideEvent('settings.saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطا در ذخیره تنظیمات')
    } finally {
      setSaving(false)
    }
  }

  const reset = () => setForm(loaded)

  if (loading) return <LoadingSpinner label="در حال بارگذاری تنظیمات…" />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div>
      <PageHeader
        title="تنظیمات"
        description="پیکربندی عمومی سامانه که در سایت عمومی و پنل مدیریت اعمال می‌شود"
        icon={<Settings className="h-5 w-5" />}
        actions={
          <Button type="submit" form="settings-form" disabled={!canManage || saving || !dirty} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
          </Button>
        }
      />

      {!canManage ? (
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>شما فقط اجازه مشاهده تنظیمات را دارید.</AlertDescription>
        </Alert>
      ) : null}

      {dirty && canManage ? (
        <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>تغییرات ذخیره‌نشده دارید</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>برای اعمال تغییرات، آن‌ها را ذخیره کنید.</span>
            <Button type="button" variant="outline" size="sm" onClick={reset} disabled={saving}>
              بازگردانی
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <form id="settings-form" onSubmit={submit} className="space-y-4 max-w-2xl" noValidate={false}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">شناسه سامانه</CardTitle>
            <CardDescription>نام و توضیحی که در سربرگ سایت و نتایج جست‌وجو نمایش داده می‌شود</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="نام سامانه" required htmlFor="siteName">
              <Input
                id="siteName"
                value={form.siteName}
                onChange={(e) => update('siteName', e.target.value)}
                maxLength={100}
                disabled={!canManage}
                required
              />
            </Field>
            <Field label="توضیح سامانه" htmlFor="siteDescription">
              <Textarea
                id="siteDescription"
                rows={2}
                value={form.siteDescription}
                onChange={(e) => update('siteDescription', e.target.value)}
                disabled={!canManage}
              />
            </Field>
            <Field label="ایمیل تماس" htmlFor="contactEmail" hint="این ایمیل برای دریافت پیام‌های سامانه و فرم‌ها استفاده می‌شود.">
              <Input
                id="contactEmail"
                type="email"
                dir="ltr"
                value={form.contactEmail}
                onChange={(e) => update('contactEmail', e.target.value)}
                disabled={!canManage}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ناحیه و زبان</CardTitle>
            <CardDescription>پیش‌فرض‌های نمایش تاریخ، اعداد و صفحه‌بندی</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="زبان پیش‌فرض" htmlFor="defaultLanguage">
              <Select
                value={form.defaultLanguage}
                onValueChange={(v) => update('defaultLanguage', v)}
                disabled={!canManage}
              >
                <SelectTrigger id="defaultLanguage" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fa">فارسی</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="منطقه زمانی" htmlFor="timezone">
              <Select value={form.timezone} onValueChange={(v) => update('timezone', v)} disabled={!canManage}>
                <SelectTrigger id="timezone" className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Tehran">تهران (UTC+03:30)</SelectItem>
                  <SelectItem value="UTC">هماهنگ جهانی</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="تعداد آیتم در هر صفحه" htmlFor="postsPerPage" hint="بین ۵ تا ۵۰ — در فهرست‌های عمومی سایت اعمال می‌شود.">
              <Input
                id="postsPerPage"
                type="number"
                min={5}
                max={50}
                value={form.postsPerPage}
                onChange={(e) => update('postsPerPage', e.target.value)}
                disabled={!canManage}
                className="w-full sm:w-32"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">رفتار سایت</CardTitle>
            <CardDescription>کنترل تعامل کاربران و دسترسی عمومی</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="allowComments" className="text-sm font-medium cursor-pointer">
                اجازه ثبت دیدگاه
              </Label>
              <Switch
                id="allowComments"
                checked={form.allowComments}
                onCheckedChange={(v) => update('allowComments', v)}
                disabled={!canManage}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1 min-w-0">
                <Label htmlFor="maintenanceMode" className="text-sm font-medium cursor-pointer">
                  حالت نگه‌داری سایت
                </Label>
                <p className="text-xs text-muted-foreground">در این حالت سایت عمومی پیام نگه‌داری نمایش می‌دهد.</p>
              </div>
              <Switch
                id="maintenanceMode"
                checked={form.maintenanceMode}
                onCheckedChange={(v) => update('maintenanceMode', v)}
                disabled={!canManage}
              />
            </div>
          </CardContent>
        </Card>

        {canManage ? (
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving || !dirty} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'در حال ذخیره…' : 'ذخیره تغییرات'}
            </Button>
            <Button type="button" variant="ghost" onClick={reset} disabled={saving || !dirty}>
              بازگردانی
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  )
}
