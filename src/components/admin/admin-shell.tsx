'use client'

import * as React from 'react'
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronLeft,
  FileText,
  FolderTree,
  Gauge,
  Globe,
  HeartPulse,
  Home,
  LifeBuoy,
  ListOrdered,
  LayoutTemplate,
  CopyMinus,
  BookA,
  PackageOpen,
  Image as ImageIcon,
  LayoutList,
  ListChecks,
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
  X,
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
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiPost, apiPut } from '@/lib/client/api'
import { timeAgo, toFa } from '@/lib/client/format'
import { useAppStore } from '@/store/app-store'
import { ROLE_LABELS, type Role } from '@/lib/permissions'
import { CommandPalette } from '@/components/shared/command-palette'
import { SupportReportDialog } from '@/components/shared/support-dialog'
import { SitePreviewDialog } from '@/components/shared/site-preview-dialog'
import { cn } from '@/lib/utils'

type NavItem = { label: string; href: string; perm: string | null; icon: React.ElementType; action?: 'view-site' }
type NavGroup = { group: string | null; items: NavItem[] }

const MENU: NavGroup[] = [
  {
    group: null,
    items: [
      { label: 'داشبورد', href: '/dashboard', perm: null, icon: Gauge },
      { label: 'کارهای من', href: '/tasks', perm: null, icon: ListChecks },
    ],
  },
  {
    group: 'محتوا',
    items: [
      { label: 'مقالات', href: '/articles', perm: 'articles.view', icon: FileText },
      { label: 'دسته‌بندی‌ها', href: '/categories', perm: 'categories.manage', icon: FolderTree },
      { label: 'برچسب‌ها', href: '/tags', perm: 'tags.manage', icon: Tags },
      { label: 'دیدگاه‌ها', href: '/comments', perm: 'comments.view', icon: MessagesSquare },
      { label: 'بسته‌های انتشار', href: '/bundles', perm: 'articles.view', icon: PackageOpen },
      { label: 'الگوهای محتوا', href: '/templates', perm: 'articles.view', icon: LayoutTemplate },
      { label: 'موارد مشابه', href: '/duplicates', perm: 'articles.view', icon: CopyMinus },
      { label: 'واژه‌نامه', href: '/glossary', perm: 'articles.view', icon: BookA },
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
      { label: 'نمایش سایت', href: '/site-preview', perm: null, icon: Globe, action: 'view-site' },
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
      { label: 'سلامت محتوا', href: '/health', perm: 'articles.view', icon: HeartPulse },
      { label: 'مرکز عملیات', href: '/operations', perm: null, icon: ListOrdered },
      { label: 'گزارش‌های پشتیبانی', href: '/support', perm: 'users.manage', icon: LifeBuoy },
      { label: 'گزارش‌ها', href: '/reports', perm: 'reports.view', icon: Activity },
      { label: 'تاریخچه فعالیت‌ها', href: '/activity', perm: 'activity.view', icon: Activity },
      { label: 'تنظیمات', href: '/settings', perm: 'settings.view', icon: Settings },
    ],
  },
]

