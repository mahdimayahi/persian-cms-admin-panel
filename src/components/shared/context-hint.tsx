'use client'

/**
 * راهنمای درون‌خطی جمع‌شونده (ContextHint)
 * کارت کوچکی که هنگام بسته بودن تقریباً فضایی اشغال نمی‌کند و با یک کلیک باز می‌شود.
 * جایگزین tooltip نیست: اطلاعات ضروری بدون پوشش ماوس و با صفحه‌کلید در دسترس است.
 */
import * as React from 'react'
import { AlertTriangle, ChevronDown, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ContextHint({
  title,
  children,
  defaultOpen = false,
  tone = 'default',
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  tone?: 'default' | 'warning'
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const regionId = React.useId()

  return (
    <div className="rounded-lg border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={regionId}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
        {tone === 'warning' ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        ) : (
          <HelpCircle className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
        )}
        <span className="text-sm font-medium">{title}</span>
      </button>
      {open ? (
        <div id={regionId} role="region" aria-label={title} className="p-3 pt-0 text-sm leading-6 text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  )
}
