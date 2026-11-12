'use client'

/**
 * گفتگوهای درون‌محتوایی — رشته‌ای: هر نظر اصلی (بدون parentId) یک گفتگو است و
 * پاسخ‌های آن (parentId = شناسهٔ گفتگو) به‌صورت تو در تو زیر همان کارت نمایش
 * داده می‌شوند. امکان منشن @، تعیین مسئول، حل‌کردن/بازگشایی، تبدیل نظر به
 * درخواست اصلاح، پاسخ‌دادن و حذف.
 */

import * as React from 'react'
import {
  BadgeCheck,
  CheckCheck,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Reply,
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
import { apiDelete, apiGet, apiPost } from '@/lib/client/api'
import { timeAgo, toFa } from '@/lib/client/format'
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
  parentId: string | null
  versionRef: string | null
  createdAt: string
  resolvedAt: string | null
  resolvedByName: string | null
}

/** یک گفتگوی کامل: نظر اصلی + پاسخ‌های مرتب (قدیمی به جدید) */
type ThreadView = { thread: CommentRow; replies: CommentRow[] }

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

export function ContentComments({
  entityType,
  entityId,
  versionRef,
}: {
  entityType: 'ARTICLE' | 'PAGE'
  entityId: string
  /** اتصال اختیاری گفتگو به نسخهٔ محتوا — در صورت ارسال به‌همراه گفتگوی جدید ثبت می‌شود */
  versionRef?: string | null
}) {
  const user = useAppStore((s) => s.user)
  const can = useCan()

  const [items, setItems] = React.useState<CommentRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [showResolved, setShowResolved] = React.useState(false)

  // فرم ثبت گفتگوی جدید
  const [draft, setDraft] = React.useState('')
  const [mentionIds, setMentionIds] = React.useState<string[]>([])
  const [assigneeId, setAssigneeId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // پاسخ‌دادن به هر گفتگو
  const [replyOpen, setReplyOpen] = React.useState<Record<string, boolean>>({})
  const [replyDrafts, setReplyDrafts] = React.useState<Record<string, string>>({})
  const [replyBusyId, setReplyBusyId] = React.useState<string | null>(null)

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

  /** رشته‌سازی ردیف‌های مسطح: نظرهای اصلی + پاسخ‌های مرتب هر کدام */
  const threads = React.useMemo<ThreadView[]>(() => {
    const all = items ?? []
    const byId = new Map(all.map((r) => [r.id, r]))
    const repliesByParent = new Map<string, CommentRow[]>()
    for (const r of all) {
      if (r.parentId && byId.has(r.parentId)) {
        const arr = repliesByParent.get(r.parentId) ?? []
        arr.push(r)
        repliesByParent.set(r.parentId, arr)
      }
    }
    return all
      .filter((r) => r.parentId === null)
      .map((thread) => ({
        thread,
        replies: (repliesByParent.get(thread.id) ?? []).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ),
      }))
  }, [items])

  const visible = threads.filter((t) => (showResolved ? true : t.thread.status === 'OPEN'))
  const openCount = threads.filter((t) => t.thread.status === 'OPEN').length

  const mentionName = (id: string) => users.find((u) => u.id === id)?.name ?? null

  /** قاعدهٔ مدیریت گفتگو (هم‌راستا با سرور): نویسندهٔ ردیف یا بازبین مقاله / مدیر صفحه */
  const canManageRow = (row: CommentRow) =>
    user?.id === row.authorId || can(row.entityType === 'PAGE' ? 'pages.manage' : 'articles.review')

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
        ...(versionRef ? { versionRef } : {}),
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

  const submitReply = async (thread: CommentRow) => {
    const text = (replyDrafts[thread.id] ?? '').trim()
    if (text.length < 2) {
      toast.error('متن پاسخ باید حداقل ۲ نویسه باشد.')
      return
    }
    setReplyBusyId(thread.id)
    try {
      await apiPost('/api/comments-panel', {
        entityType,
        entityId,
        body: text,
        parentId: thread.id,
      })
      setReplyDrafts((prev) => ({ ...prev, [thread.id]: '' }))
      setReplyOpen((prev) => ({ ...prev, [thread.id]: false }))
      toast.success('پاسخ ثبت شد.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت پاسخ ناموفق بود.')
    } finally {
      setReplyBusyId(null)
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

  /** تغییر مسئول گفتگوی اصلی — فقط وقتی گفتگو باز است */
  const assign = async (row: CommentRow, newAssigneeId: string) => {
    setBusyId(row.id)
    try {
      await apiPatch(`/api/comments-panel/${row.id}`, { action: 'ASSIGN', assigneeId: newAssigneeId })
      toast.success('مسئول گفتگو به‌روزرسانی شد.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تغییر مسئول ناموفق بود.')
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

  return (
    <div className="space-y-4">
      {/* فرم ثبت گفتگوی جدید */}
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
                  {toFa(mentionIds.length)}
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
              <span className="font-semibold text-foreground tabular-nums">{toFa(openCount)}</span> گفتگوی باز
            </>
          ) : (
            'همه گفتگوها حل شده‌اند'
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setShowResolved((v) => !v)} className="text-xs gap-1.5">
          {showResolved ? 'پنهان‌کردن حل‌شده‌ها' : 'نمایش حل‌شده‌ها'}
        </Button>
      </div>

      {/* فهرست گفتگوها */}
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
        <ul className="space-y-4">
          {visible.map(({ thread, replies }) => {
            const manageable = canManageRow(thread)
            const busy = busyId === thread.id
            const replyBusy = replyBusyId === thread.id
            const replyText = replyDrafts[thread.id] ?? ''
            const isReplyOpen = !!replyOpen[thread.id]
            return (
              <li
                key={thread.id}
                className={cn(
                  'rounded-2xl border p-4 space-y-3',
                  thread.status === 'RESOLVED' && 'opacity-70 bg-muted/30'
                )}
              >
                {/* سربرگ گفتگو: نویسنده، زمان، وضعیت، مسئول، تعداد پاسخ و اقدام‌ها */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{thread.authorName}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(thread.createdAt)}</span>
                  {thread.status === 'RESOLVED' ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 gap-1 border-0">
                      <CheckCheck className="h-3 w-3" aria-hidden />
                      حل‌شده
                      {thread.resolvedByName ? ` توسط ${thread.resolvedByName}` : ''}
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">باز</Badge>
                  )}
                  {replies.length > 0 ? (
                    <Badge variant="secondary" className="gap-1 text-[11px]">
                      <MessageSquare className="h-3 w-3" aria-hidden />
                      {toFa(replies.length)} پاسخ
                    </Badge>
                  ) : null}
                  {/* مسئول: در گفتگوی بازِ قابل‌مدیریت با انتخابگر، در غیر این صورت با نشان */}
                  {manageable && thread.status === 'OPEN' ? (
                    <Select
                      value={thread.assigneeId ?? 'none'}
                      onValueChange={(v) => {
                        if (v !== 'none') void assign(thread, v)
                      }}
                    >
                      <SelectTrigger className="w-44 h-7 text-xs" aria-label="تغییر مسئول گفتگو">
                        <SelectValue placeholder="مسئول گفتگو" />
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
                  ) : thread.assigneeName ? (
                    <Badge variant="secondary" className="gap-1">
                      <UserRoundCheck className="h-3 w-3" aria-hidden />
                      مسئول: {thread.assigneeName}
                    </Badge>
                  ) : null}
                  <div className="flex-1" />
                  {manageable ? (
                    <div className="flex items-center gap-1">
                      {thread.status === 'OPEN' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={busy}
                          onClick={() => setStatus(thread, 'RESOLVE')}
                        >
                          <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                          حل شد
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={busy}
                          onClick={() => setStatus(thread, 'REOPEN')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          بازگشایی
                        </Button>
                      )}
                      {thread.entityType === 'ARTICLE' && thread.status === 'OPEN' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1 text-teal-700 dark:text-teal-300"
                          disabled={busy}
                          onClick={() => convertToTask(thread)}
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
                        onClick={() => removeComment(thread)}
                        aria-label={`حذف گفتگوی ${thread.authorName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>

                <p className="text-sm leading-6 whitespace-pre-wrap">{thread.body}</p>
                {thread.mentions.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    منشن: {thread.mentions.map((id) => mentionName(id) ?? '—').join('، ')}
                  </p>
                ) : null}

                {/* پاسخ‌های گفتگو — تو در تو، قدیمی به جدید */}
                {replies.length > 0 ? (
                  <ul className="ms-3 border-s-2 border-muted ps-4 space-y-2">
                    {replies.map((r) => (
                      <li key={r.id} className="rounded-xl border bg-muted/30 p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                            پاسخ
                          </Badge>
                          <span className="text-xs font-semibold">{r.authorName}</span>
                          <span className="text-[11px] text-muted-foreground">{timeAgo(r.createdAt)}</span>
                        </div>
                        <p className="text-sm leading-6 whitespace-pre-wrap">{r.body}</p>
                        {r.mentions.length > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            منشن: {r.mentions.map((id) => mentionName(id) ?? '—').join('، ')}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* پاسخ‌دادن به این گفتگو */}
                <div>
                  {isReplyOpen ? (
                    <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                      <Textarea
                        rows={2}
                        value={replyText}
                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [thread.id]: e.target.value }))}
                        placeholder="پاسخ خود را بنویسید…"
                        aria-label="متن پاسخ"
                        className="text-sm"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={replyBusy}
                          onClick={() => setReplyOpen((prev) => ({ ...prev, [thread.id]: false }))}
                        >
                          انصراف
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          disabled={replyBusy || replyText.trim().length < 2}
                          onClick={() => submitReply(thread)}
                        >
                          {replyBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Send className="h-3.5 w-3.5" aria-hidden />
                          )}
                          ارسال پاسخ
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setReplyOpen((prev) => ({ ...prev, [thread.id]: true }))}
                      aria-label={`پاسخ به گفتگوی ${thread.authorName}`}
                    >
                      <Reply className="h-3.5 w-3.5" aria-hidden />
                      پاسخ
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