const BREADCRUMBS: Record<string, string> = {
  '/dashboard': 'داشبورد',
  '/tasks': 'کارهای من',
  '/health': 'سلامت محتوا',
  '/bundles': 'بسته‌های انتشار',
  '/operations': 'مرکز عملیات',
  '/templates': 'الگوهای محتوا',
  '/duplicates': 'موارد مشابه',
  '/glossary': 'واژه‌نامه',
  '/support': 'گزارش‌های پشتیبانی',
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

/** تعداد کارهای منتظر کاربر برای نشان منوی «کارهای من» */
type TaskBadgeCounts = { awaitingReview: number; openTasks: number; overdueReviews: number }

export function useTaskBadge() {
  const [counts, setCounts] = React.useState<TaskBadgeCounts | null>(null)
  const load = React.useCallback(async () => {
    try {
      const res = await apiGet<TaskBadgeCounts & Record<string, unknown>>('/api/tasks')
      setCounts({
        awaitingReview: (res as unknown as { counts?: TaskBadgeCounts }).counts?.awaitingReview ?? 0,
        openTasks: (res as unknown as { counts?: TaskBadgeCounts }).counts?.openTasks ?? 0,
        overdueReviews: (res as unknown as { counts?: TaskBadgeCounts }).counts?.overdueReviews ?? 0,
      })
    } catch {
      // بی‌صدا: نشان حیاتی نیست
    }
  }, [])
  React.useEffect(() => {
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [load])
  return counts
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

/* ─── محتوای نوار کناری (تم تیره ثابت) ───────────────────────── */
export function SidebarContent({
  path,
  navigate,
  onNavigate,
  taskBadge,
  onViewSite,
}: {
  path: string
  navigate: (to: string) => void
  onNavigate?: () => void
  taskBadge?: TaskBadgeCounts | null
  onViewSite?: () => void
}) {
  const permissions = useAppStore((s) => s.permissions)
  const can = (perm: string | null) => !perm || permissions.includes(perm)

  const isActive = (href: string) => path === href || path.startsWith(href + '/')
  const taskBadgeCount = taskBadge ? taskBadge.openTasks + taskBadge.awaitingReview : 0

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* برند */}
      <div className="relative px-5 pt-5 pb-4 border-b border-sidebar-border overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-l from-primary/15 to-transparent" aria-hidden />
        <div className="relative flex items-center gap-3">
          <div className="logo-ring animate-gradient-x h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-chart-3 text-primary-foreground flex items-center justify-center text-lg font-bold shrink-0">
            پ
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm leading-5 truncate">پنل مدیریت محتوا</p>
            <p className="text-[11px] text-sidebar-foreground/55">سامانه عملیاتی محتوا</p>
          </div>
        </div>
      </div>

      {/* منو */}
      <ScrollArea className="flex-1 min-h-0 px-3 py-4">
        <nav aria-label="منوی اصلی" className="space-y-6">
          {MENU.map((group, gi) => {
            const visibleItems = group.items.filter((it) => can(it.perm))
            if (visibleItems.length === 0) return null
            return (
              <div key={group.group ?? gi}>
                {group.group ? (
                  <p className="text-[10px] font-semibold tracking-widest text-sidebar-foreground/40 px-3 mb-2">
                    {group.group}
                  </p>
                ) : null}
                <ul className="space-y-1">
                  {visibleItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.href)
                    return (
                      <li key={item.href} className="relative">
                        {/* نشانگر فعال */}
                        {active ? (
                          <span
                            className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-gradient-to-b from-primary to-chart-3"
                            aria-hidden
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            if (item.action === 'view-site') onViewSite?.()
                            else navigate(item.href)
                            onNavigate?.()
                          }}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'group w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all text-start',
                            active
                              ? 'bg-sidebar-primary/20 text-sidebar-primary-foreground font-semibold shadow-sm'
                              : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-foreground/5'
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-4 w-4 shrink-0 transition-colors',
                              active ? 'text-chart-2' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'
                            )}
                            aria-hidden
                          />
                          {item.label}
                          {item.href === '/tasks' && taskBadgeCount > 0 ? (
                            <span className="ms-auto rounded-full bg-gradient-to-br from-destructive to-chart-4 px-1.5 min-w-4.5 text-[10px] leading-4 text-white text-center shadow-sm tabular-nums">
                              {taskBadgeCount > 9 ? '۹+' : toFa(taskBadgeCount)}
                            </span>
                          ) : active ? (
                            <ChevronLeft className="h-3.5 w-3.5 ms-auto text-chart-2/70" aria-hidden />
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-sidebar-foreground/40 px-3 mb-2">حساب</p>
            <ul>
              <li className="relative">
                {path.startsWith('/account') ? (
                  <span
                    className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-gradient-to-b from-primary to-chart-3"
                    aria-hidden
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    navigate('/account')
                    onNavigate?.()
                  }}
                  aria-current={path.startsWith('/account') ? 'page' : undefined}
                  className={cn(
                    'group w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all text-start',
                    path.startsWith('/account')
                      ? 'bg-sidebar-primary/20 text-sidebar-primary-foreground font-semibold shadow-sm'
                      : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-foreground/5'
                  )}
                >
                  <UserRound
                    className={cn(
                      'h-4 w-4 shrink-0',
                      path.startsWith('/account') ? 'text-chart-2' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'
                    )}
                    aria-hidden
                  />
                  حساب من
                </button>
              </li>
            </ul>
          </div>
        </nav>
      </ScrollArea>

      {/* پانویس نوار کناری */}
      <div className="border-t border-sidebar-border px-5 py-3.5">
        <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/45">
          <span className="h-1.5 w-1.5 rounded-full bg-chart-2 shadow-[0_0_8px_oklch(0.75_0.135_80)]" aria-hidden />
          نسخه {toFa(2, { maximumFractionDigits: 0 })} — طراحی زمردی
        </div>
      </div>
    </div>
  )
}

/* ─── اعلان‌ها ───────────────────────────────────────────────── */
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
          className="relative rounded-xl hover:bg-muted"
          aria-label={`اعلان‌ها${unreadCount ? `، ${toFa(unreadCount)} خوانده‌نشده` : ''}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute -top-0.5 -end-0.5 h-4.5 min-w-4.5 rounded-full bg-gradient-to-br from-destructive to-chart-4 text-[10px] leading-4 text-white flex items-center justify-center px-1 shadow-sm">
              {unreadCount > 9 ? '۹+' : toFa(unreadCount)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 rounded-2xl" dir="rtl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="font-semibold text-sm flex items-center gap-2">
            اعلان‌ها
            {unreadCount > 0 ? (
              <span className="rounded-full bg-primary/10 text-primary text-[10px] px-2 py-0.5 font-semibold">
                {toFa(unreadCount)} جدید
              </span>
            ) : null}
          </p>
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
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
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

/* ─── پالت فرمان (Ctrl+K) ─────────────────────────────────── */
function CommandTrigger({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'hidden md:flex w-full max-w-xs items-center gap-2 rounded-xl bg-muted/60 border border-transparent px-3 h-9.5 text-sm text-muted-foreground hover:border-ring hover:bg-background transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      aria-label="بازکردن جست‌وجوی فرمان (Ctrl+K)"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 text-start truncate">جست‌وجو و فرمان…</span>
      <kbd className="rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-sans text-muted-foreground shadow-xs" dir="ltr">
        Ctrl K
      </kbd>
    </button>
  )
}

/* ─── تغییر تم ───────────────────────────────────────────────── */
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-xl hover:bg-muted"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={mounted && theme === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره'}
    >
      {mounted && theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}

/* ─── منوی کاربر ─────────────────────────────────────────────── */
function UserMenu({ onReport }: { onReport: () => void }) {
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
          className="flex items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted p-1 ps-2 transition-colors"
          aria-label="منوی حساب کاربری"
        >
          <Avatar className="h-8 w-8 ring-2 ring-primary/20">
            <AvatarFallback className="bg-gradient-to-br from-primary to-chart-3 text-primary-foreground text-xs font-bold">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden lg:inline text-sm font-medium">{user.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden lg:inline" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl">
        <DropdownMenuLabel>
          <p className="font-semibold">{user.name}</p>
          <p className="text-xs text-muted-foreground font-normal text-start" dir="ltr">
            {user.email}
          </p>
          <Badge variant="secondary" className="mt-1.5 pointer-events-none bg-primary/10 text-primary">
            {ROLE_LABELS[user.role as Role] ?? user.role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => (window.location.hash = '/account')}>
          <UserRound className="h-4 w-4 me-2" />
          پروفایل و امنیت
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onReport}>
          <LifeBuoy className="h-4 w-4 me-2" />
          گزارش مشکل
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={doLogout}>
          <LogOut className="h-4 w-4 me-2" />
          خروج از حساب
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ─── پوسته اصلی پنل ─────────────────────────────────────────── */
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
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [supportOpen, setSupportOpen] = React.useState(false)
  const [sitePreviewOpen, setSitePreviewOpen] = React.useState(false)
  const taskBadge = useTaskBadge()

  // میان‌بر Ctrl+K / Cmd+K برای پالت فرمان
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const base = '/' + (path.split('/').filter(Boolean)[0] ?? 'dashboard')
  const crumb = BREADCRUMBS[base] ?? 'پنل مدیریت'
  const deepLabels: Record<string, string> = {
    '/articles/new': 'مقاله جدید',
    '/account/security': 'امنیت',
  }
  const subCrumb =
    path.startsWith('/articles/') && path !== '/articles'
      ? path === '/articles/new'
        ? 'مقاله جدید'
        : 'ویرایش مقاله'
      : deepLabels[path]

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[100] focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-1.5 focus:rounded-md"
      >
        پرش به محتوای اصلی
      </a>
      <div className="flex flex-1 min-h-0">
        {/* نوار کناری تیره — دسکتاپ */}
        <aside className="hidden lg:block w-64 shrink-0" aria-label="نوار کناری">
          <div className="sticky top-0 h-screen shadow-[-8px_0_32px_-16px_oklch(0.2_0.03_168/0.35)]">
            <SidebarContent
              path={path}
              navigate={navigate}
              taskBadge={taskBadge}
              onViewSite={() => setSitePreviewOpen(true)}
            />
          </div>
        </aside>

        {/* نوار کناری — موبایل */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="right" className="p-0 w-72 border-s-0 [&>button:last-of-type]:hidden" dir="rtl">
            <SheetTitle className="sr-only">منوی اصلی</SheetTitle>
            <SidebarContent
              path={path}
              navigate={navigate}
              onNavigate={() => setMobileOpen(false)}
              taskBadge={taskBadge}
              onViewSite={() => {
                setMobileOpen(false)
                setSitePreviewOpen(true)
              }}
            />
            <SheetClose asChild>
              <button
                type="button"
                className="absolute top-3.5 end-3 z-30 rounded-lg bg-sidebar-foreground/10 p-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-foreground/20 transition-colors"
                aria-label="بستن منو"
              >
                <X className="h-4 w-4" />
              </button>
            </SheetClose>
          </SheetContent>
        </Sheet>

        <div className="flex-1 flex flex-col min-w-0">
          {/* سربرگ شیشه‌ای */}
          <header className="sticky top-0 z-40 glass border-b">
            <div className="flex items-center gap-2 px-4 h-16">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden rounded-xl"
                aria-label="بازکردن منو"
                onClick={() => setMobileOpen(true)}
              >
                <MenuIcon className="h-5 w-5" />
              </Button>

              {/* مسیر راهنما درون هدر */}
              <nav
                aria-label="مسیر راهنما"
                className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground min-w-0"
              >
                <span className="rounded-lg bg-muted/70 p-1.5 text-primary shrink-0" aria-hidden>
                  <Home className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{crumb}</span>
                {subCrumb ? (
                  <>
                    <ChevronLeft className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
                    <span className="text-foreground font-semibold truncate">{subCrumb}</span>
                  </>
                ) : null}
              </nav>

              <div className="flex-1" />
              <CommandTrigger onOpen={() => setPaletteOpen(true)} />
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden rounded-xl"
                aria-label="جست‌وجوی فرمان"
                onClick={() => setPaletteOpen(true)}
              >
                <Search className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl hover:bg-muted"
                aria-label="نمایش سایت"
                title="نمایش سایت"
                onClick={() => setSitePreviewOpen(true)}
              >
                <Globe className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl hover:bg-muted"
                aria-label="گزارش مشکل"
                title="گزارش مشکل"
                onClick={() => setSupportOpen(true)}
              >
                <LifeBuoy className="h-5 w-5" />
              </Button>
              <div className="h-6 w-px bg-border mx-1 hidden md:block" aria-hidden />
              <NotificationsBell />
              <ThemeToggle />
              <UserMenu onReport={() => setSupportOpen(true)} />
            </div>
          </header>

          {/* محتوای اصلی روی پس‌زمینه ملایم */}
          <main
            id="main-content"
            className="relative flex-1 px-4 lg:px-8 py-6 pb-10 w-full max-w-7xl mx-auto"
          >
            <div
              className="pointer-events-none absolute top-0 inset-x-0 h-48 bg-gradient-to-b from-primary/5 to-transparent"
              aria-hidden
            />
            <div className="relative">{children}</div>
          </main>

          {/* فوتر چسبان */}
          <footer className="mt-auto border-t bg-card/60">
            <div className="px-4 lg:px-8 h-12 flex items-center justify-between gap-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <span
                  className="h-4.5 w-4.5 rounded-md bg-gradient-to-br from-primary to-chart-3 flex items-center justify-center text-primary-foreground text-[9px] font-bold"
                  aria-hidden
                >
                  پ
                </span>
                پنل مدیریت محتوا — سامانه عملیاتی تولید و انتشار
              </p>
              <p className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                سرویس فعال
              </p>
            </div>
          </footer>
        </div>
      </div>

      {/* پالت فرمان سراسری (Ctrl+K) */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onAction={(id) => {
          if (id === 'view-site') setSitePreviewOpen(true)
        }}
      />

      {/* گزارش مشکل (پشتیبانی تشخیصی) */}
      <SupportReportDialog open={supportOpen} onOpenChange={setSupportOpen} />

      {/* نمایش سایت (پیش‌نمایش سایت عمومی) */}
      <SitePreviewDialog open={sitePreviewOpen} onOpenChange={setSitePreviewOpen} />
    </div>
  )
}
