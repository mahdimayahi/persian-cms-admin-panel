'use client'

/**
 * گزارش مشکل v2 — فرم تشخیصی با پیش‌نمایش اطلاعات ارسالی، پیش‌نویس محلی،
 * تصویر صفحه با ابزار پوشاندن (ماسک پخته‌شده) و کد رهگیری قابل‌پیگیری.
 * رمز، توکن و کوکی هرگز جمع‌آوری نمی‌شوند.
 */

import * as React from 'react'
import { Copy, Eraser, History, ImagePlus, LifeBuoy, Loader2, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/shared/ui-bits'
import { apiPost } from '@/lib/client/api'
import { faDateTime } from '@/lib/client/format'
import { navigate } from '@/hooks/use-hash-route'

const DRAFT_KEY = 'support-draft-v2'

/** سقف محافظه‌کارانه طول data URL تصویر — زیر حد سرور (۲٬۰۰۰٬۰۰۰ نویسه) */
const MAX_SCREENSHOT_CHARS = 1_400_000
const MAX_FILE_BYTES = 1.4 * 1024 * 1024

const EMPTY_FORM: SupportForm = {
  subject: '',
  expectation: '',
  actual: '',
  steps: '',
  section: 'سایر',
  operationId: '',
  errorInfo: '',
}

type SupportForm = {
  subject: string
  expectation: string
  actual: string
  steps: string
  section: string
  operationId: string
  errorInfo: string
}

type SendResponse = { code: string; id: string; deduped?: boolean }

const SECTIONS = [
  'مقالات',
  'بسته‌های انتشار',
  'رسانه',
  'الگوها',
  'واژه‌نامه',
  'دیدگاه‌ها',
  'کاربران و دسترسی',
  'گزارش‌ها',
  'تنظیمات',
  'سایر',
] as const

/** استخراج نخستین کد خطا از متن (مانند ERR-1200، E42 یا 500) */
function extractErrorCode(text: string): string | null {
  const m = text.match(/\b(ERR|E|HTTP)[-_:]?\d{2,5}\b|\b\d{3}\b/)
  return m ? m[0] : null
}

/** مسیر صفحهٔ فعلی بدون query/hash — مقداری که به سرور ارسال می‌شود */
function cleanPagePath(): string {
  if (typeof window === 'undefined') return ''
  return (window.location.hash || '#/dashboard').split('?')[0]
}

/** شناسهٔ عملیات از آدرس فعلی (صفحهٔ مرکز عملیات) — در صورت وجود */
function operationIdFromHash(): string {
  if (typeof window === 'undefined') return ''
  const hash = window.location.hash
  if (!hash.includes('operations')) return ''
  const qIndex = hash.indexOf('?')
  if (qIndex < 0) return ''
  const sp = new URLSearchParams(hash.slice(qIndex + 1))
  return sp.get('op') || sp.get('id') || ''
}

/** تشخیص سادهٔ مرورگر از User-Agent (مطابق منطق سمت سرور) */
function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\/|Opera/i.test(ua)) return 'Opera'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/Chrome\//i.test(ua)) return 'Chrome'
  if (/Safari\//i.test(ua)) return 'Safari'
  return 'نامشخص'
}

// ─── ابزار پوشاندن تصویر ─────────────────────────────────────────
type MaskRect = { x: number; y: number; w: number; h: number }

const MASK_PREVIEW_COLOR = 'rgba(244, 63, 94, 0.45)' // قرمز نیمه‌شفاف هنگام کشیدن
const MASK_BAKE_COLOR = '#f43f5e' // قرمز مات — پس از اعمال، پخته و غیرقابل‌برداشتن

