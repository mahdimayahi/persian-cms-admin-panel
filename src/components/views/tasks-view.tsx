'use client'

import * as React from 'react'
import {
  AlarmClock,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  FileWarning,
  Flame,
  History,
  ListChecks,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingSpinner,
  Field,
} from '@/components/shared/ui-bits'
import { apiGet, apiPost } from '@/lib/client/api'
import { faDate, timeAgo, toFa } from '@/lib/client/format'
import { navigate } from '@/hooks/use-hash-route'
import { cn } from '@/lib/utils'

/**
 * کمک‌تابع محلی برای endpointهایی که فقط PATCH را می‌پذیرند
 * (کتابخانه api کلاینت متد PATCH ندارد) — با همان قرارداد خطای apiGet
 */
async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(b.error || 'خطا')
  }
  return res.json() as Promise<T>
}

type TaskType = 'GENERAL' | 'REVIEW' | 'REVISION' | 'HEALTH'
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH'

type MyTask = {
  id: string
  title: string
  description: string | null
  type: TaskType
  priority: TaskPriority
  status: string
  dueDate: string | null
  link: string | null
  relatedType: string | null
  relatedId: string | null
  assignedToId: string
  assignedByName: string | null
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

type TaskCenterData = {
  counts: {
    awaitingReview: number
    overdueReviews: number
    openTasks: number
    overdueTasks: number
    needsRevision: number
  }
  canReview: boolean
  awaitingReview: { id: string; title: string; updatedAt: string; author: { id: string; name: string } }[]
  overdueReviews: { id: string; title: string; reviewAt: string; lastReviewedAt: string | null; status: string }[]
  myTasks: MyTask[]
  needsRevision: { id: string; title: string; reviewNote: string | null; updatedAt: string }[]
  lastWork: { id: string; title: string; status: string; updatedAt: string } | null
  generatedAt: string
}

type AssignableUser = { id: string; name: string; role: string; roleLabel: string }

type TaskForm = {
  title: string
  description: string
  assignedToId: string
  type: TaskType
  priority: TaskPriority
  dueDate: string
}

const emptyTaskForm = (): TaskForm => ({
  title: '',
  description: '',
  assignedToId: '',
  type: 'GENERAL',
  priority: 'MEDIUM',
  dueDate: '',
})

const TYPE_LABELS: Record<TaskType, string> = {
  GENERAL: 'عمومی',
  REVIEW: 'بازبینی محتوا',
  REVISION: 'اصلاح محتوا',
  HEALTH: 'سلامت محتوا',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  HIGH: 'فوری',
  MEDIUM: 'متوسط',
  LOW: 'کم‌اهمیت',
}

const PRIORITY_DOT: Record<TaskPriority, string> = {
  HIGH: 'bg-rose-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-slate-400',
}

/** آیتم‌های ادغام‌شده بخش «اولویت‌های امروز» */
type PriorityItem = {
  key: string
  title: string
  link: string | null
  taskId: string | null
  badge: { label: string; colorClass: string; bgClass: string }
}

const editorLink = (articleId: string) => `#/articles/${articleId}/edit`

const stripHash = (link: string) => link.replace(/^#/, '')

export function TasksView() {
  const [data, setData] = React.useState<TaskCenterData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // گفت‌وگوی واگذاری کار
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [form, setForm] = React.useState<TaskForm>(emptyTaskForm)
  const [assignables, setAssignables] = React.useState<AssignableUser[]>([])
  const [assignablesLoading, setAssignablesLoading] = React.useState(false)
  const [titleError, setTitleError] = React.useState<string | null>(null)
  const [assigneeError, setAssigneeError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // ثبت انجام کار (PATCH) — برای غیرفعال‌کردن دکمه همان ردیف
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<TaskCenterData>('/api/tasks')
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت کارهای شما')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  /* ── نخستین‌های بخش «اولویت‌های امروز» ───────────────────── */
  const priorityItems = React.useMemo<PriorityItem[]>(() => {
    if (!data) return []
    const items: PriorityItem[] = []
    const now = Date.now()

    for (const t of data.myTasks) {
      if (t.dueDate && new Date(t.dueDate).getTime() < now) {
        items.push({
          key: `task-${t.id}`,
          title: t.title,
          link: t.link,
          taskId: t.id,
          badge: { label: 'از موعد گذشته', colorClass: 'text-rose-700 dark:text-rose-400', bgClass: 'bg-rose-100 dark:bg-rose-950/60' },
        })
      }
    }
    for (const a of data.overdueReviews) {
      items.push({
        key: `review-${a.id}`,
        title: a.title,
        link: editorLink(a.id),
        taskId: null,
        badge: { label: 'مالکیت محتوا', colorClass: 'text-amber-700 dark:text-amber-400', bgClass: 'bg-amber-100 dark:bg-amber-950/60' },
      })
    }
    if (data.canReview) {
      for (const a of data.awaitingReview) {
        items.push({
          key: `await-${a.id}`,
          title: a.title,
          link: editorLink(a.id),
          taskId: null,
          badge: { label: 'صف بازبینی', colorClass: 'text-teal-700 dark:text-teal-400', bgClass: 'bg-teal-100 dark:bg-teal-950/60' },
        })
      }
    }
    for (const a of data.needsRevision) {
      items.push({
        key: `rev-${a.id}`,
        title: a.title,
        link: editorLink(a.id),
        taskId: null,
        badge: { label: 'نیازمند اصلاح', colorClass: 'text-orange-700 dark:text-orange-400', bgClass: 'bg-orange-100 dark:bg-orange-950/60' },
      })
    }
    return items.slice(0, 8)
  }, [data])

  /* ── جمله بنر خلاصه ─────────────────────────────────────── */
  const summarySentence = React.useMemo(() => {
    if (!data) return ''
    const c = data.counts
    const parts: string[] = []
    if (c.awaitingReview > 0) parts.push(`${toFa(c.awaitingReview)} مقاله منتظر بررسی شما`)
    if (c.overdueReviews > 0) parts.push(`${toFa(c.overdueReviews)} بازبینی محتوا از موعد گذشته`)
    if (c.overdueTasks > 0) parts.push(`${toFa(c.overdueTasks)} کار از موعد گذشته`)
    else if (c.openTasks > 0) parts.push(`${toFa(c.openTasks)} کار واگذارشده باز`)
    if (c.needsRevision > 0) parts.push(`${toFa(c.needsRevision)} مقاله نیازمند اصلاح`)
    return parts.length === 0 ? '' : `${parts.join('، ')} دارید.`
  }, [data])

  /* ── عملیات‌ها ──────────────────────────────────────────── */
  const completeTask = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      await apiPatch(`/api/tasks/${taskId}`, { status: 'DONE' })
      toast.success('کار انجام شد')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت انجام کار ناموفق بود.')
    } finally {
      setBusyTaskId(null)
    }
  }

  const openDialog = async () => {
    setForm(emptyTaskForm())
    setTitleError(null)
    setAssigneeError(null)
    setDialogOpen(true)
    setAssignablesLoading(true)
    try {
      const res = await apiGet<{ items: AssignableUser[] }>('/api/users/assignable')
      setAssignables(res.items)
    } catch (e) {
      setAssignables([])
      toast.error(e instanceof Error ? e.message : 'دریافت فهرست اعضا ناموفق بود.')
    } finally {
      setAssignablesLoading(false)
    }
  }

  const dueDateValid = form.dueDate !== '' && !Number.isNaN(new Date(form.dueDate).getTime())

  const submitTask = async () => {
    const title = form.title.trim()
    if (title.length < 3) {
      setTitleError('عنوان کار باید دست‌کم ۳ نویسه باشد.')
      return
    }
    if (!form.assignedToId) {
      setAssigneeError('انتخاب مسئول کار الزامی است.')
      return
    }
    setSaving(true)
    setTitleError(null)
    setAssigneeError(null)
    try {
      await apiPost('/api/tasks', {
        title,
        description: form.description.trim() || undefined,
        type: form.type,
        priority: form.priority,
        dueDate: dueDateValid ? new Date(`${form.dueDate}T23:59:59`).toISOString() : '',
        assignedToId: form.assignedToId,
      })
      toast.success('کار واگذار شد.')
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'واگذاری کار ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <LoadingSpinner label="در حال بارگذاری کارهای شما…" />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return null

  const calm = summarySentence === ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="مرکز کارهای من"
        description="همه چیزهایی که منتظر شماست، در یک نگاه"
        icon={<ListChecks className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading} className="gap-1.5">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              به‌روزرسانی
            </Button>
            <Button onClick={openDialog} className="gap-1.5">
              <Plus className="h-4 w-4" />
              واگذاری کار جدید
            </Button>
          </>
        }
      />

      {/* ── بنر خلاصه وضعیت ─────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground p-6 shadow-md">
        <div className="absolute inset-0 pattern-grid" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-bl from-primary/30 via-transparent to-chart-3/15" aria-hidden />
        <div className="relative z-10 flex items-center gap-3">
          {calm ? (
            <span className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-400 shrink-0" aria-hidden>
              <CheckCircle2 className="h-6 w-6" />
            </span>
          ) : null}
          <p className="text-xl font-bold leading-8">
            {calm ? 'هیچ اقدام فوری در انتظار شما نیست — همه‌چیز مرتب است.' : summarySentence}
          </p>
        </div>
      </div>

      {/* ── اولویت‌های امروز ────────────────────────────────── */}
      <Card className="rounded-2xl shadow-xs">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <span className="rounded-lg bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-500" aria-hidden>
              <Flame className="h-4 w-4" />
            </span>
            اولویت‌های امروز
          </CardTitle>
          <CardDescription>مهم‌ترین اقلام نیازمند اقدام شما، به ترتیب اهمیت</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {priorityItems.length === 0 ? (
            <EmptyState compact title="اولویت فوری ندارید" icon={<CheckCircle2 className="h-6 w-6" />} />
          ) : (
            priorityItems.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-2 rounded-xl border p-3 transition hover:border-primary/50 hover:bg-primary/5 group"
              >
                {item.link ? (
                  <button
                    type="button"
                    onClick={() => navigate(stripHash(item.link as string))}
                    className="min-w-0 flex-1 text-start rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`رفتن به «${item.title}»`}
                  >
                    <p className="text-sm font-medium line-clamp-1">{item.title}</p>
                    <div className="mt-1.5">
                      <StatusBadge label={item.badge.label} colorClass={item.badge.colorClass} bgClass={item.badge.bgClass} />
                    </div>
                  </button>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium line-clamp-1">{item.title}</p>
                    <div className="mt-1.5">
                      <StatusBadge label={item.badge.label} colorClass={item.badge.colorClass} bgClass={item.badge.bgClass} />
                    </div>
                  </div>
                )}
                {item.taskId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                    disabled={busyTaskId === item.taskId}
                    onClick={() => completeTask(item.taskId as string)}
                    aria-label={`ثبت کار «${item.title}» به‌عنوان انجام‌شده`}
                  >
                    <Check className="h-4 w-4" />
                    انجام شد
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── کارت‌های تفصیلی ─────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* در انتظار تأیید شما */}
        {data.canReview ? (
          <Card className="rounded-2xl shadow-xs">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="rounded-lg bg-teal-500/10 p-1.5 text-teal-600 dark:text-teal-400" aria-hidden>
                  <Eye className="h-4 w-4" />
                </span>
                در انتظار تأیید شما
              </CardTitle>
              <CardDescription>مقالاتی که منتظر بازبینی و تأیید شما هستند</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-96 overflow-y-auto">
              {data.awaitingReview.length === 0 ? (
                <EmptyState compact title="صف بازبینی خالی است" icon={<CheckCircle2 className="h-6 w-6" />} />
              ) : (
                data.awaitingReview.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => navigate(`/articles/${a.id}/edit`)}
                    className="w-full text-start rounded-xl border p-3 transition hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring group"
                  >
                    <p className="text-sm font-medium line-clamp-1">{a.title}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-muted-foreground">
                        {a.author.name} · {timeAgo(a.updatedAt)}
                      </span>
                      <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:-translate-x-0.5 transition" aria-hidden />
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* بازبینی از موعد گذشته */}
        <Card className="rounded-2xl shadow-xs">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400" aria-hidden>
                <AlarmClock className="h-4 w-4" />
              </span>
              بازبینی از موعد گذشته
            </CardTitle>
            <CardDescription>بازبینی دوره‌ای محتوا که موعد آن سپری شده است</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {data.overdueReviews.length === 0 ? (
              <EmptyState compact title="بازبینی معوقه‌ای ندارید" icon={<CheckCircle2 className="h-6 w-6" />} />
            ) : (
              data.overdueReviews.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(`/articles/${a.id}/edit`)}
                  className="w-full text-start rounded-xl border p-3 transition hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring group"
                >
                  <p className="text-sm font-medium line-clamp-1">{a.title}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                      موعد: {faDate(a.reviewAt)}
                    </span>
                    <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:-translate-x-0.5 transition" aria-hidden />
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* کارهای واگذارشده به من */}
        <Card className="rounded-2xl shadow-xs">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="rounded-lg bg-violet-500/10 p-1.5 text-violet-600 dark:text-violet-400" aria-hidden>
                <ListTodo className="h-4 w-4" />
              </span>
              کارهای واگذارشده به من
            </CardTitle>
            <CardDescription>کارهایی که همکاران برای شما ثبت کرده‌اند</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {data.myTasks.length === 0 ? (
              <EmptyState
                compact
                title="کار واگذارشده‌ای ندارید"
                icon={<ListTodo className="h-6 w-6" />}
                action={
                  <Button variant="outline" size="sm" onClick={openDialog} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    واگذاری کار جدید
                  </Button>
                }
              />
            ) : (
              data.myTasks.map((t) => {
                const overdue = !!t.dueDate && new Date(t.dueDate).getTime() < Date.now()
                return (
                  <div key={t.id} className="rounded-xl border p-3 transition hover:border-primary/50 hover:bg-primary/5">
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', PRIORITY_DOT[t.priority])}
                        title={`اولویت ${PRIORITY_LABELS[t.priority]}`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        {t.link ? (
                          <button
                            type="button"
                            onClick={() => navigate(stripHash(t.link as string))}
                            className="text-start text-sm font-medium line-clamp-1 hover:text-primary underline-offset-4 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`رفتن به کار «${t.title}»`}
                          >
                            {t.title}
                          </button>
                        ) : (
                          <p className="text-sm font-medium line-clamp-1">{t.title}</p>
                        )}
                        {t.description ? (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{t.description}</p>
                        ) : null}
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                          {t.dueDate ? (
                            <span className={cn(overdue && 'text-rose-600 dark:text-rose-400 font-medium')}>
                              موعد: {faDate(t.dueDate)}
                            </span>
                          ) : null}
                          {t.assignedByName ? <span>واگذارشده توسط: {t.assignedByName}</span> : null}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                        disabled={busyTaskId === t.id}
                        onClick={() => completeTask(t.id)}
                        aria-label={`ثبت کار «${t.title}» به‌عنوان انجام‌شده`}
                      >
                        <Check className="h-4 w-4" />
                        انجام شد
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* نیازمند اصلاح */}
        <Card className="rounded-2xl shadow-xs">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="rounded-lg bg-orange-500/10 p-1.5 text-orange-600 dark:text-orange-500" aria-hidden>
                <FileWarning className="h-4 w-4" />
              </span>
              نیازمند اصلاح
            </CardTitle>
            <CardDescription>مقالاتی که در بازبینی برای اصلاح به شما بازگشته است</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {data.needsRevision.length === 0 ? (
              <EmptyState compact title="مقاله‌ای در انتظار اصلاح ندارید" icon={<CheckCircle2 className="h-6 w-6" />} />
            ) : (
              data.needsRevision.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(`/articles/${a.id}/edit`)}
                  className="w-full text-start rounded-xl border p-3 transition hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring group"
                >
                  <p className="text-sm font-medium line-clamp-1">{a.title}</p>
                  {a.reviewNote ? (
                    <p className="text-xs text-orange-700 dark:text-orange-400 bg-orange-500/5 rounded-lg px-2.5 py-1.5 mt-1.5 line-clamp-2 leading-5">
                      {a.reviewNote}
                    </p>
                  ) : (
                    <span className="text-xs text-muted-foreground mt-1.5 inline-block">بدون یادداشت بازبینی</span>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground">{timeAgo(a.updatedAt)}</span>
                    <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:-translate-x-0.5 transition" aria-hidden />
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* ادامه آخرین کار */}
        {data.lastWork ? (
          <Card className="rounded-2xl shadow-xs card-accent-top">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="rounded-lg bg-cyan-500/10 p-1.5 text-cyan-600 dark:text-cyan-400" aria-hidden>
                  <History className="h-4 w-4" />
                </span>
                ادامه آخرین کار
              </CardTitle>
              <CardDescription>از همان‌جا که رها کردید ادامه دهید</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium line-clamp-1">{data.lastWork.title}</p>
              <p className="text-xs text-muted-foreground mt-1.5">
                آخرین به‌روزرسانی: {timeAgo(data.lastWork.updatedAt)}
              </p>
              <Button
                className="mt-4 gap-1.5 rounded-xl"
                onClick={() => navigate(`/articles/${data.lastWork?.id}/edit`)}
              >
                ادامه ویرایش
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* ── گفت‌وگوی واگذاری کار جدید ───────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>واگذاری کار جدید</DialogTitle>
            <DialogDescription>کار جدیدی برای یکی از اعضای تیم ثبت کنید تا در مرکز کارهای او نمایش داده شود.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <Field label="عنوان کار" required htmlFor="task-title" error={titleError ?? undefined}>
              <Input
                id="task-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="مثلاً: ویرایش و به‌روزرسانی مقاله راهنمای انتشار"
                maxLength={150}
              />
            </Field>
            <Field label="توضیح" htmlFor="task-description">
              <Textarea
                id="task-description"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="توضیح اختیاری درباره این کار…"
                maxLength={500}
              />
            </Field>
            <Field label="مسئول کار" required htmlFor="task-assignee" error={assigneeError ?? undefined}>
              <Select
                value={form.assignedToId}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, assignedToId: v }))
                  setAssigneeError(null)
                }}
              >
                <SelectTrigger id="task-assignee" className="w-full" aria-label="انتخاب مسئول کار">
                  <SelectValue placeholder={assignablesLoading ? 'در حال دریافت اعضا…' : 'انتخاب مسئول…'} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {assignables.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} — {u.roleLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="نوع کار" htmlFor="task-type">
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as TaskType }))}>
                  <SelectTrigger id="task-type" className="w-full" aria-label="انتخاب نوع کار">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABELS) as TaskType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="اولویت" htmlFor="task-priority">
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v as TaskPriority }))}>
                  <SelectTrigger id="task-priority" className="w-full" aria-label="انتخاب اولویت">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field
              label="موعد انجام"
              htmlFor="task-due"
              hint={dueDateValid ? `موعد انتخابی: ${faDate(form.dueDate)}` : undefined}
            >
              <Input
                id="task-due"
                type="date"
                dir="ltr"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={submitTask} disabled={saving || !form.title.trim() || !form.assignedToId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-1.5" aria-hidden /> : null}
              واگذاری کار
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
