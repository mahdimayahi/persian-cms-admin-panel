'use client'

/**
 * «نمایش سایت» — پنجره پیش‌نمایش سایت عمومی
 * محتوای منتشرشده (مقالات، صفحات، منو و تنظیمات) را شبیه یک سایت عمومی واقعی نشان می‌دهد؛
 * کاملاً نمایشی است و هیچ داده پیش‌نویس یا داخلی از پنل در آن دیده نمی‌شود.
 */

import * as React from 'react'
import {
  Eye,
  FileText,
  Globe,
  Loader2,
  Lock,
  Mail,
  Newspaper,
  RefreshCw,
  Wrench,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/shared/ui-bits'
import { mediaUrl } from '@/components/shared/media-picker'
import { apiGet } from '@/lib/client/api'
import { faDate, toFa } from '@/lib/client/format'
import { cn } from '@/lib/utils'

type SitePreviewData = {
  settings: {
    siteName: string
    siteDescription: string
    contactEmail: string
    maintenanceMode: boolean
  }
  menu: { id: string; label: string; url: string }[]
  articles: {
    id: string
    title: string
    slug: string
    excerpt: string
    publishedAt: string | null
    views: number
    coverImageId: string | null
    authorName: string
    categoryName: string | null
    categorySlug: string | null
  }[]
  pages: { id: string; title: string; slug: string }[]
}

/** نام دامنه نمایشی برای نوار نشانی مرورگر */
function fakeDomain(siteName: string): string {
  const base = siteName.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '') || 'my-site'
  return `https://www.${base}.ir/`
}

