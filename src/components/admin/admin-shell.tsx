'use client'

import * as React from 'react'
import {
  Activity,
  Bell,
  ChevronDown,
  FileText,
  FolderTree,
  Gauge,
  Image as ImageIcon,
  LayoutList,
  LogOut,
  Menu as MenuIcon,
  MessagesSquare,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Tags,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiPost, apiPut } from '@/lib/client/api'
import { timeAgo, toFa } from '@/lib/client/format'
import { useAppStore } from '@/store/app-store'
import { ROLE_LABELS, type Role } from '@/lib/permissions'
import { cn } from '@/lib/utils'

type NavItem = { label: string; href: string; perm: string | null; icon: React.ElementType }
type NavGroup = { group: string | null; items: NavItem[] }

const MENU: NavGroup[] = [
  { group: null, items: [{ label: 'داشبورد', href: '/dashboard', perm: null, icon: Gauge }] },
  {
    group: 'محتوا',
    items: [
      { label: 'مقالات', href: '/articles', perm: 'articles.view', icon: FileText },
      { label: 'دسته‌بندی‌ها', href: '/categories', perm: 'categories.manage', icon: FolderTree },
      { label: 'برچسب‌ها', href: '/tags', perm: 'tags.manage', icon: Tags },
      { label: 'دیدگاه‌ها', href: '/comments', perm: 'comments.view', icon: MessagesSquare },
    ],
  },
  {
    group: 'رسانه',
    items: [{ label: 'کتابخانه فایل‌ها', href: '/media', perm: 'media.view', icon: ImageIcon }],
  },
  {
    group: 'ساختار سایت',
    items: [
      { label: 'صفحات', href: '/pages', perm: 'pages.view', icon: LayoutList },
      { label: 'منوها', href: '/menus', perm: 'menus.manage', icon: ChevronDown },
    ],
  },
  {
    group: 'کاربران و دسترسی',
    items: [
      { label: 'کاربران', href: '/users', perm: 'users.view', icon: Users },
      { label: 'نقش‌ها و مجوزها', href: '/roles', perm: 'roles.view', icon: ShieldCheck },
    ],
  },
  {
    group: 'فرم‌ها',
    items: [{ label: 'پاسخ‌های دریافتی', href: '/forms', perm: 'forms.view', icon: Wrench }],
  },
  {
    group: 'پایش و گزارش',
    items: [
      { label: 'گزارش‌ها', href: '/reports', perm: 'reports.view', icon: Activity },
      { label: 'تاریخچه فعالیت‌ها', href: '/activity', perm: 'activity.view', icon: Activity },
      { label: 'تنظیمات', href: '/settings', perm: 'settings.view', icon: Settings },
    ],
  },
]

const BREADCRUMBS: Record<string, string> = {
  '/dashboard': 'داشبورد',
  '/articles': 'مقالات',
  '/categories': 'دسته‌بندی‌ها',
  '/tags': 'برچسب‌ها',
  '/comments': 'دیدگاه‌ها',
  '/media': 'کتابخانه فایل‌ها',
  '/pages': 'صفحات',
  '/menus': 'منوها',
  '/users': 'کاربران',
  '/roles': 'نقش‌ها و مجوزها',
  '/forms': 'پاسخ‌های دریافتی',
  '/reports': 'گزارش‌ها',
  '/activity': 'تاریخچه فعالیت‌ها',
  '/settings': 'تنظیمات',
  '/account': 'حساب من',
}

type SearchResult = {
  articles: { id: string; title: string; status: string }[]
  pages: { id: string; title: string; status: string }[]
  media: { id: string; originalName: string; mimeType: string }[]
  users: { id: string; name: string; email: string; role: string }[]
}

type NotificationItem = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

