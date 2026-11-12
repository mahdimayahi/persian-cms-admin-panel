'use client'

/**
 * جست‌وجوی فرمان (Ctrl+K) — ناوبری سریع میان صفحه‌ها، اقدام‌های سریع،
 * علاقه‌مندی‌های کاربر و نتایج جست‌وجوی سراسری (مقاله/صفحه/فایل/کاربر).
 */

import * as React from 'react'
import {
  Activity,
  ArrowLeft,
  ClipboardPlus,
  FilePlus2,
  FileText,
  FolderTree,
  Gauge,
  HeartPulse,
  History,
  Image as ImageIcon,
  LayoutList,
  ListChecks,
  ListTree,
  Loader2,
  MessagesSquare,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Tags,
  Upload,
  UserRound,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { apiDelete, apiGet } from '@/lib/client/api'
import { navigate } from '@/hooks/use-hash-route'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'

/* ─── مقصدهای ناوبری ────────────────────────────────────────────── */
export const COMMAND_PALETTE_NAV: { label: string; href: string; perm: string | null; icon: React.ElementType }[] = [
  { label: 'داشبورد', href: '/dashboard', perm: null, icon: Gauge },
  { label: 'کارهای من', href: '/tasks', perm: null, icon: ListChecks },
  { label: 'مقالات', href: '/articles', perm: 'articles.view', icon: FileText },
  { label: 'دسته‌بندی‌ها', href: '/categories', perm: 'categories.manage', icon: FolderTree },
  { label: 'برچسب‌ها', href: '/tags', perm: 'tags.manage', icon: Tags },
  { label: 'دیدگاه‌ها', href: '/comments', perm: 'comments.view', icon: MessagesSquare },
  { label: 'کتابخانه فایل‌ها', href: '/media', perm: 'media.view', icon: ImageIcon },
  { label: 'صفحات', href: '/pages', perm: 'pages.view', icon: LayoutList },
  { label: 'منوها', href: '/menus', perm: 'menus.manage', icon: ListTree },
  { label: 'کاربران', href: '/users', perm: 'users.view', icon: Users },
  { label: 'نقش‌ها و مجوزها', href: '/roles', perm: 'roles.view', icon: ShieldCheck },
  { label: 'پاسخ‌های فرم‌ها', href: '/forms', perm: 'forms.view', icon: Wrench },
  { label: 'سلامت محتوا', href: '/health', perm: 'articles.view', icon: HeartPulse },
  { label: 'گزارش‌ها', href: '/reports', perm: 'reports.view', icon: Activity },
  { label: 'تاریخچه فعالیت‌ها', href: '/activity', perm: 'activity.view', icon: History },
  { label: 'تنظیمات', href: '/settings', perm: 'settings.view', icon: Settings },
  { label: 'حساب من', href: '/account', perm: null, icon: UserRound },
]

/* ─── اقدام‌های سریع ────────────────────────────────────────────── */
export const COMMAND_PALETTE_ACTIONS: { id: string; label: string; perm: string | null; icon: React.ElementType; href: string }[] = [
  { id: 'new-article', label: 'مقاله جدید', perm: 'articles.create', icon: FilePlus2, href: '/articles/new' },
  { id: 'new-task', label: 'واگذاری کار جدید', perm: null, icon: ClipboardPlus, href: '/tasks' },
  { id: 'upload-media', label: 'بارگذاری رسانه', perm: 'media.upload', icon: Upload, href: '/media' },
  { id: 'health-check', label: 'بررسی سلامت محتوا', perm: 'articles.view', icon: HeartPulse, href: '/health' },
]

type FavoriteItem = { id: string; itemType: string; itemId: string; title: string; path: string }

type SearchResult = {
  articles: { id: string; title: string; status: string }[]
  pages: { id: string; title: string; status: string }[]
  media: { id: string; originalName: string; mimeType: string }[]
  users: { id: string; name: string; email: string; role: string }[]
}

type PaletteItem = {
  key: string
  icon: React.ReactNode
  title: string
  subtitle?: string
  badge?: string
  onSelect: () => void
  /** عنصر انتهای ردیف (مثل دکمه حذف علاقه‌مندی) */
  trailing?: React.ReactNode
  /** اگر درست باشد، ردیف به‌جای button به‌صورت div با دکمه تودرتو رندر می‌شود */
  trailingInteractive?: boolean
}

type Section = { id: string; title: string; items: PaletteItem[] }

/** یکسان‌سازی ی/ك عربی با فارسی برای تطبیق جست‌وجو */
function normalizeFa(value: string): string {
  return value.replace(/\u064A/g, 'ی').replace(/\u0643/g, 'ک').toLowerCase().trim()
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const permissions = useAppStore((s) => s.permissions)
  const can = (perm: string | null) => !perm || permissions.includes(perm)

  const [q, setQ] = React.useState('')
  const [favorites, setFavorites] = React.useState<FavoriteItem[]>([])
  const [results, setResults] = React.useState<SearchResult | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [highlight, setHighlight] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const trimmed = q.trim()

  /* بارگذاری علاقه‌مندی‌ها و آماده‌سازی هنگام باز شدن پالت */
  const loadFavorites = React.useCallback(async () => {
    try {
      const res = await apiGet<{ items: FavoriteItem[] }>('/api/favorites')
      setFavorites(res.items ?? [])
    } catch {
      setFavorites([])
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    setQ('')
    setResults(null)
    setSearching(false)
    setHighlight(0)
    void loadFavorites()
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open, loadFavorites])

  /* جست‌وجوی سراسری با تأخیر ۲۵۰ میلی‌ثانیه (حداقل ۲ نویسه) */
  React.useEffect(() => {
    if (!open || trimmed.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<SearchResult>(`/api/search?q=${encodeURIComponent(trimmed)}`)
        if (!cancelled) setResults(res)
      } catch {
        if (!cancelled) setResults(null)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, trimmed])

  /* بازنشانی ردیف برجسته با تغییر عبارت جست‌وجو */
  React.useEffect(() => {
    setHighlight(0)
  }, [trimmed])

  /* نگه‌داشتن ردیف برجسته در دید */
  React.useEffect(() => {
    listRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false)
      navigate(href)
    },
    [onOpenChange]
  )

  const removeFavorite = React.useCallback(async (f: FavoriteItem) => {
    try {
      await apiDelete(`/api/favorites?itemType=${encodeURIComponent(f.itemType)}&itemId=${encodeURIComponent(f.itemId)}`)
      setFavorites((prev) => prev.filter((x) => x.id !== f.id))
    } catch {
      // خطای حذف علاقه‌مندی در پالت نادیده گرفته می‌شود
    }
  }, [])

  /* ─── ساخت بخش‌ها ─────────────────────────────────────────────── */
  const searchReady = trimmed.length >= 2
  const sections: Section[] = []

  // در حالت جست‌وجو فقط نتایج نمایش داده می‌شود تا Enter مستقیم به نتیجه برود
  if (!searchReady) {
    const favoriteItems: PaletteItem[] = favorites.map((f) => ({
    key: `fav-${f.id}`,
    icon: <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" aria-hidden />,
    title: f.title,
    onSelect: () => go(f.path),
    trailing: (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          void removeFavorite(f)
        }}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label="حذف از علاقه‌مندی‌ها"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    ),
    trailingInteractive: true,
  }))
  if (favoriteItems.length > 0) sections.push({ id: 'favorites', title: 'علاقه‌مندی‌ها', items: favoriteItems })

  const actionItems: PaletteItem[] = COMMAND_PALETTE_ACTIONS.filter((a) => can(a.perm)).map((a) => ({
    key: `action-${a.id}`,
    icon: <a.icon className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />,
    title: a.label,
    onSelect: () => go(a.href),
  }))
  if (actionItems.length > 0) sections.push({ id: 'actions', title: 'اقدام‌های سریع', items: actionItems })
  }

  if (!searchReady) {
  const pageItems: PaletteItem[] = COMMAND_PALETTE_NAV.filter(
    (n) => can(n.perm) && normalizeFa(n.label).includes(normalizeFa(trimmed))
  ).map((n) => ({
    key: `nav-${n.href}`,
    icon: <n.icon className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />,
    title: n.label,
    subtitle: n.href,
    onSelect: () => go(n.href),
  }))
  if (pageItems.length > 0) sections.push({ id: 'pages', title: 'صفحه‌ها', items: pageItems })
  }

  const searchItems: PaletteItem[] = []
  if (searchReady && results) {
    for (const a of results.articles) {
      searchItems.push({
        key: `sr-article-${a.id}`,
        icon: <FileText className="h-4 w-4 shrink-0 text-rose-600" aria-hidden />,
        title: a.title,
        badge: 'مقاله',
        onSelect: () => go(`#/articles/${a.id}/edit`),
      })
    }
    for (const p of results.pages) {
      searchItems.push({
        key: `sr-page-${p.id}`,
        icon: <LayoutList className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />,
        title: p.title,
        badge: 'صفحه',
        onSelect: () => go('/pages'),
      })
    }
    for (const m of results.media) {
      searchItems.push({
        key: `sr-media-${m.id}`,
        icon: <ImageIcon className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />,
        title: m.originalName,
        badge: 'فایل',
        onSelect: () => go('/media'),
      })
    }
    for (const u of results.users) {
      searchItems.push({
        key: `sr-user-${u.id}`,
        icon: <UserRound className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />,
        title: u.name,
        subtitle: u.email,
        badge: 'کاربر',
        onSelect: () => go('/users'),
      })
    }
  }
  if (searchItems.length > 0) sections.push({ id: 'search', title: 'نتایج جست‌وجو', items: searchItems })

  /* فهرست مسطح همه ردیف‌های قابل انتخاب برای ناوبری با کلید */
  const flat: { item: PaletteItem; sectionTitle: string | null }[] = []
  for (const s of sections) {
    for (const it of s.items) flat.push({ item: it, sectionTitle: s.title })
  }
  const safeHighlight = Math.min(highlight, Math.max(0, flat.length - 1))

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((i) => Math.min(i + 1, Math.max(0, flat.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = flat[safeHighlight]
      if (entry) entry.item.onSelect()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden rounded-2xl p-0" dir="rtl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>جست‌وجوی فرمان</DialogTitle>
          <DialogDescription>جست‌وجوی صفحه، مقاله، فایل یا کاربر و اجرای سریع فرمان‌ها</DialogDescription>
        </DialogHeader>

        <div className="relative border-b">
          <Search
            className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="جست‌وجوی صفحه، مقاله یا فرمان… (Ctrl+K)"
            aria-label="جست‌وجوی فرمان"
            autoComplete="off"
            className="h-12 rounded-none border-0 bg-transparent pe-4 ps-10 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {flat.map((entry, idx) => {
            const prevTitle = idx > 0 ? flat[idx - 1].sectionTitle : null
            const showHeader = entry.sectionTitle !== null && entry.sectionTitle !== prevTitle
            const highlighted = idx === safeHighlight
            const { item } = entry
            const rowClass = cn(
              'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-sm transition-colors',
              highlighted ? 'bg-muted' : 'hover:bg-muted/50'
            )
            return (
              <React.Fragment key={item.key}>
                {showHeader ? (
                  <p className="px-2 pb-1 pt-2.5 text-[11px] font-semibold text-muted-foreground">{entry.sectionTitle}</p>
                ) : null}
                {item.trailingInteractive ? (
                  <div
                    role="button"
                    tabIndex={-1}
                    onClick={item.onSelect}
                    onMouseMove={() => setHighlight(idx)}
                    data-highlighted={highlighted || undefined}
                    className={cn(rowClass, 'cursor-pointer')}
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <ArrowLeft
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity',
                        highlighted ? 'opacity-100' : 'opacity-0'
                      )}
                      aria-hidden
                    />
                    {item.trailing}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={item.onSelect}
                    onMouseMove={() => setHighlight(idx)}
                    data-highlighted={highlighted || undefined}
                    className={rowClass}
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.subtitle ? (
                      <span className="hidden max-w-32 shrink-0 truncate text-[11px] text-muted-foreground sm:block">
                        {item.subtitle}
                      </span>
                    ) : null}
                    {item.badge ? (
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        {item.badge}
                      </Badge>
                    ) : null}
                    <ArrowLeft
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity',
                        highlighted ? 'opacity-100' : 'opacity-0'
                      )}
                      aria-hidden
                    />
                  </button>
                )}
              </React.Fragment>
            )
          })}

          {searchReady && searching ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              در حال جست‌وجو…
            </div>
          ) : null}
          {searchReady && !searching && searchItems.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground" role="status">
              نتیجه‌ای یافت نشد.
            </p>
          ) : null}
          {flat.length === 0 && !searchReady ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">موردی برای نمایش نیست.</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded-md border bg-background px-1.5 py-0.5 font-sans">↑↓</kbd>
            حرکت
            <kbd className="ms-1.5 rounded-md border bg-background px-1.5 py-0.5 font-sans">↵</kbd>
            انتخاب
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded-md border bg-background px-1.5 py-0.5 font-sans">Esc</kbd>
            بستن
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
