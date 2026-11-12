'use client'

/**
 * گزارش مشکل از داخل پنل — ارسال اطلاعات فنی غیرحساس همراه با
 * شناسه قابل‌ردگیری (کد SUP-XXXX) بدون نیاز به رفت‌وبرگشت با پشتیبانی.
 */

import * as React from 'react'
import { Copy, LifeBuoy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/shared/ui-bits'
import { apiPost } from '@/lib/client/api'

export function SupportReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [steps, setSteps] = React.useState('')
  const [errorInfo, setErrorInfo] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [ticketCode, setTicketCode] = React.useState<string | null>(null)
  const [page, setPage] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setPage(window.location.hash || '#/dashboard')
      setTicketCode(null)
      setSteps('')
      setErrorInfo('')
    }
  }, [open])

  const submit = async () => {
    if (steps.trim().length < 10) {
      toast.error('شرح مشکل باید حداقل ۱۰ نویسه باشد.')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiPost<{ code: string }>('/api/support', {
        page,
        steps: steps.trim(),
        errorInfo: errorInfo.trim() || undefined,
        userAgent: window.navigator.userAgent,
      })
      setTicketCode(res.code)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ارسال گزارش ناموفق بود.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-teal-600" aria-hidden />
            گزارش مشکل
          </DialogTitle>
          <DialogDescription>
            اطلاعات فنی غیرحساس (صفحه، زمان، نسخه مرورگر) به‌صورت خودکار ضمیمه می‌شود؛ نیازی به تصویر صفحه یا توضیح دوباره نیست.
          </DialogDescription>
        </DialogHeader>

        {ticketCode ? (
          <div className="space-y-4 py-2">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 p-4 text-center space-y-2">
              <p className="text-sm text-emerald-800 dark:text-emerald-200">گزارش شما با موفقیت ثبت شد. کد رهگیری:</p>
              <p className="text-2xl font-bold tracking-widest text-emerald-700 dark:text-emerald-300" dir="ltr">
                {ticketCode}
              </p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                با این کد، وضعیت رسیدگی قابل پیگیری است.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(ticketCode)
                  toast.success('کد رهگیری کپی شد.')
                }}
                className="gap-1.5"
              >
                <Copy className="h-4 w-4" aria-hidden />
                کپی کد
              </Button>
              <Button onClick={() => onOpenChange(false)}>بستن</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-1">
              <div className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                <p>
                  صفحه جاری: <span className="font-mono" dir="ltr">{page || '—'}</span>
                </p>
                <p>زمان رخداد و نسخه برنامه به‌صورت خودکار ثبت می‌شود.</p>
              </div>
              <Field label="مراحل وقوع مشکل و توضیح" htmlFor="support-steps" required>
                <Textarea
                  id="support-steps"
                  rows={4}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  placeholder="مثلاً: فیلتر وضعیت را روی «منتشرشده» گذاشتم و دکمه خروجی را زدم؛ فایل دانلود نشد…"
                />
              </Field>
              <Field label="اطلاعات خطا (اختیاری)" htmlFor="support-error" hint="متن خطا یا شناسه خطای مرورگر، در صورت وجود.">
                <Textarea
                  id="support-error"
                  rows={2}
                  value={errorInfo}
                  onChange={(e) => setErrorInfo(e.target.value)}
                  placeholder="مثلاً: TypeError …"
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                انصراف
              </Button>
              <Button onClick={submit} disabled={submitting || steps.trim().length < 10} className="gap-1.5">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LifeBuoy className="h-4 w-4" aria-hidden />}
                ارسال گزارش
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