export function SidebarContent({
  path,
  navigate,
  onNavigate,
}: {
  path: string
  navigate: (to: string) => void
  onNavigate?: () => void
}) {
  const permissions = useAppStore((s) => s.permissions)
  const can = (perm: string | null) => !perm || permissions.includes(perm)

  const isActive = (href: string) => path === href || path.startsWith(href + '/')

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">پ</div>
          <div>
            <p className="font-bold text-sm leading-5">پنل مدیریت محتوا</p>
            <p className="text-xs text-muted-foreground">سامانه عملیاتی محتوا</p>
          </div>
        </div>
      </div>
      <ScrollArea className="flex-1 px-3 py-4">
        <nav aria-label="منوی اصلی" className="space-y-5">
          {MENU.map((group, gi) => {
            const visibleItems = group.items.filter((it) => can(it.perm))
            if (visibleItems.length === 0) return null
            return (
              <div key={group.group ?? gi}>
                {group.group ? <p className="text-xs font-medium text-muted-foreground px-2.5 mb-1.5">{group.group}</p> : null}
                <ul className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.href)
                    return (
                      <li key={item.href}>
                        <button
                          type="button"
                          onClick={() => {
                            navigate(item.href)
                            onNavigate?.()
                          }}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors text-start',
                            active ? 'bg-primary text-primary-foreground font-medium' : 'text-foreground/80 hover:bg-muted'
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden />
                          {item.label}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
          <div>
            <ul>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/account')
                    onNavigate?.()
                  }}
                  aria-current={path.startsWith('/account') ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors text-start',
                    path.startsWith('/account') ? 'bg-primary text-primary-foreground font-medium' : 'text-foreground/80 hover:bg-muted'
                  )}
                >
                  <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                  حساب من
                </button>
              </li>
            </ul>
          </div>
        </nav>
      </ScrollArea>
      <div className="border-t px-5 py-3">
        <p className="text-xs text-muted-foreground">نسخه {toFa(1.0, { maximumFractionDigits: 1 })} · عملیات حساس ثبت می‌شوند</p>
      </div>
    </div>
  )
}

