'use client'

/**
 * گفتگوهای درون‌محتوایی — کامنت در سطح رکورد با منشن @، تعیین مسئول،
 * حل‌کردن گفتگو و تبدیل نظر به درخواست اصلاح.
 */

import * as React from 'react'
import {
  BadgeCheck,
  CheckCheck,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  ClipboardCheck,
  Trash2,
  UserRoundCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState, LoadingSpinner } from '@/components/shared/ui-bits'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/client/api'
import { timeAgo } from '@/lib/client/format'
import { useAppStore, useCan } from '@/store/app-store'
import { cn } from '@/lib/utils'

type CommentRow = {
  id: string
  entityType: string
  entityId: string
  body: string
  authorId: string
  authorName: string
  mentions: string[]
  status: 'OPEN' | 'RESOLVED'
  assigneeId: string | null
  assigneeName: string | null
  createdAt: string
  resolvedAt: string | null
  resolvedByName: string | null
}

type AssignableUser = { id: string; name: string; roleLabel: string }

async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(b.error || 'خطا در انجام عملیات')
  }
  return res.json() as Promise<T>
}

export function ContentComments({ entityType, entityId }: { entityType: 'ARTICLE' | 'PAGE'; entityId: string }) {
  const user = useAppStore((s) => s.user)
  const can = useCan()

  const [items, setItems] = React.useState<CommentRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [showResolved, setShowResolved] = React.useState(false)

  // فرم ثبت نظر
  const [draft, setDraft] = React.useState('')
  const [mentionIds, setMentionIds] = React.useState<string[]>([])
  const [assigneeId, setAssigneeId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const [users, setUsers] = React.useState<AssignableUser[]>([])
  const mentionInputRef = React.useRef<HTMLButtonElement>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ items: CommentRow[]; openCount: number }>(
        `/api/comments-panel?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`
      )
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت گفتگوها')
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    apiGet<{ items: AssignableUser[] }>('/api/users/assignable')
      .then((res) => setUsers(res.items))
      .catch(() => undefined)
  }, [])

  const toggleMention = (id: string) => {
    setMentionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const submit = async () => {
    if (draft.trim().length < 2) {
      toast.error('متن نظر باید حداقل ۲ نویسه باشد.')
      return
    }
    setSubmitting(true)
    try {
      await apiPost('/api/comments-panel', {
        entityType,
        entityId,
        body: draft.trim(),
        mentions: mentionIds,
        assigneeId: assigneeId || undefined,
      })
      setDraft('')
      setMentionIds([])
      setAssigneeId('')
      toast.success('نظر ثبت شد.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت نظر ناموفق بود.')
    } finally {
      setSubmitting(false)
    }
  }

  const setStatus = async (row: CommentRow, action: 'RESOLVE' | 'REOPEN') => {
    setBusyId(row.id)
    try {
      await apiPatch(`/api/comments-panel/${row.id}`, { action })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تغییر وضعیت ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  const convertToTask = async (row: CommentRow) => {
    setBusyId(row.id)
    try {
      await apiPost(`/api/comments-panel/${row.id}`)
      toast.success('درخواست اصلاح ایجاد شد و در کارهای مسئول قرار گرفت.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تبدیل به درخواست اصلاح ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  const removeComment = async (row: CommentRow) => {
    setBusyId(row.id)
    try {
      await apiDelete(`/api/comments-panel/${row.id}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف نظر ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  const visible = (items ?? []).filter((c) => (showResolved ? true : c.status === 'OPEN'))
  const openCount = (items ?? []).filter((c) => c.status === 'OPEN').length

  const mentionName = (id: string) => users.find((u) => u.id === id)?.name ?? null

  return (
    <div className="space-y-4">
      {/* فرم ثبت نظر */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <p className="text-sm font-semibold flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-teal-600" aria-hidden />
          گفتگو در مورد این محتوا
        </p>
        <Textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="نظر خود را بنویسید… تصمیم‌ها و دلایل تغییر اینجا ثبت می‌شوند."
          aria-label="متن نظر"
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* منشن همکاران */}
          <div className="relative">
            <Button
              ref={mentionInputRef}
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => mentionInputRef.current?.nextElementSibling?.classList.toggle('hidden')}
              aria-label="منشن همکاران"
            >
              <UserRoundCheck className="h-3.5 w-3.5" />
              منشن همکاران
              {mentionIds.length > 0 ? (
                <span className="rounded-full bg-primary/10 text-primary px-1.5 text-[10px] font-semibold">
                  {mentionIds.length > 9 ? '۹+' : mentionIds.length}
                </span>
              ) : null}
            </Button>
            <div className="hidden absolute top-full mt-1 z-20 w-64 rounded-xl border bg-popover shadow-lg p-1 max-h-56 overflow-y-auto">
              {users.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">کاربری یافت نشد.</p>
              ) : (
                users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={cn(
                      'w-full text-start rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted transition flex items-center justify-between gap-2',
                      mentionIds.includes(u.id) && 'bg-primary/5'
                    )}
                    onClick={() => toggleMention(u.id)}
                  >
                    <span>
                      {u.name} <span className="text-xs text-muted-foreground">({u.roleLabel})</span>
                    </span>
                    {mentionIds.includes(u.id) ? <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden /> : null}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* تعیین مسئول */}
          <Select value={assigneeId || 'none'} onValueChange={(v) => setAssigneeId(v === 'none' ? '' : v)}>
            <SelectTrigger className="w-48 h-8 text-xs" aria-label="تعیین مسئول نظر">
              <SelectValue placeholder="تعیین مسئول (اختیاری)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون مسئول</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />
          <Button size="sm" onClick={submit} disabled={submitting || draft.trim().length < 2} className="gap-1.5">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            ثبت نظر
          </Button>
        </div>
        {mentionIds.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            منشن‌شده‌ها: {mentionIds.map((id) => mentionName(id) ?? '—').join('، ')}
          </p>
        ) : null}
      </div>

      {/* فیلتر حل‌شده‌ها */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {openCount > 0 ? (
            <>
              <span className="font-semibold text-foreground tabular-nums">{openCount > 9 ? '۹+' : openCount}</span> گفتگوی باز
            </>
          ) : (
            'همه گفتگوها حل شده‌اند'
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setShowResolved((v) => !v)} className="text-xs gap-1.5">
          {showResolved ? 'پنهان‌کردن حل‌شده‌ها' : 'نمایش حل‌شده‌ها'}
        </Button>
      </div>

      {/* فهرست نظرها */}
      {loading && !items ? (
        <LoadingSpinner label="در حال دریافت گفتگوها…" />
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive flex items-center justify-between gap-3">
          {error}
          <Button variant="outline" size="sm" onClick={load}>
            تلاش مجدد
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          title="گفتگویی وجود ندارد"
          description="بحث‌ها را کنار همین محتوا ثبت کنید تا دلایل تصمیم‌ها گم نشوند."
          icon={<MessageSquarePlus className="h-6 w-6" />}
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((c) => {
            const mine = user?.id === c.authorId
            const moderatable = mine || can('articles.review')
            const busy = busyId === c.id
            return (
              <li
                key={c.id}
                className={cn(
                  'rounded-2xl border p-4 space-y-2',
                  c.status === 'RESOLVED' && 'opacity-70 bg-muted/30'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{c.authorName}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</span>
                  {c.status === 'RESOLVED' ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 gap-1 border-0">
                      <CheckCheck className="h-3 w-3" aria-hidden />
                      حل‌شده
                      {c.resolvedByName ? ` توسط ${c.resolvedByName}` : ''}
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">باز</Badge>
                  )}
                  {c.assigneeName ? (
                    <Badge variant="secondary" className="gap-1">
                      <UserRoundCheck className="h-3 w-3" aria-hidden />
                      مسئول: {c.assigneeName}
                    </Badge>
                  ) : null}
                  <div className="flex-1" />
                  {moderatable ? (
                    <div className="flex items-center gap-1">
                      {c.status === 'OPEN' ? (
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={busy} onClick={() => setStatus(c, 'RESOLVE')}>
                          <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                          حل شد
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={busy} onClick={() => setStatus(c, 'REOPEN')}>
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          بازگشایی
                        </Button>
                      )}
                      {c.entityType === 'ARTICLE' && c.status === 'OPEN' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1 text-teal-700 dark:text-teal-300"
                          disabled={busy}
                          onClick={() => convertToTask(c)}
                          aria-label="تبدیل نظر به درخواست اصلاح"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
                          تبدیل به درخواست اصلاح
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                        disabled={busy}
                        onClick={() => removeComment(c)}
                        aria-label={`حذف نظر ${c.authorName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <p className="text-sm leading-6 whitespace-pre-wrap">{c.body}</p>
                {c.mentions.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    منشن: {c.mentions.map((id) => mentionName(id) ?? '—').join('، ')}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
