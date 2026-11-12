'use client'

/**
 * بررسی اثر حذف — پیش از حذف قطعی، گزارش وابستگی‌ها از GET /api/impact دریافت
 * و نمایش داده می‌شود. عملیات حذف خود را والد از طریق onDelete انجام می‌دهد.
 */

import * as React from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/client/api'
import { toFa } from '@/lib/client/format'
import { navigate } from '@/hooks/use-hash-route'

export type ImpactType = 'category' | 'tag' | 'media' | 'user'

type ImpactGroup = { label: string; detail: string; count: number; items: { id: string; title: string }[] }

type ImpactReport = { type: string; name: string; impacts: ImpactGroup[]; total: number }

/** تبدیل ارقام لاتین داخل متن سرور به ارقام فارسی */
function faDigits(value: string): string {
  return value.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

export function ImpactDialog({
  target,
  onClose,
  onDelete,
  onDeleted,
}: {
  target: { type: ImpactType; id: string; name: string } | null
  onClose: () => void
  onDelete: () => Promise<void> | void
  onDeleted: () => void
}) {
  const [report, setReport] = React.useState<ImpactReport | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)

  const type = target?.type
  const id = target?.id

  /* دریافت گزارش اثر هنگام باز شدن گفت‌وگو */
  React.useEffect(() => {
    if (!type || !id) {
      setReport(null)
      setError(null)
      setDeleting(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setReport(null)
    apiGet<ImpactReport>(`/api/impact?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`)
      .then((res) => {
        if (!cancelled) setReport(res)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'خطای غیرمنتظره در دریافت گزارش اثر.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type, id, reloadKey])

  const handleConfirm = async () => {
    setDeleting(true)
    try {
      await onDelete()
      onDeleted()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حذف انجام نشد. لطفاً دوباره تلاش کنید.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o && !deleting) onClose()
      }}
    >
      <AlertDialogContent dir="rtl" className="max-w-lg rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{type === 'user' ? 'حذف کاربر' : `حذف «${target?.name ?? ''}»`}</AlertDialogTitle>
          <AlertDialogDescription>قبل از حذف، بخش‌هایی که تحت تأثیر قرار می‌گیرند را بررسی کنید.</AlertDialogDescription>
        </AlertDialogHeader>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-xl border p-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
              تلاش مجدد
            </Button>
          </div>
        ) : null}

        {!loading && !error && report ? (
          report.impacts.length === 0 ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>هیچ وابستگی‌ای پیدا نشد — حذف ایمن است.</span>
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto pe-1">
              <p className="text-xs text-muted-foreground">در مجموع {toFa(report.total)} مورد تحت تأثیر قرار می‌گیرد:</p>
              {report.impacts.map((g) => (
                <div key={g.label} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{g.label}</p>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {toFa(g.count)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{faDigits(g.detail)}</p>
                  {g.items.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {g.items.slice(0, 5).map((it) => (
                        <li key={it.id} className="line-clamp-1 text-xs">
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1 max-w-full"
                            onClick={() => {
                              onClose()
                              navigate(`#/articles/${it.id}/edit`)
                            }}
                            aria-label={`رفتن به «${it.title}»`}
                          >
                            <span className="truncate">• {it.title}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                          </button>
                        </li>
                      ))}
                      {g.count > g.items.slice(0, 5).length ? (
                        <li className="text-[11px] text-muted-foreground pt-0.5">
                          و {toFa(g.count - g.items.slice(0, 5).length)} مورد دیگر…
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>انصراف</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={deleting || loading || !!error}
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
          >
            {deleting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {deleting ? 'در حال حذف…' : 'حذف قطعی'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