function NotificationsBell() {
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<NotificationItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const unreadCount = useAppStore((s) => s.unreadCount)
  const setUnreadCount = useAppStore((s) => s.setUnreadCount)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet<{ items: NotificationItem[]; unreadCount: number }>('/api/notifications?pageSize=15')
      setItems(res.items)
      setUnreadCount(res.unreadCount)
    } catch {
      // بی‌صدا: اعلان حیاتی نیست
    } finally {
      setLoading(false)
    }
  }, [setUnreadCount])

  React.useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const markRead = async (id?: string) => {
    try {
      await apiPut('/api/notifications/read', id ? { ids: [id] } : { all: true })
      await load()
    } catch {
      toast.error('ثبت وضعیت اعلان ناموفق بود.')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`اعلان‌ها${unreadCount ? `، ${toFa(unreadCount)} خوانده‌نشده` : ''}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute -top-0.5 -end-0.5 h-4 min-w-4 rounded-full bg-destructive text-[10px] leading-4 text-white flex items-center justify-center px-1">
              {unreadCount > 9 ? '۹+' : toFa(unreadCount)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" dir="rtl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="font-semibold text-sm">اعلان‌ها</p>
          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => markRead()}>
              خواندن همه
            </Button>
          ) : null}
        </div>
        <ScrollArea className="h-80">
          {loading && items.length === 0 ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">اعلانی وجود ندارد.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={cn('w-full text-start px-4 py-3 hover:bg-muted/60 transition', !n.read && 'bg-primary/5')}
                    onClick={() => {
                      if (!n.read) markRead(n.id)
                      setOpen(false)
                      if (n.link) window.location.hash = n.link.replace(/^#/, '')
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-sm leading-5', !n.read && 'font-semibold')}>{n.title}</p>
                      {!n.read ? <span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" aria-label="خوانده‌نشده" /> : null}
                    </div>
                    {n.body ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.body}</p> : null}
                    <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function GlobalSearch() {
  const [q, setQ] = React.useState('')
  const [results, setResults] = React.useState<SearchResult | null>(null)
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const boxRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null)
      setOpen(false)
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await apiGet<SearchResult>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        setResults(res)
        setOpen(true)
      } catch {
        setResults(null)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const go = (hash: string) => {
    setOpen(false)
    setQ('')
    window.location.hash = hash.replace(/^#/, '')
  }

  const hasResults = results && results.articles.length + results.pages.length + results.media.length + results.users.length > 0

  return (
    <div ref={boxRef} className="relative w-full max-w-sm hidden md:block" role="search">
      <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (q.trim().length >= 2 && results) setOpen(true)
        }}
        placeholder="جست‌وجوی سراسری…"
        className="ps-8 bg-muted/50 border-transparent focus-visible:bg-background"
        aria-label="جست‌وجوی سراسری"
      />
      {open ? (
        <div className="absolute top-full mt-2 w-full rounded-lg border bg-popover shadow-md z-50 overflow-hidden">
          {loading ? (
            <p className="text-sm text-muted-foreground p-4">در حال جست‌وجو…</p>
          ) : !hasResults ? (
            <p className="text-sm text-muted-foreground p-4">نتیجه‌ای یافت نشد.</p>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="p-2 space-y-3">
                {results!.articles.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">مقالات</p>
                    {results!.articles.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => go(`#/articles/${a.id}/edit`)}
                        className="w-full text-start px-2 py-1.5 rounded hover:bg-muted text-sm flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{a.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">مقاله</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {results!.pages.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">صفحات</p>
                    {results!.pages.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => go('#/pages')}
                        className="w-full text-start px-2 py-1.5 rounded hover:bg-muted text-sm flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{p.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">صفحه</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {results!.media.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">رسانه</p>
                    {results!.media.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => go('#/media')}
                        className="w-full text-start px-2 py-1.5 rounded hover:bg-muted text-sm flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{m.originalName}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">فایل</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {results!.users.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground px-2 py-1">کاربران</p>
                    {results!.users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => go('#/users')}
                        className="w-full text-start px-2 py-1.5 rounded hover:bg-muted text-sm flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{u.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">کاربر</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          )}
        </div>
      ) : null}
    </div>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={mounted && theme === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره'}
    >
      {mounted && theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}

function UserMenu() {
  const user = useAppStore((s) => s.user)
  const logout = useAppStore((s) => s.logout)
  if (!user) return null
  const doLogout = async () => {
    try {
      await apiPost('/api/auth/logout')
    } catch {
      // حتی در صورت خطا، از پنل خارج می‌شویم
    }
    logout()
    toast.success('با موفقیت خارج شدید.')
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="منوی حساب کاربری"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden lg:inline text-sm font-medium">{user.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden lg:inline" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="font-semibold">{user.name}</p>
          <p className="text-xs text-muted-foreground font-normal text-start" dir="ltr">
            {user.email}
          </p>
          <Badge variant="secondary" className="mt-1.5 pointer-events-none">
            {ROLE_LABELS[user.role as Role] ?? user.role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => (window.location.hash = '/account')}>
          <UserRound className="h-4 w-4 me-2" />
          پروفایل و امنیت
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={doLogout}>
          <LogOut className="h-4 w-4 me-2" />
          خروج از حساب
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AdminShell({
  path,
  navigate,
  children,
}: {
  path: string
  navigate: (to: string) => void
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const base = '/' + (path.split('/').filter(Boolean)[0] ?? 'dashboard')
  const crumb = BREADCRUMBS[base] ?? 'پنل مدیریت'
  const deepLabels: Record<string, string> = {
    '/articles/new': 'مقاله جدید',
    '/account/security': 'امنیت',
  }
  const subCrumb = path.startsWith('/articles/') && path !== '/articles' ? (path === '/articles/new' ? 'مقاله جدید' : 'ویرایش مقاله') : deepLabels[path]

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[100] focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-1.5 focus:rounded-md"
      >
        پرش به محتوای اصلی
      </a>
      <div className="flex flex-1 min-h-0">
        {/* نوار کناری — دسکتاپ */}
        <aside className="hidden lg:block w-64 shrink-0 border-e bg-background" aria-label="نوار کناری">
          <div className="sticky top-0 h-screen">
            <SidebarContent path={path} navigate={navigate} />
          </div>
        </aside>

        {/* نوار کناری — موبایل */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="right" className="p-0 w-72" dir="rtl">
            <SheetTitle className="sr-only">منوی اصلی</SheetTitle>
            <SidebarContent path={path} navigate={navigate} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex-1 flex flex-col min-w-0">
          {/* سربرگ */}
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="flex items-center gap-2 px-4 h-14">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden" aria-label="بازکردن منو">
                    <MenuIcon className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="p-0 w-72" dir="rtl">
                  <SheetTitle className="sr-only">منوی اصلی</SheetTitle>
                  <SidebarContent path={path} navigate={navigate} />
                </SheetContent>
              </Sheet>
              <GlobalSearch />
              <div className="flex-1" />
              <NotificationsBell />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>

          {/* مسیر راهنما */}
          <div className="px-4 lg:px-6 pt-4">
            <nav aria-label="مسیر راهنما" className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>{crumb}</span>
              {subCrumb ? (
                <>
                  <span aria-hidden>/</span>
                  <span className="text-foreground font-medium">{subCrumb}</span>
                </>
              ) : null}
            </nav>
          </div>

          {/* محتوای اصلی */}
          <main id="main-content" className="flex-1 px-4 lg:px-6 py-4 pb-8 w-full max-w-7xl mx-auto">
            {children}
          </main>

          {/* فوتر چسبان */}
          <footer className="mt-auto border-t bg-background">
            <div className="px-4 lg:px-6 h-12 flex items-center justify-between gap-4 text-xs text-muted-foreground">
              <p>پنل مدیریت محتوا — سامانه عملیاتی تولید و انتشار محتوا</p>
              <p className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                سرویس فعال
              </p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
