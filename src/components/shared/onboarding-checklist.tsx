'use client'

/**
 * راهنمای شروع کار — چک‌لیست گام‌های اولیه متناسب با نقش کاربر.
 * پیشرفت و وضعیت رد کردن در localStorage نگهداری می‌شود (بدون فراخوانی API).
 */

import * as React from 'react'
import { CheckCircle2, ChevronLeft, Circle, Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { navigate } from '@/hooks/use-hash-route'
import { useAppStore } from '@/store/app-store'
import type { Role } from '@/lib/permissions'
import { toFa } from '@/lib/client/format'
import { cn } from '@/lib/utils'

type ChecklistItem = { id: string; label: string; href: string; perm?: string }

const CHECKLISTS: Record<Role, ChecklistItem[]> = {
  ADMIN: [
    { id: 'security', label: 'تغییر رمز پیش‌فرض حساب', href: '/account' },
    { id: 'category', label: 'ایجاد اولین دسته‌بندی', href: '/categories', perm: 'categories.manage' },
    { id: 'article', label: 'انتشار اولین مقاله', href: '/articles', perm: 'articles.create' },
    { id: 'users', label: 'دعوت همکاران و تعیین نقش', href: '/users', perm: 'users.manage' },
    { id: 'health', label: 'مرور سلامت محتوا', href: '/health', perm: 'articles.view' },
  ],
  EDITOR: [
    { id: 'review', label: 'بررسی صف بازبینی', href: '/tasks' },
    { id: 'article', label: 'انتشار اولین مقاله', href: '/articles', perm: 'articles.create' },
    { id: 'health', label: 'مرور سلامت محتوا', href: '/health', perm: 'articles.view' },
    { id: 'settings', label: 'آشنایی با تنظیمات سایت', href: '/settings', perm: 'settings.view' },
  ],
  AUTHOR: [
    { id: 'article', label: 'نوشتن اولین مقاله', href: '/articles/new', perm: 'articles.create' },
    { id: 'seo', label: 'تکمیل تصویر شاخص و دسته‌بندی مقاله', href: '/articles' },
    { id: 'tasks', label: 'پیگیری کارهای واگذارشده', href: '/tasks' },
  ],
  VIEWER: [
    { id: 'dash', label: 'مرور داشبورد و گزارش‌ها', href: '/reports', perm: 'reports.view' },
    { id: 'articles', label: 'مشاهده فهرست مقالات', href: '/articles', perm: 'articles.view' },
  ],
}

export function OnboardingChecklist() {
  const user = useAppStore((s) => s.user)
  const permissions = useAppStore((s) => s.permissions)

  const [ready, setReady] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)
  const [done, setDone] = React.useState<Record<string, boolean>>({})

  const items = user ? (CHECKLISTS[user.role as Role] ?? []) : []
  const visibleItems = items.filter((it) => !it.perm || permissions.includes(it.perm))
  const doneCount = visibleItems.filter((it) => done[it.id] === true).length
  const total = visibleItems.length
  const allDone = total > 0 && doneCount === total
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0

  /* خواندن پیشرفت و وضعیت رد کردن از localStorage (با محافظت در برابر خطا) */
  React.useEffect(() => {
    if (!user) return
    try {
      const raw = window.localStorage.getItem(`onboarding-progress-${user.id}`)
      setDone(raw ? (JSON.parse(raw) as Record<string, boolean>) : {})
      setDismissed(window.localStorage.getItem(`onboarding-dismissed-${user.id}`) === '1')
    } catch {
      setDone({})
      setDismissed(false)
    }
    setReady(true)
  }, [user])

  const toggle = (item: ChecklistItem) => {
    const next = !done[item.id]
    setDone((prev) => ({ ...prev, [item.id]: next }))
    try {
      if (user) {
        window.localStorage.setItem(
          `onboarding-progress-${user.id}`,
          JSON.stringify({ ...done, [item.id]: next })
        )
      }
    } catch {
      // نگهداری پیشرفت در دسترس نیست — نادیده گرفته می‌شود
    }
    navigate(item.href)
  }

  const dismiss = () => {
    setDismissed(true)
    try {
      if (user) window.localStorage.setItem(`onboarding-dismissed-${user.id}`, '1')
    } catch {
      // نگهداری وضعیت رد کردن در دسترس نیست — نادیده گرفته می‌شود
    }
  }

  if (!user || !ready || dismissed || allDone || total === 0) return null

  return (
    <Card className="gap-4 rounded-2xl py-5">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"
            aria-hidden
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <CardTitle>شروع کار</CardTitle>
            <CardDescription className="mt-1">چند قدم کوتاه تا تسلط کامل — متناسب با نقش شما</CardDescription>
          </div>
        </div>
        <CardAction className="flex items-center gap-2">
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {toFa(doneCount)} از {toFa(total)}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={dismiss}
            aria-label="بستن راهنمای شروع کار"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="pt-0">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="پیشرفت راهنمای شروع کار"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-chart-3 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        <ul className="mt-2 divide-y">
          {visibleItems.map((item) => {
            const isDone = done[item.id] === true
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  aria-pressed={isDone}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-start text-sm transition-colors hover:bg-muted/50"
                >
                  {isDone ? (
                    <CheckCircle2
                      className="h-5 w-5 shrink-0 fill-emerald-500 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" aria-hidden />
                  )}
                  <span className={cn('flex-1', isDone && 'text-muted-foreground line-through decoration-muted-foreground/40')}>
                    {item.label}
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