export function SitePreviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [data, setData] = React.useState<SitePreviewData | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<SitePreviewData>('/api/site-preview')
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'دریافت پیش‌نمایش سایت ناموفق بود.')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  const siteName = data?.settings.siteName ?? 'سایت من'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl h-[85vh] p-0 overflow-hidden flex flex-col gap-0 [&>button:last-of-type]:hidden"
        dir="rtl"
        aria-describedby={undefined}
      >
        {/* عنوان فقط برای صفحه‌خوان */}
        <DialogTitle className="sr-only">نمایش سایت</DialogTitle>
        <DialogDescription className="sr-only">
          پیش‌نمایش سایت عمومی با محتوای منتشرشده
        </DialogDescription>

        {/* نوار بالای پنجره — شبیه مرورگر */}
        <div className="flex items-center gap-3 border-b bg-muted/60 px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <div
            className="flex-1 max-w-md mx-auto flex items-center gap-1.5 rounded-full bg-background border px-3 py-1 text-xs text-muted-foreground font-mono"
            dir="ltr"
          >
            <Lock className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
            <span className="truncate">{fakeDomain(siteName)}</span>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Globe className="h-3 w-3" aria-hidden />
            پیش‌نمایش زنده
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg"
            onClick={load}
            disabled={loading}
            aria-label="بارگذاری مجدد پیش‌نمایش"
            title="بارگذاری مجدد"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-destructive"
            onClick={() => onOpenChange(false)}
            aria-label="بستن پیش‌نمایش سایت"
            title="بستن"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>

        {/* بدنه سایت */}
        <div className="flex-1 overflow-y-auto bg-white text-slate-800">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500" role="status" aria-live="polite">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              <span className="text-sm">در حال بارگذاری پیش‌نمایش…</span>
            </div>
          ) : error ? (
            <div className="p-6 bg-white">
              <ErrorState message={error} onRetry={load} />
            </div>
          ) : data ? (
            <SitePage data={data} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** رندر صفحه اصلی سایت عمومی */
function SitePage({ data }: { data: SitePreviewData }) {
  const { settings, menu, articles, pages } = data

  return (
    <div className="min-h-full flex flex-col" dir="rtl">
      {/* سربرگ سایت */}
      <header className="border-b border-slate-200 bg-white/95">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 px-6 h-14">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white flex items-center justify-center text-sm font-bold"
              aria-hidden
            >
              پ
            </span>
            <span className="font-bold text-sm truncate">{settings.siteName}</span>
          </div>
          {menu.length > 0 ? (
            <nav aria-label="منوی سایت" className="hidden md:flex items-center gap-1 overflow-hidden">
              {menu.slice(0, 6).map((m) => (
                <span
                  key={m.id}
                  className="px-2.5 py-1.5 rounded-lg text-[13px] text-slate-600 whitespace-nowrap"
                >
                  {m.label}
                </span>
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      {/* هشدار حالت نگه‌داری */}
      {settings.maintenanceMode ? (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5" role="status">
          <p className="max-w-5xl mx-auto flex items-center gap-2 text-xs text-amber-800">
            <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden />
            سایت در حالت نگه‌داری است؛ بازدیدکنندگان در این حالت پیام نگه‌داری می‌بینند و به محتوا دسترسی ندارند.
          </p>
        </div>
      ) : null}

      <main className="flex-1">
        {/* قهرمان */}
        <section className="bg-gradient-to-b from-emerald-50 to-white border-b border-slate-200">
          <div className="max-w-5xl mx-auto px-6 py-12 text-center">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight">
              {settings.siteName}
            </h1>
            {settings.siteDescription ? (
              <p className="mt-3 text-sm sm:text-base text-slate-600 leading-7 max-w-2xl mx-auto">
                {settings.siteDescription}
              </p>
            ) : null}
            <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-3.5 py-1.5 text-xs text-slate-600 shadow-xs">
              <Newspaper className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              {toFa(articles.length)} مقاله منتشرشده
            </p>
          </div>
        </section>

        {/* مقالات منتشرشده */}
        <section className="max-w-5xl mx-auto px-6 py-10" aria-label="آخرین مقالات منتشرشده">
          <h2 className="text-lg font-bold text-slate-900 mb-5">آخرین مطالب</h2>
          {articles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 py-14 text-center">
              <Newspaper className="h-10 w-10 mx-auto text-slate-300" aria-hidden />
              <p className="mt-3 font-medium text-slate-700">هنوز محتوایی منتشر نشده است</p>
              <p className="mt-1 text-sm text-slate-500">
                پس از انتشار اولین مقاله، اینجا به‌صورت خودکار نمایش داده می‌شود.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((a) => (
                <article
                  key={a.id}
                  className="group rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs transition-shadow hover:shadow-md"
                >
                  <div className="aspect-video bg-slate-100 relative overflow-hidden">
                    {a.coverImageId ? (
                      <img
                        src={mediaUrl(a.coverImageId)}
                        alt={a.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="h-full w-full bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center"
                        aria-hidden
                      >
                        <Newspaper className="h-8 w-8 text-emerald-300" />
                      </div>
                    )}
                    {a.categoryName ? (
                      <span className="absolute top-2.5 start-2.5 rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 shadow-xs">
                        {a.categoryName}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-[15px] leading-6 text-slate-900 line-clamp-2">{a.title}</h3>
                    {a.excerpt ? (
                      <p className="mt-1.5 text-[13px] text-slate-600 leading-6 line-clamp-3">{a.excerpt}</p>
                    ) : null}
                    <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500 border-t border-slate-100 pt-2.5">
                      {a.authorName ? (
                        <span className="truncate">{a.authorName}</span>
                      ) : null}
                      <span className="shrink-0">{faDate(a.publishedAt)}</span>
                      <span className="ms-auto inline-flex shrink-0 items-center gap-1 tabular-nums">
                        <Eye className="h-3 w-3" aria-hidden />
                        {toFa(a.views)}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* پانویس سایت */}
      <footer className="mt-auto bg-slate-900 text-slate-300">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <span
              className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white flex items-center justify-center text-sm font-bold"
              aria-hidden
            >
              پ
            </span>
            <div>
              <p className="text-sm font-bold text-white">{settings.siteName}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                © {toFa(new Date().getFullYear())} — همه حقوق محفوظ است.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 text-[13px]">
            {pages.length > 0 ? (
              <nav aria-label="صفحات سایت" className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {pages.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 text-slate-300 hover:text-white transition-colors cursor-default">
                    <FileText className="h-3 w-3 text-slate-500" aria-hidden />
                    {p.title}
                  </span>
                ))}
              </nav>
            ) : null}
            {settings.contactEmail ? (
              <p className="inline-flex items-center gap-1.5 text-slate-400" dir="ltr">
                <Mail className="h-3 w-3 shrink-0" aria-hidden />
                <span dir="ltr">{settings.contactEmail}</span>
              </p>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  )
}