export function SupportReportDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** پس از ثبت موفق گزارش (برای بازیابی فهرست «گزارش‌های من») */
  onSuccess?: () => void
}) {
  const [form, setForm] = React.useState<SupportForm>(EMPTY_FORM)
  const [screenshot, setScreenshot] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [result, setResult] = React.useState<SendResponse | null>(null)
  const [occurredAt, setOccurredAt] = React.useState('')
  const [draftRestored, setDraftRestored] = React.useState(false)

  // کلیدهای اختیاری ارسال — فقط موارد علامت‌خورده در payload می‌روند
  const [includePage, setIncludePage] = React.useState(true)
  const [includeBrowser, setIncludeBrowser] = React.useState(true)
  const [includeErrorInfo, setIncludeErrorInfo] = React.useState(true)
  const [includeOperationId, setIncludeOperationId] = React.useState(true)

  // ابزار پوشاندن
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const drawingRef = React.useRef(false)
  const startRef = React.useRef<{ x: number; y: number } | null>(null)
  const rectsRef = React.useRef<MaskRect[]>([])
  const [rects, setRects] = React.useState<MaskRect[]>([])
  const [dragRect, setDragRect] = React.useState<MaskRect | null>(null)
  const [showMasking, setShowMasking] = React.useState(false)

  const pagePath = React.useMemo(() => (open ? cleanPagePath() : ''), [open])
  const browserName = React.useMemo(
    () => (typeof navigator !== 'undefined' ? detectBrowser(navigator.userAgent) : ''),
    []
  )
  const extractedError = React.useMemo(() => extractErrorCode(form.errorInfo), [form.errorInfo])

  // ── بازیابی پیش‌نویس و مقداردهی اولیه هنگام باز شدن ───────────────
  React.useEffect(() => {
    if (!open) return
    setResult(null)
    setScreenshot(null)
    setShowMasking(false)
    rectsRef.current = []
    setRects([])
    setDragRect(null)
    setOccurredAt(faDateTime(new Date().toISOString()))
    setIncludePage(true)
    setIncludeBrowser(true)
    setIncludeErrorInfo(true)
    setIncludeOperationId(true)
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const d = JSON.parse(raw) as Partial<SupportForm>
        const draft: SupportForm = {
          subject: d.subject ?? '',
          expectation: d.expectation ?? '',
          actual: d.actual ?? '',
          steps: d.steps ?? '',
          section: d.section || 'سایر',
          operationId: d.operationId || operationIdFromHash(),
          errorInfo: d.errorInfo ?? '',
        }
        setForm(draft)
        const hasAny = Object.values(draft).some((v) => v.trim() !== '')
        setDraftRestored(hasAny)
      } else {
        setForm({ ...EMPTY_FORM, operationId: operationIdFromHash() })
        setDraftRestored(false)
      }
    } catch {
      setForm({ ...EMPTY_FORM, operationId: operationIdFromHash() })
      setDraftRestored(false)
    }
  }, [open])

  // ── ذخیرهٔ پیش‌نویس در هر تغییر فیلد متنی ─────────────────────────
  React.useEffect(() => {
    if (!open || result) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    } catch {
      // حافظهٔ محلی در دسترس نیست — پیش‌نویس نادیده گرفته می‌شود
    }
  }, [form, open, result])

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      // بی‌اهمیت
    }
    setForm({ ...EMPTY_FORM, operationId: operationIdFromHash() })
    setDraftRestored(false)
    toast.success('پیش‌نویس پاک شد.')
  }

  // ── انتخاب تصویر (فایل یا چسباندن از کلیپ‌بورد) ──────────────────
  const applyScreenshotFile = React.useCallback((file: File) => {
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      toast.error('فقط تصویر PNG یا JPEG پذیرفته می‌شود.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error('حجم تصویر باید کمتر از ۱٫۴ مگابایت باشد.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl.startsWith('data:image/png') && !dataUrl.startsWith('data:image/jpeg')) {
        toast.error('قالب تصویر معتبر نیست.')
        return
      }
      if (dataUrl.length > MAX_SCREENSHOT_CHARS) {
        toast.error('حجم تصویر بیش از حد مجاز است؛ تصویر کوچک‌تری انتخاب کنید.')
        return
      }
      rectsRef.current = []
      setRects([])
      setDragRect(null)
      setShowMasking(false)
      setScreenshot(dataUrl)
    }
    reader.onerror = () => toast.error('خواندن تصویر ناموفق بود.')
    reader.readAsDataURL(file)
  }, [])

  // چسباندن تصویر از کلیپ‌بورد در حالت باز بودن گفت‌وگو
  React.useEffect(() => {
    if (!open || result) return
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type === 'image/png' || item.type === 'image/jpeg') {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            applyScreenshotFile(file)
          }
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open, result, applyScreenshotFile])

  // ── ترسیم پیش‌نمایش تصویر + مستطیل‌های پوشاننده ──────────────────
  React.useEffect(() => {
    if (!screenshot || !canvasRef.current) return
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      ctx.fillStyle = MASK_PREVIEW_COLOR
      for (const r of [...rectsRef.current, ...(dragRect ? [dragRect] : [])]) {
        ctx.fillRect(r.x, r.y, r.w, r.h)
      }
    }
    img.src = screenshot
  }, [screenshot, rects, dragRect, showMasking])

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const box = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - box.left) * canvas.width) / box.width,
      y: ((e.clientY - box.top) * canvas.height) / box.height,
    }
  }

  const onMaskPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true
    startRef.current = pointerPos(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onMaskPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !startRef.current) return
    const p = pointerPos(e)
    setDragRect({
      x: Math.min(startRef.current.x, p.x),
      y: Math.min(startRef.current.y, p.y),
      w: Math.abs(p.x - startRef.current.x),
      h: Math.abs(p.y - startRef.current.y),
    })
  }

  const onMaskPointerUp = () => {
    if (dragRect && dragRect.w > 6 && dragRect.h > 6) {
      rectsRef.current = [...rectsRef.current, dragRect]
      setRects(rectsRef.current)
    }
    setDragRect(null)
    drawingRef.current = false
    startRef.current = null
  }

  /** پختن پوشاندن‌ها: مستطیل‌های مات روی تصویر اصلی — بدون امکان برداشتن */
  const applyMasking = () => {
    if (!screenshot || rectsRef.current.length === 0) {
      toast.error('ابتدا با کشیدن روی تصویر ناحیهٔ موردنظر را انتخاب کنید.')
      return
    }
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      ctx.fillStyle = MASK_BAKE_COLOR
      for (const r of rectsRef.current) ctx.fillRect(r.x, r.y, r.w, r.h)
      const baked = canvas.toDataURL('image/png')
      rectsRef.current = []
      setRects([])
      setDragRect(null)
      setShowMasking(false)
      setScreenshot(baked)
      toast.success('پوشاندن اعمال شد و در فایل خروجی ثبت می‌شود.')
    }
    img.src = screenshot
  }

  const removeScreenshot = () => {
    setScreenshot(null)
    rectsRef.current = []
    setRects([])
    setDragRect(null)
    setShowMasking(false)
  }

  // ── ارسال ────────────────────────────────────────────────────────
  const submit = async () => {
    const subject = form.subject.trim()
    if (subject.length < 3) {
      toast.error('موضوع باید حداقل ۳ نویسه باشد.')
      return
    }
    if (!form.expectation.trim() && !form.actual.trim() && !form.steps.trim()) {
      toast.error('شرح مشکل را کامل کنید.')
      return
    }
    setSubmitting(true)
    try {
      // فقط موارد علامت‌خورده ارسال می‌شوند؛ بقیه کلاً از payload حذف می‌شوند
      const payload: Record<string, unknown> = {
        subject,
        expectation: form.expectation.trim(),
        actual: form.actual.trim(),
        steps: form.steps.trim(),
        section: form.section || 'سایر',
      }
      if (includePage) payload.page = pagePath
      if (includeBrowser) payload.userAgent = navigator.userAgent
      if (includeErrorInfo && form.errorInfo.trim()) payload.errorInfo = form.errorInfo.trim()
      if (includeOperationId && form.operationId.trim()) payload.operationId = form.operationId.trim()
      if (screenshot) payload.screenshot = screenshot

      const res = await apiPost<SendResponse>('/api/support', payload)
      // موفقیت: پیش‌نویس پاک می‌شود (در حالت خطا عمداً حفظ می‌ماند)
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        // بی‌اهمیت
      }
      setResult(res)
      setOccurredAt(faDateTime(new Date().toISOString()))
      onSuccess?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ارسال گزارش ناموفق بود.')
      toast.error('ارسال ناموفق بود؛ متن شما ذخیره ماند.')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForNew = () => {
    setResult(null)
    setForm({ ...EMPTY_FORM, operationId: operationIdFromHash() })
    setDraftRestored(false)
    setScreenshot(null)
    rectsRef.current = []
    setRects([])
    setDragRect(null)
    setShowMasking(false)
    setIncludePage(true)
    setIncludeBrowser(true)
    setIncludeErrorInfo(true)
    setIncludeOperationId(true)
    setOccurredAt(faDateTime(new Date().toISOString()))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-primary" aria-hidden />
            گزارش مشکل
          </DialogTitle>
          <DialogDescription>
            اطلاعات تشخیصی محدود و غیرحساس ضمیمه می‌شود؛ رمز، توکن و کوکی هرگز جمع‌آوری نمی‌شوند.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          // ─── حالت موفقیت ───────────────────────────────────────────
          <div className="space-y-4 py-2">
            <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-center space-y-2">
              <p className="text-sm text-success">گزارش شما با موفقیت ثبت شد. کد رهگیری:</p>
              <p className="text-2xl font-bold tracking-widest text-success" dir="ltr">
                {result.code}
              </p>
              {result.deduped ? (
                <p className="text-xs text-success/80">
                  گزارش مشابهی چند دقیقه پیش ثبت شده بود؛ همین کد برای آن معتبر است.
                </p>
              ) : (
                <p className="text-xs text-success/80">
                  وضعیت رسیدگی با این کد در «گزارش‌های من» قابل پیگیری است.
                </p>
              )}
            </div>
            <DialogFooter className="flex flex-wrap gap-2 sm:justify-start">
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(result.code)
                  toast.success('کد رهگیری کپی شد.')
                }}
                className="gap-1.5"
              >
                <Copy className="h-4 w-4" aria-hidden />
                کپی کد
              </Button>
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  onOpenChange(false)
                  navigate('/account')
                }}
              >
                پیگیری گزارش‌های من
              </Button>
              <Button onClick={resetForNew} className="gap-1.5">
                <LifeBuoy className="h-4 w-4" aria-hidden />
                ثبت گزارش جدید
              </Button>
            </DialogFooter>
          </div>
        ) : (
          // ─── فرم گزارش ─────────────────────────────────────────────
          <div className="space-y-4 py-1">
            {draftRestored ? (
              <Alert className="py-2.5">
                <History className="h-4 w-4" aria-hidden />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>پیش‌نویس ذخیره‌شدهٔ قبلی بازیابی شد.</span>
                  <Button type="button" size="sm" variant="ghost" onClick={clearDraft} className="h-7 gap-1 px-2 text-xs">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    پاک کردن پیش‌نویس
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <Field label="موضوع" htmlFor="support-subject" required hint="۳ تا ۱۵۰ نویسه">
              <Input
                id="support-subject"
                value={form.subject}
                maxLength={150}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="خلاصهٔ مشکل در یک جمله"
                aria-required="true"
              />
            </Field>

            <Field label="انتظار شما چه بود؟" htmlFor="support-expectation">
              <Textarea
                id="support-expectation"
                rows={2}
                value={form.expectation}
                onChange={(e) => setForm((f) => ({ ...f, expectation: e.target.value }))}
                placeholder="رفتار مورد انتظار سامانه"
              />
            </Field>

            <Field label="چه اتفاقی واقعاً افتاد؟" htmlFor="support-actual">
              <Textarea
                id="support-actual"
                rows={2}
                value={form.actual}
                onChange={(e) => setForm((f) => ({ ...f, actual: e.target.value }))}
                placeholder="رفتار مشاهده‌شده یا پیام خطا به زبان ساده"
              />
            </Field>

            <Field
              label="مراحل بازتولید"
              htmlFor="support-steps"
              hint="حداقل یکی از سه شرح بالا باید پر شود."
            >
              <Textarea
                id="support-steps"
                rows={3}
                value={form.steps}
                onChange={(e) => setForm((f) => ({ ...f, steps: e.target.value }))}
                placeholder="مثال: ۱. صفحهٔ بسته‌ها را باز کردم… ۲. روی انتشار فوری کلیک کردم"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="بخش مرتبط" htmlFor="support-section">
                <Select
                  value={form.section}
                  onValueChange={(v) => setForm((f) => ({ ...f, section: v }))}
                >
                  <SelectTrigger id="support-section" aria-label="انتخاب بخش مرتبط" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="شناسهٔ عملیات"
                htmlFor="support-operation"
                hint="اگر مشکل مربوط به یک عملیات دسته‌ای است، شناسهٔ آن از مرکز عملیات را وارد کنید."
              >
                <Input
                  id="support-operation"
                  dir="ltr"
                  className="font-mono"
                  value={form.operationId}
                  onChange={(e) => setForm((f) => ({ ...f, operationId: e.target.value }))}
                  placeholder="اختیاری"
                />
              </Field>
            </div>

            <Field
              label="کد خطا / اطلاعات خطا"
              htmlFor="support-error"
              hint="در صورت وجود؛ مانند ERR-1200 یا 500. کد استخراج‌شده در پیش‌نمایش ارسال نشان داده می‌شود."
            >
              <Input
                id="support-error"
                dir="ltr"
                className="font-mono"
                value={form.errorInfo}
                onChange={(e) => setForm((f) => ({ ...f, errorInfo: e.target.value }))}
                placeholder="اختیاری"
              />
            </Field>

            {/* ─── تصویر صفحه (اختیاری) ──────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">تصویر صفحه (اختیاری)</span>
                <span className="text-xs text-muted-foreground">PNG یا JPEG · حداکثر ۱٫۴ مگابایت</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) applyScreenshotFile(file)
                    e.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 ms-auto"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                  انتخاب تصویر
                </Button>
              </div>

              {screenshot ? (
                <div className="space-y-2">
                  <div className="relative rounded-xl border overflow-hidden bg-muted/40">
                    <canvas
                      ref={canvasRef}
                      className={
                        'block w-full h-auto ' + (showMasking ? 'cursor-crosshair touch-none' : '')
                      }
                      onPointerDown={showMasking ? onMaskPointerDown : undefined}
                      onPointerMove={showMasking ? onMaskPointerMove : undefined}
                      onPointerUp={showMasking ? onMaskPointerUp : undefined}
                      onPointerLeave={showMasking ? onMaskPointerUp : undefined}
                      aria-label="پیش‌نمایش تصویر صفحه"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch
                      checked={showMasking}
                      onCheckedChange={setShowMasking}
                      id="support-mask-toggle"
                      aria-label="فعال‌سازی ابزار پوشاندن"
                    />
                    <label htmlFor="support-mask-toggle" className="text-xs text-muted-foreground select-none">
                      ابزار پوشاندن {showMasking ? 'فعال — با کشیدن روی تصویر ناحیه را بپوشانید' : '— برای پنهان‌کردن بخش‌های حساس فعال کنید'}
                    </label>
                    {rects.length > 0 ? (
                      <Button type="button" size="sm" onClick={applyMasking} className="gap-1.5 ms-auto">
                        <Eraser className="h-3.5 w-3.5" aria-hidden />
                        اعمال پوشاندن
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={removeScreenshot} className="gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      حذف تصویر
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    پس از «اعمال پوشاندن»، ناحیه‌ها به‌صورت پخته‌شده در خود تصویر ثبت می‌شوند و قابل برداشتن نیستند.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  می‌توانید تصویر را انتخاب کنید یا با Ctrl+V از کلیپ‌بورد بچسبانید.
                </p>
              )}
            </div>

            <Separator />

            {/* ─── پیش‌نمایش اطلاعات ارسالی ──────────────────────────── */}
            <div className="rounded-xl border bg-muted/30 p-3 space-y-2.5">
              <p className="text-xs font-semibold">پیش‌نمایش اطلاعات ارسالی</p>
              <ul className="space-y-2 text-xs">
                <li className="flex items-center gap-2.5">
                  <Switch checked disabled aria-label="اطلاعات الزامی (همیشه ارسال می‌شود)" />
                  <span className="text-muted-foreground">الزامی:</span>
                  <span>موضوع، شرح مشکل، زمان وقوع ({occurredAt})</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Switch checked={includePage} onCheckedChange={setIncludePage} aria-label="ارسال مسیر صفحه" />
                  <span className="text-muted-foreground">مسیر صفحه:</span>
                  <span className="font-mono" dir="ltr">{pagePath || '—'}</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Switch checked={includeBrowser} onCheckedChange={setIncludeBrowser} aria-label="ارسال نوع مرورگر" />
                  <span className="text-muted-foreground">نوع مرورگر:</span>
                  <span>{browserName}</span>
                </li>
                {extractedError ? (
                  <li className="flex items-center gap-2.5">
                    <Switch checked={includeErrorInfo} onCheckedChange={setIncludeErrorInfo} aria-label="ارسال کد خطا" />
                    <span className="text-muted-foreground">کد خطا:</span>
                    <span className="font-mono" dir="ltr">{extractedError}</span>
                  </li>
                ) : null}
                {form.operationId.trim() ? (
                  <li className="flex items-center gap-2.5">
                    <Switch
                      checked={includeOperationId}
                      onCheckedChange={setIncludeOperationId}
                      aria-label="ارسال شناسهٔ عملیات"
                    />
                    <span className="text-muted-foreground">شناسهٔ عملیات:</span>
                    <span className="font-mono" dir="ltr">{form.operationId.trim()}</span>
                  </li>
                ) : null}
              </ul>
              <p className="text-[11px] leading-5 text-muted-foreground">
                پارامترهای حساس آدرس پیش از ارسال حذف می‌شوند؛ محتوای کامل فرم‌ها و بدنهٔ درخواست‌ها هرگز ارسال نمی‌شود.
              </p>
            </div>
          </div>
        )}

        {!result ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              انصراف
            </Button>
            <Button onClick={() => void submit()} disabled={submitting} className="gap-1.5">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {submitting ? 'در حال ارسال…' : 'ارسال گزارش'}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
