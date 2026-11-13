'use client'

import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import {
  AlertTriangle,
  ArrowRight,
  Bold,
  ChevronDown,
  Code,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Plus,
  Quote,
  RotateCcw,
  Save,
  Table as TableIcon,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, LoadingSpinner, ErrorState, EmptyState, Field, ConfirmDialog } from '@/components/shared/ui-bits'
import { MediaPickerDialog, mediaUrl } from '@/components/shared/media-picker'
import { ContentComments } from '@/components/shared/content-comments'
import { ContextHint } from '@/components/shared/context-hint'
import { notifyGuideEvent } from '@/lib/client/guide'
import { MessageSquare, Sparkles, TrendingUp } from 'lucide-react'
import { apiGet, apiPost, apiPut, ApiError } from '@/lib/client/api'
import { timeAgo, toFa, faDateTime, faDate } from '@/lib/client/format'
import { useAppStore, useCan } from '@/store/app-store'
import { ArticlePerformancePanel } from '@/components/shared/article-performance'
import { articleStatusInfo, TRANSITION_LABELS, type TransitionAction } from '@/lib/constants'
import {
  GLOSSARY_FIELD_LABELS,
  applyFixToText,
  severityLabel,
  type GlossaryFieldType,
  type GlossaryFinding,
} from '@/lib/glossary-check'
import { navigate, useHashRoute } from '@/hooks/use-hash-route'

type TagLite = { id: string; name: string; slug: string }

type ArticleDetail = {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  status: string
  coverImageId: string | null
  authorId: string
  categoryId: string | null
  seoTitle: string | null
  seoDescription: string | null
  noindex: boolean
  publishedAt: string | null
  views: number
  reviewNote: string | null
  ownerId: string | null
  owner: { id: string; name: string } | null
  reviewAt: string | null
  lastReviewedAt: string | null
  createdAt: string
  updatedAt: string
  author: { id: string; name: string }
  category: { id: string; name: string; color: string } | null
  tags: { tag: TagLite }[]
  versions?: { id: string; editorName: string; createdAt: string; note: string | null }[]
  _count?: { comments: number }
}

type CategoryLite = { id: string; name: string }
type TagRow = TagLite & { _count?: { articles: number } }

type VersionItem = {
  id: string
  articleId: string
  title: string
  content: string
  excerpt: string
  editorName: string
  note: string | null
  createdAt: string
}

type AutosaveDraft = { title?: string; content?: string; excerpt?: string; slug?: string; savedAt?: string }

/** انتقال‌های مجاز در ویرایشگر (هم‌راستا با منطق سرور) */
function editorTransitions(status: string, isOwn: boolean, can: (p: string) => boolean): TransitionAction[] {
  const list: TransitionAction[] = []
  if ((status === 'DRAFT' || status === 'NEEDS_REVISION') && can('articles.create') && (isOwn || can('articles.review'))) {
    list.push('SUBMIT_REVIEW')
  }
  if (status === 'IN_REVIEW' && can('articles.review')) {
    list.push('APPROVE')
    list.push('REJECT')
  }
  if (status === 'APPROVED' && can('articles.publish')) list.push('PUBLISH')
  if ((status === 'NEEDS_REVISION' || status === 'APPROVED') && (isOwn || can('articles.review'))) list.push('BACK_TO_DRAFT')
  if (status === 'PUBLISHED' && can('articles.publish')) list.push('UNPUBLISH')
  if ((status === 'PUBLISHED' || status === 'APPROVED') && can('articles.publish')) list.push('ARCHIVE')
  return list
}

/** کلاس نشان شدت یافته‌های واژه‌نامه (الزام‌آور سرخ، هشدار کهربایی، پیشنهاد خاکستری) */
const GLOSSARY_SEVERITY_BADGE: Record<string, string> = {
  ENFORCING: 'bg-destructive/10 text-destructive border-0',
  WARNING: 'bg-warning/10 text-warning border-0',
  SUGGESTION: 'bg-muted text-muted-foreground border-0',
}

/** ابزارهای درج مارک‌داون در نوار ابزار */
const MD_TOOLS: { icon: React.ElementType; label: string; before: string; after: string }[] = [
  { icon: Heading2, label: 'تیتر', before: '## ', after: '' },
  { icon: Bold, label: 'ضخیم', before: '**', after: '**' },
  { icon: Italic, label: 'مورب', before: '*', after: '*' },
  { icon: List, label: 'فهرست نقطه‌ای', before: '- ', after: '' },
  { icon: ListOrdered, label: 'فهرست شماره‌دار', before: '1. ', after: '' },
  { icon: Quote, label: 'نقل‌قول', before: '> ', after: '' },
  { icon: Link2, label: 'پیوند', before: '[', after: '](https://)' },
  { icon: Code, label: 'کد', before: '`', after: '`' },
  { icon: TableIcon, label: 'جدول', before: '', after: '\n| ستون یک | ستون دو |\n| --- | --- |\n| مقدار | مقدار |\n' },
]

export function ArticleEditorView() {
  const { segments, query } = useHashRoute()
  const user = useAppStore((s) => s.user)
  const can = useCan()

  // مسیر: #/articles/new یا #/articles/{id}/edit
  const editingId =
    segments[0] === 'articles' && segments[1] && segments[1] !== 'new' && segments[2] === 'edit' ? segments[1] : null
  const isNew = segments[0] === 'articles' && segments[1] === 'new'

  // داده سرور
  const [article, setArticle] = React.useState<ArticleDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // فیلدهای فرم
  const [title, setTitle] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [excerpt, setExcerpt] = React.useState('')
  const [content, setContent] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const [tags, setTags] = React.useState<TagLite[]>([])
  const [coverImageId, setCoverImageId] = React.useState<string | null>(null)
  const [seoTitle, setSeoTitle] = React.useState('')
  const [seoDescription, setSeoDescription] = React.useState('')
  const [noindex, setNoindex] = React.useState(false)

  // واژه‌نامه برند: بررسی سمت سرور (اصلاح فقط با اقدام صریح کاربر انجام می‌شود)
  const [glossaryChecking, setGlossaryChecking] = React.useState(false)
  const [glossaryFindings, setGlossaryFindings] = React.useState<GlossaryFinding[]>([])
  const [glossaryIgnoredCount, setGlossaryIgnoredCount] = React.useState(0)
  const [glossaryStamp, setGlossaryStamp] = React.useState<{ termsCount: number; lastUpdatedAt: string | null } | null>(null)
  const [glossaryCheckedAt, setGlossaryCheckedAt] = React.useState<number | null>(null)
  const [glossaryOpen, setGlossaryOpen] = React.useState(true)
  const [glossaryError, setGlossaryError] = React.useState<string | null>(null)
  // ثبت استثنا با دلیل الزامی
  const [ignoreTarget, setIgnoreTarget] = React.useState<GlossaryFinding | null>(null)
  const [ignoreReason, setIgnoreReason] = React.useState('')
  const [ignoring, setIgnoring] = React.useState(false)

  // مالکیت و بازبینی محتوا
  const [assignableUsers, setAssignableUsers] = React.useState<{ id: string; name: string; roleLabel: string }[]>([])
  const [ownerId, setOwnerId] = React.useState('')
  const [reviewDate, setReviewDate] = React.useState('')
  const [savingOwnership, setSavingOwnership] = React.useState(false)
  const [confirmMonths, setConfirmMonths] = React.useState('6')
  const [confirmingValidity, setConfirmingValidity] = React.useState(false)

  const [saving, setSaving] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState('content')
  const [writeTab, setWriteTab] = React.useState('write')

  // مراجع برای دسترسی در شنونده‌های پایدار
  const titleRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const baseUpdatedAtRef = React.useRef<string | null>(null)
  const dirtyRef = React.useRef(false)
  const editingIdRef = React.useRef<string | null>(null)
  const draftRef = React.useRef({ title: '', content: '', excerpt: '', slug: '' })
  dirtyRef.current = dirty
  editingIdRef.current = editingId
  draftRef.current = { title, content, excerpt, slug }

  // داده‌های جانبی
  const [categories, setCategories] = React.useState<CategoryLite[]>([])
  const [allTags, setAllTags] = React.useState<TagRow[]>([])
  const [tagPickerOpen, setTagPickerOpen] = React.useState(false)
  const [tagQuery, setTagQuery] = React.useState('')
  const [mediaPickerOpen, setMediaPickerOpen] = React.useState(false)

  // گردش کار
  const [transitioning, setTransitioning] = React.useState(false)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectNote, setRejectNote] = React.useState('')
  const [confirmAction, setConfirmAction] = React.useState<TransitionAction | null>(null)

  // تعارض ویرایش هم‌زمان
  const [conflictOpen, setConflictOpen] = React.useState(false)

  // گارد تغییر آدرس محتوای منتشرشده (۴۰۹ تغییر اسلاگ)
  const [slugGuard, setSlugGuard] = React.useState<{ oldSlug: string; newSlug: string } | null>(null)
  const [slugRegisterRedirect, setSlugRegisterRedirect] = React.useState(true)

  // نسخه‌ها
  const [versions, setVersions] = React.useState<VersionItem[] | null>(null)
  const [versionsLoading, setVersionsLoading] = React.useState(false)
  const [viewVersion, setViewVersion] = React.useState<VersionItem | null>(null)
  const [restoreTarget, setRestoreTarget] = React.useState<VersionItem | null>(null)
  const [restoring, setRestoring] = React.useState(false)

  // ذخیره خودکار
  const [autosaveAt, setAutosaveAt] = React.useState<number | null>(null)
  const [restoreDraft, setRestoreDraft] = React.useState<AutosaveDraft | null>(null)
  const [, setTick] = React.useState(0)

  const autosaveKey = `article-autosave-${editingId ?? 'new'}`

  const clearAutosave = React.useCallback(() => {
    try {
      window.localStorage.removeItem(`article-autosave-${editingIdRef.current ?? 'new'}`)
    } catch {
      /* حافظه در دسترس نیست */
    }
    setAutosaveAt(null)
  }, [])

  const markDirty = React.useCallback(() => setDirty(true), [])

  /** پرکردن فرم از داده سرور */
  const applyArticle = React.useCallback((a: ArticleDetail) => {
    setArticle(a)
    setTitle(a.title)
    setSlug(a.slug)
    setExcerpt(a.excerpt ?? '')
    setContent(a.content ?? '')
    setCategoryId(a.categoryId ?? '')
    setTags((a.tags ?? []).map((t) => t.tag))
    setCoverImageId(a.coverImageId)
    setSeoTitle(a.seoTitle ?? '')
    setSeoDescription(a.seoDescription ?? '')
    setNoindex(!!a.noindex)
    setOwnerId(a.ownerId ?? '')
    setReviewDate(a.reviewAt ? a.reviewAt.slice(0, 10) : '')
    baseUpdatedAtRef.current = a.updatedAt
    setLastSavedAt(a.updatedAt)
  }, [])

  /** بارگذاری مقاله موجود */
  const load = React.useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const a = await apiGet<ArticleDetail>(`/api/articles/${id}`)
        applyArticle(a)
        setDirty(false)

        // بررسی پیش‌نویس ذخیره‌شده در مرورگر
        try {
          const raw = window.localStorage.getItem(`article-autosave-${id}`)
          if (raw) {
            const parsed = JSON.parse(raw) as AutosaveDraft
            if (parsed && typeof parsed.content === 'string' && parsed.content !== (a.content ?? '')) {
              setRestoreDraft(parsed)
              if (parsed.savedAt) setAutosaveAt(new Date(parsed.savedAt).getTime())
            } else {
              window.localStorage.removeItem(`article-autosave-${id}`)
            }
          }
        } catch {
          /* داده خراب؛ نادیده گرفته می‌شود */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'خطا در دریافت مقاله')
      } finally {
        setLoading(false)
      }
    },
    [applyArticle]
  )

  // بارگذاری مقاله یا آماده‌سازی حالت «جدید»
  React.useEffect(() => {
    if (editingId) {
      load(editingId)
    } else {
      setArticle(null)
      setTitle('')
      setSlug('')
      setExcerpt('')
      setContent('')
      setCategoryId('')
      setTags([])
      setCoverImageId(null)
      setSeoTitle('')
      setSeoDescription('')
      setNoindex(false)
      setOwnerId('')
      setReviewDate('')
      baseUpdatedAtRef.current = null

      // الگوی محتوا: ایجاد نسخه مستقل از الگوی انتخابی
      const templateId = query.get('template')
      if (templateId) {
        apiGet<{ items: { id: string; name: string; titleTemplate: string; excerptTemplate: string; contentTemplate: string; tagNames: string; categoryId: string | null }[] }>(
          '/api/templates'
        )
          .then(async (res) => {
            const tpl = res.items.find((t) => t.id === templateId)
            if (!tpl) return
            setTitle(tpl.titleTemplate)
            setExcerpt(tpl.excerptTemplate)
            setContent(tpl.contentTemplate)
            if (tpl.categoryId) setCategoryId(tpl.categoryId)
            // برچسب‌ها: فقط موارد موجود در سامانه اتصل می‌شوند (بدون ساخت خودکار)
            try {
              const names = (JSON.parse(tpl.tagNames || '[]') as string[]).map((n) => n.toLowerCase())
              if (names.length > 0) {
                const allTags = await apiGet<TagRow[]>('/api/tags')
                const matched = allTags.filter((t) => names.includes(t.name.toLowerCase()))
                setTags(matched.map((t) => ({ id: t.id, name: t.name, slug: t.slug })))
              }
            } catch {
              /* برچسب اختیاری است */
            }
            toast.success(`الگوی «${tpl.name}» اعمال شد؛ بخش‌های کروشه‌ای را تکمیل کنید.`)
            setDirty(true)
          })
          .catch(() => {
            /* الگو اختیاری است */
          })
      }
      setLastSavedAt(null)
      setDirty(false)
      setError(null)
      // پیش‌نویس ذخیره‌شده مقاله جدید
      try {
        const raw = window.localStorage.getItem('article-autosave-new')
        if (raw) {
          const parsed = JSON.parse(raw) as AutosaveDraft
          if (parsed && (parsed.title || parsed.content)) {
            setRestoreDraft(parsed)
            if (parsed.savedAt) setAutosaveAt(new Date(parsed.savedAt).getTime())
          }
        }
      } catch {
        /* داده خراب؛ نادیده گرفته می‌شود */
      }
    }
  }, [editingId, load, query])

  // دسته‌بندی‌ها و برچسب‌ها
  React.useEffect(() => {
    apiGet<CategoryLite[]>('/api/categories')
      .then(setCategories)
      .catch(() => {
        /* اختیاری */
      })
    apiGet<TagRow[]>('/api/tags')
      .then(setAllTags)
      .catch(() => {
        /* اختیاری */
      })
    apiGet<{ items: { id: string; name: string; roleLabel: string }[] }>('/api/users/assignable')
      .then((res) => setAssignableUsers(res.items))
      .catch(() => {
        /* اختیاری */
      })
  }, [])

  // شنونده ذخیره خودکار (هر ۲۰ ثانیه)
  React.useEffect(() => {
    const t = window.setInterval(() => {
      setTick((x) => x + 1)
      if (!dirtyRef.current) return
      try {
        const key = `article-autosave-${editingIdRef.current ?? 'new'}`
        const d = draftRef.current
        window.localStorage.setItem(
          key,
          JSON.stringify({ ...d, savedAt: new Date().toISOString() })
        )
        setAutosaveAt(Date.now())
      } catch {
        /* حافظه در دسترس نیست */
      }
    }, 20000)
    return () => window.clearInterval(t)
  }, [])

  // نسخه‌ها: بارگذاری هنگام باز شدن تب
  const loadVersions = React.useCallback(async (id: string) => {
    setVersionsLoading(true)
    try {
      const res = await apiGet<{ items: VersionItem[]; title: string; updatedAt: string }>(
        `/api/articles/${id}/versions`
      )
      setVersions(res.items)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطا در دریافت نسخه‌ها')
    } finally {
      setVersionsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (activeTab === 'versions' && editingId) loadVersions(editingId)
  }, [activeTab, editingId, loadVersions])

  // ─── ذخیره ─────────────────────────────────────────────────────
  const save = React.useCallback(
    async (opts?: {
      skipBase?: boolean
      forceSlugConfirm?: boolean
      registerRedirect?: boolean
    }): Promise<boolean> => {
      if (title.trim().length < 3) {
        toast.error('عنوان مقاله باید حداقل ۳ نویسه باشد.')
        titleRef.current?.focus()
        return false
      }
      setSaving(true)
      setConflictOpen(false)
      try {
        if (editingId) {
          const payload: Record<string, unknown> = {
            title: title.trim(),
            slug: slug.trim(),
            excerpt,
            content,
            categoryId: categoryId || null,
            tagIds: tags.map((t) => t.id),
            coverImageId,
            seoTitle: seoTitle.trim() || null,
            seoDescription: seoDescription.trim() || null,
            noindex,
          }
          if (!opts?.skipBase && baseUpdatedAtRef.current) payload.baseUpdatedAt = baseUpdatedAtRef.current
          if (opts?.forceSlugConfirm) {
            payload.confirmSlugChange = true
            payload.registerRedirect = !!opts.registerRedirect
          }
          const updated = await apiPut<ArticleDetail>(`/api/articles/${editingId}`, payload)
          applyArticle(updated)
          setDirty(false)
          clearAutosave()
          toast.success('تغییرات ذخیره شد')
          // راهنما: ذخیرهٔ موفق مقالهٔ موجود با تصویر شاخص و دسته‌بندی → تکمیل محتوا
          if (coverImageId && categoryId) void notifyGuideEvent('article.content_completed')
        } else {
          const created = await apiPost<ArticleDetail>('/api/articles', {
            title: title.trim(),
            slug: slug.trim() || undefined,
            excerpt,
            content,
            categoryId: categoryId || null,
            tagIds: tags.map((t) => t.id),
            coverImageId,
            seoTitle: seoTitle.trim() || null,
            seoDescription: seoDescription.trim() || null,
            noindex,
          })
          clearAutosave()
          setDirty(false)
          toast.success('مقاله ایجاد شد')
          // راهنما: اولین ذخیرهٔ موفق مقالهٔ جدید؛ اگر تصویر شاخص و دسته‌بندی هم ثبت شده باشد
          // همان ذخیره گام «تکمیل محتوا» را نیز تکمیل می‌کند (سرور ایدمپوتنت و مجوزسنجی‌شده است)
          void notifyGuideEvent('article.first_draft_saved')
          if (coverImageId && categoryId) void notifyGuideEvent('article.content_completed')
          applyArticle(created)
          setRestoreDraft(null)
          navigate(`/articles/${created.id}/edit`)
        }
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const data = (e.data ?? {}) as {
            conflict?: boolean
            slugChange?: boolean
            oldSlug?: string
            newSlug?: string
          }
          if (data.conflict) {
            setConflictOpen(true)
          } else if (data.slugChange) {
            // تغییر آدرس محتوای منتشرشده — گفت‌وگوی تأیید با گزینهٔ ریدایرکت باز می‌شود
            setSlugRegisterRedirect(true)
            setSlugGuard({
              oldSlug: data.oldSlug ?? article?.slug ?? '',
              newSlug: data.newSlug ?? slug.trim(),
            })
          } else {
            toast.error(e.message)
          }
        } else {
          toast.error(e instanceof Error ? e.message : 'ذخیره مقاله ناموفق بود.')
        }
        return false
      } finally {
        setSaving(false)
      }
    },
    [title, slug, excerpt, content, categoryId, tags, coverImageId, seoTitle, seoDescription, noindex, editingId, article, applyArticle, clearAutosave]
  )

  /** ذخیرهٔ مجدد همان محموله با تأیید تغییر آدرس منتشرشده و ثبت اختیاری ریدایرکت */
  const confirmSlugSave = async (registerRedirect: boolean) => {
    const ok = await save({ forceSlugConfirm: true, registerRedirect })
    if (ok) setSlugGuard(null)
  }

  // ─── گردش کار ──────────────────────────────────────────────────
  const doTransition = async (action: TransitionAction, note?: string) => {
    if (!editingId) {
      toast.error('برای گردش کار، ابتدا مقاله را ذخیره کنید.')
      return
    }
    setTransitioning(true)
    setConfirmAction(null)
    try {
      const updated = await apiPost<ArticleDetail>(`/api/articles/${editingId}/transition`, {
        action,
        ...(note ? { note } : {}),
      })
      // ادغام سبک: فیلدهای فرم دست‌نخورده می‌مانند
      setArticle((prev) => (prev ? { ...prev, ...updated } : updated))
      baseUpdatedAtRef.current = updated.updatedAt
      setLastSavedAt(updated.updatedAt)
      if (action === 'PUBLISH') clearAutosave()
      setRejectOpen(false)
      setRejectNote('')
      toast.success(`«${TRANSITION_LABELS[action]}» با موفقیت انجام شد.`)
      // راهنما: رویدادهای گردش کار فقط پس از موفقیت واقعی انتقال ثبت می‌شوند
      if (action === 'SUBMIT_REVIEW') {
        void notifyGuideEvent('article.sent_to_review')
      } else if (action === 'APPROVE') {
        // تأیید = ثبت نتیجهٔ بازبینی + تأیید نسخه (هر دو گام، ایدمپوتنت)
        void notifyGuideEvent('article.reviewed')
        void notifyGuideEvent('article.approved')
      } else if (action === 'REJECT') {
        void notifyGuideEvent('article.revision_requested')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'انجام عملیات ناموفق بود.')
    } finally {
      setTransitioning(false)
    }
  }

  // ─── بازگردانی نسخه ────────────────────────────────────────────
  const doRestore = async () => {
    if (!editingId || !restoreTarget) return
    setRestoring(true)
    try {
      await apiPost(`/api/articles/${editingId}/versions`, { versionId: restoreTarget.id })
      toast.success('نسخه انتخابی بازیابی شد.')
      setRestoreTarget(null)
      await load(editingId)
      await loadVersions(editingId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'بازگردانی نسخه ناموفق بود.')
    } finally {
      setRestoring(false)
    }
  }

  // ─── درج مارک‌داون ─────────────────────────────────────────────
  const applyMd = (before: string, after: string) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? content.length
    const end = el.selectionEnd ?? content.length
    const selectedText = content.slice(start, end)
    const next = content.slice(0, start) + before + selectedText + after + content.slice(end)
    setContent(next)
    markDirty()
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + before.length + selectedText.length
      el.setSelectionRange(pos, pos)
    })
  }

  // ─── مالکیت و بازبینی ──────────────────────────────────────────
  const saveOwnership = async () => {
    if (!editingId) return
    setSavingOwnership(true)
    try {
      const updated = await apiPut<ArticleDetail>(`/api/articles/${editingId}`, {
        ownerId: ownerId || null,
        reviewAt: reviewDate || null,
      })
      applyArticle(updated)
      toast.success('مالکیت و موعد بازبینی ذخیره شد.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ذخیره مالکیت ناموفق بود.')
    } finally {
      setSavingOwnership(false)
    }
  }

  const confirmValidity = async () => {
    if (!editingId) {
      toast.error('برای تأیید اعتبار، ابتدا مقاله را ذخیره کنید.')
      return
    }
    setConfirmingValidity(true)
    try {
      const updated = await apiPost<ArticleDetail>(`/api/articles/${editingId}/confirm-review`, {
        months: Number(confirmMonths),
      })
      applyArticle(updated)
      toast.success('اعتبار اطلاعات تأیید شد؛ موعد بازبینی تمدید گردید.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تأیید اعتبار ناموفق بود.')
    } finally {
      setConfirmingValidity(false)
    }
  }

  // ─── وضعیت‌های مشتق‌شده ────────────────────────────────────────
  const statusInfo = article ? articleStatusInfo(article.status) : null
  const isOwnArticle = !!article && !!user && article.authorId === user.id
  const canEditAny = can('articles.edit.any')
  const blockedForOwn =
    !canEditAny && !!article && (article.status === 'PUBLISHED' || article.status === 'ARCHIVED')
  const readonly = !!article && !(canEditAny || (can('articles.edit.own') && isOwnArticle && !blockedForOwn))

  // موانع انتشار: علت عدم آمادگی برای گردش کار را شفاف نشان می‌دهیم
  const publishBlockers = React.useMemo(() => {
    const list: string[] = []
    if (!categoryId.trim()) list.push('دسته‌بندی')
    if (!coverImageId) list.push('تصویر شاخص')
    if (!excerpt.trim()) list.push('خلاصه')
    return list
  }, [categoryId, coverImageId, excerpt])

  const reviewOverdue = !!article?.reviewAt && new Date(article.reviewAt).getTime() < Date.now()

  const canRestoreVersions =
    !!editingId &&
    !!article &&
    (canEditAny || (can('articles.edit.own') && isOwnArticle && !blockedForOwn))

  const transitions = article && !readonly ? editorTransitions(article.status, isOwnArticle, can) : []
  const needsConfirm = (a: TransitionAction) => a === 'PUBLISH' || a === 'UNPUBLISH' || a === 'ARCHIVE'

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const availableTags = allTags.filter(
    (t) => !tags.some((s) => s.id === t.id) && t.name.toLowerCase().includes(tagQuery.trim().toLowerCase())
  )

  // ─── واژه‌نامه برند: بررسی سمت سرور با مُهر نسخه قواعد ─────────
  // نویسنده می‌تواند روی مقاله خودش موردی را با دلیل نادیده بگیرد؛ بیننده نمی‌تواند.
  const canIgnoreGlossary = can('articles.review') || isOwnArticle

  const runGlossaryCheck = React.useCallback(
    async (fieldOverrides?: Partial<Record<GlossaryFieldType, string>>) => {
      if (!editingId) {
        toast.error('برای بررسی، ابتدا محتوا را ذخیره کنید.')
        return
      }
      setGlossaryChecking(true)
      setGlossaryError(null)
      try {
        const res = await apiPost<{
          findings: GlossaryFinding[]
          ignoredCount: number
          rulesStamp: { termsCount: number; lastUpdatedAt: string | null }
        }>('/api/glossary/check', {
          entityType: 'ARTICLE',
          entityId: editingId,
          fields: {
            TITLE: title,
            EXCERPT: excerpt,
            CONTENT: content,
            SEO_TITLE: seoTitle,
            SEO_DESCRIPTION: seoDescription,
            ...fieldOverrides,
          },
        })
        setGlossaryFindings(res.findings)
        setGlossaryIgnoredCount(res.ignoredCount)
        setGlossaryStamp(res.rulesStamp)
        setGlossaryCheckedAt(Date.now())
        setGlossaryOpen(true)
      } catch (e) {
        setGlossaryError(e instanceof Error ? e.message : 'بررسی واژه‌نامه ناموفق بود.')
      } finally {
        setGlossaryChecking(false)
      }
    },
    [editingId, title, excerpt, content, seoTitle, seoDescription]
  )

  /** اعمال اصلاح یک مورد مشخص — فقط با اقدام صریح کاربر و روی مقدار فعلی همان فیلد */
  const applyGlossaryFix = (finding: GlossaryFinding) => {
    if (!finding.suggestion) return
    const current =
      finding.field === 'TITLE'
        ? title
        : finding.field === 'EXCERPT'
          ? excerpt
          : finding.field === 'CONTENT'
            ? content
            : finding.field === 'SEO_TITLE'
              ? seoTitle
              : seoDescription
    // اگر متن پس از بررسی تغییر کرده باشد، مکان ثبت‌شده دیگر معتبر نیست
    if (current.slice(finding.index, finding.index + finding.length) !== finding.observed) {
      toast.error('متن پس از بررسی تغییر کرده است؛ لطفاً بررسی را دوباره اجرا کنید.')
      return
    }
    const next = applyFixToText(current, finding.index, finding.length, finding.suggestion)
    if (finding.field === 'TITLE') setTitle(next)
    else if (finding.field === 'EXCERPT') setExcerpt(next)
    else if (finding.field === 'CONTENT') setContent(next)
    else if (finding.field === 'SEO_TITLE') setSeoTitle(next)
    else setSeoDescription(next)
    markDirty()
    toast.success(`«${finding.observed}» با «${finding.suggestion}» جایگزین شد.`)
    // بررسی مجدد (فقط‌خواندنی) برای به‌روز ماندن مکان و بافت سایر موارد همان فیلد
    void runGlossaryCheck({ [finding.field]: next } as Partial<Record<GlossaryFieldType, string>>)
  }

  /** ثبت استثنا با دلیل الزامی؛ پس از ثبت، بررسی دوباره اجرا می‌شود */
  const submitGlossaryIgnore = async () => {
    if (!ignoreTarget || !editingId) return
    if (ignoreReason.trim().length < 5) {
      toast.error('دلیل نادیده گرفتن باید حداقل ۵ نویسه باشد.')
      return
    }
    setIgnoring(true)
    try {
      await apiPost('/api/glossary/exceptions', {
        termId: ignoreTarget.ruleId,
        entityType: 'ARTICLE',
        entityId: editingId,
        field: ignoreTarget.field,
        reason: ignoreReason.trim(),
      })
      toast.success('این مورد با ثبت دلیل نادیده گرفته شد.')
      setIgnoreTarget(null)
      setIgnoreReason('')
      await runGlossaryCheck()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ثبت استثنا ناموفق بود.')
    } finally {
      setIgnoring(false)
    }
  }

  // گروه‌بندی یافته‌ها بر اساس شدت برای نمایش مرحله‌ای
  const glossaryGroups = React.useMemo(() => {
    const groups: { severity: 'ENFORCING' | 'WARNING' | 'SUGGESTION'; items: GlossaryFinding[] }[] = [
      { severity: 'ENFORCING', items: [] },
      { severity: 'WARNING', items: [] },
      { severity: 'SUGGESTION', items: [] },
    ]
    for (const f of glossaryFindings) {
      const g = groups.find((x) => x.severity === f.severity)
      if (g) g.items.push(f)
    }
    return groups.filter((g) => g.items.length > 0)
  }, [glossaryFindings])

  // ─── بارگذاری اولیه ────────────────────────────────────────────
  if (!isNew && !editingId) return null
  if (loading && !article && editingId) return <LoadingSpinner label="در حال بارگذاری مقاله…" />
  if (error) return <ErrorState message={error} onRetry={() => editingId && load(editingId)} />

  return (
    <div>
      {/* نوار اقدام چسبان */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/articles')}
            aria-label="بازگشت به فهرست مقالات"
            className="shrink-0"
          >
            <ArrowRight className="h-5 w-5" />
          </Button>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              markDirty()
            }}
            placeholder="عنوان مقاله…"
            aria-label="عنوان مقاله"
            disabled={readonly}
            className="text-xl font-bold w-full bg-transparent outline-none placeholder:text-muted-foreground/60 min-w-0"
          />
          <div className="flex items-center gap-2 shrink-0">
            {statusInfo ? (
              <StatusBadge label={statusInfo.label} colorClass={statusInfo.color} bgClass={statusInfo.bg} />
            ) : (
              <Badge variant="secondary">جدید</Badge>
            )}
            <span className="hidden lg:inline text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
              {lastSavedAt ? `آخرین ذخیره: ${timeAgo(lastSavedAt)}` : ''}
            </span>
            {!readonly ? (
              <Button onClick={() => save()} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                ذخیره
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* هشدار پیش‌نویس ذخیره‌شده */}
      {restoreDraft ? (
        <Alert className="my-4 border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>پیش‌نویس ذخیره‌شده در مرورگر یافت شد</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              نسخه‌ای از این مقاله در {restoreDraft.savedAt ? timeAgo(restoreDraft.savedAt) : 'گذشته'} به‌صورت خودکار ذخیره شده و با نسخه سرور تفاوت دارد.
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (restoreDraft.title !== undefined) setTitle(restoreDraft.title)
                  if (restoreDraft.content !== undefined) setContent(restoreDraft.content)
                  if (restoreDraft.excerpt !== undefined) setExcerpt(restoreDraft.excerpt)
                  if (restoreDraft.slug !== undefined) setSlug(restoreDraft.slug)
                  setDirty(true)
                  setRestoreDraft(null)
                  toast.success('پیش‌نویس ذخیره‌شده بازیابی شد.')
                }}
              >
                بازیابی پیش‌نویس ذخیره‌شده
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(autosaveKey)
                  } catch {
                    /* بی‌اهمیت */
                  }
                  setRestoreDraft(null)
                  setAutosaveAt(null)
                }}
              >
                نادیده گرفتن
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {readonly ? (
        <p className="text-xs text-muted-foreground mt-4">این مقاله برای شما فقط‌خواندنی است و امکان ویرایش ندارید.</p>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="content">محتوا</TabsTrigger>
          <TabsTrigger value="seo">سئو</TabsTrigger>
          {editingId ? (
            <TabsTrigger value="discussion" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              گفتگوها
            </TabsTrigger>
          ) : null}
          {editingId ? <TabsTrigger value="versions">نسخه‌ها</TabsTrigger> : null}
          {editingId && can('analytics.view') ? <TabsTrigger value="performance">عملکرد</TabsTrigger> : null}
        </TabsList>

        {/* ─── تب محتوا ─────────────────────────────────────────── */}
        <TabsContent value="content" className="mt-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3 min-w-0">
              {/* نوار ابزار مارک‌داون */}
              {!readonly ? (
                <div className="flex flex-wrap items-center gap-1 rounded-lg border p-1.5" role="toolbar" aria-label="ابزار قالب‌بندی متن">
                  {MD_TOOLS.map((tool) => (
                    <Button
                      key={tool.label}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      title={tool.label}
                      aria-label={tool.label}
                      onClick={() => applyMd(tool.before, tool.after)}
                    >
                      <tool.icon className="h-4 w-4" />
                    </Button>
                  ))}
                </div>
              ) : null}

              <Tabs value={writeTab} onValueChange={setWriteTab}>
                <TabsList className="h-8">
                  <TabsTrigger value="write" className="text-xs">نوشتن</TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs">
                    <Eye className="h-3.5 w-3.5" />
                    پیش‌نمایش
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="write" className="mt-2">
                  <Textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value)
                      markDirty()
                    }}
                    placeholder="متن مقاله را بنویسید… (از نوار ابزار بالا برای قالب‌بندی مارک‌داون استفاده کنید)"
                    disabled={readonly}
                    className="min-h-[420px] font-normal text-sm leading-8 resize-y"
                    aria-label="محتوای مقاله"
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-2">
                  <div className="md-preview rounded-lg border bg-card p-4 min-h-[420px] max-h-[70vh] overflow-y-auto">
                    {content.trim() ? (
                      <ReactMarkdown>{content}</ReactMarkdown>
                    ) : (
                      <p className="text-sm text-muted-foreground">چیزی برای پیش‌نمایش وجود ندارد.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              {/* شمارنده واژه‌ها و ذخیره خودکار */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  تعداد واژه‌ها: <span className="tabular-nums font-medium text-foreground">{toFa(wordCount)}</span>
                </span>
                <span aria-live="polite">
                  ذخیره خودکار: {autosaveAt ? timeAgo(new Date(autosaveAt)) : 'خاموش'}
                </span>
              </div>
            </div>

            {/* ─── ستون کناری ─────────────────────────────────────── */}
            <div className="space-y-4 min-w-0">
              {/* وضعیت و گردش کار */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">وضعیت و گردش کار</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {statusInfo ? (
                    <StatusBadge label={statusInfo.label} colorClass={statusInfo.color} bgClass={statusInfo.bg} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      مقاله پس از ذخیره با وضعیت «پیش‌نویس» ایجاد می‌شود.
                    </p>
                  )}

                  {article?.status === 'NEEDS_REVISION' && article.reviewNote ? (
                    <Alert className="border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>یادداشت بازبینی</AlertTitle>
                      <AlertDescription>{article.reviewNote}</AlertDescription>
                    </Alert>
                  ) : null}

                  {/* راهنمای درون‌برنامه‌ای: علت عدم آمادگی برای انتشار */}
                  {publishBlockers.length > 0 && (statusInfo?.value === 'DRAFT' || statusInfo?.value === 'APPROVED') ? (
                    <Alert className="border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle className="text-sm">برای گذر روان از گردش کار</AlertTitle>
                      <AlertDescription className="text-xs leading-5">
                        ابتدا این موارد را تکمیل کنید: <span className="font-semibold">{publishBlockers.join('، ')}</span>.
                        مقاله بدون این موارد قابل ارسال است، اما کیفیت انتشار پایین می‌آید.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {/* راهنمای درون‌خطی: چرا انتشار در وضعیت فعلی در دسترس نیست */}
                  {statusInfo && ['DRAFT', 'NEEDS_REVISION', 'IN_REVIEW'].includes(statusInfo.value) ? (
                    <ContextHint tone="warning" title="چرا انتشار غیرفعال است؟">
                      <p>نسخهٔ فعلی هنوز تأیید نشده است؛ می‌توانید آن را برای بررسی ارسال کنید.</p>
                      {statusInfo.value !== 'DRAFT' && publishBlockers.length > 0 ? (
                        <p className="mt-1">پیش از انتشار، این موارد را تکمیل کنید: {publishBlockers.join('، ')}.</p>
                      ) : null}
                    </ContextHint>
                  ) : null}

                  {transitions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {editingId ? 'در وضعیت فعلی اقدامی برای گردش کار در دسترس شما نیست.' : 'برای استفاده از گردش کار، ابتدا مقاله را ذخیره کنید.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {transitions.map((action) => (
                        <Button
                          key={action}
                          variant="outline"
                          size="sm"
                          className="w-full justify-start"
                          disabled={transitioning}
                          onClick={() => {
                            if (action === 'REJECT') {
                              setRejectOpen(true)
                              setRejectNote('')
                            } else if (needsConfirm(action)) {
                              setConfirmAction(action)
                            } else {
                              doTransition(action)
                            }
                          }}
                        >
                          {TRANSITION_LABELS[action]}
                        </Button>
                      ))}
                    </div>
                  )}

                  {/* فرم یادداشت بازگشت برای اصلاح */}
                  {rejectOpen ? (
                    <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
                      <Field label="یادداشت بازبینی (الزامی)" htmlFor="reject-note">
                        <Textarea
                          id="reject-note"
                          rows={3}
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          placeholder="دلیل بازگشت مقاله برای اصلاح را بنویسید (حداقل ۵ نویسه)…"
                        />
                      </Field>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={transitioning || rejectNote.trim().length < 5}
                          onClick={() => doTransition('REJECT', rejectNote.trim())}
                          className="gap-1.5"
                        >
                          {transitioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          ثبت بازگشت
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRejectOpen(false)}>
                          انصراف
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* مالکیت و بازبینی محتوا */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">مالکیت و بازبینی</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field
                    label="مالک مسئول صحت اطلاعات"
                    htmlFor="owner-select"
                    hint="فردی که پاسخ‌گوی به‌روز بودن این محتوا است (ممکن است غیر از نویسنده باشد)."
                  >
                    <Select
                      value={ownerId || 'none'}
                      onValueChange={(v) => setOwnerId(v === 'none' ? '' : v)}
                      disabled={readonly}
                    >
                      <SelectTrigger id="owner-select" className="w-full">
                        <SelectValue placeholder="انتخاب مالک" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">بدون مالک مشخص</SelectItem>
                        {assignableUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({u.roleLabel})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field
                    label="موعد بازبینی بعدی"
                    htmlFor="review-date"
                    hint={reviewDate ? `بازبینی در تاریخ ${faDate(reviewDate + 'T00:00:00Z')}` : 'پس از این تاریخ، محتوا در مرکز کارهای مالک یادآوری می‌شود.'}
                  >
                    <Input
                      id="review-date"
                      type="date"
                      dir="ltr"
                      value={reviewDate}
                      onChange={(e) => setReviewDate(e.target.value)}
                      disabled={readonly}
                      aria-label="موعد بازبینی بعدی"
                    />
                  </Field>

                  {reviewOverdue ? (
                    <p className="text-xs font-medium text-destructive">
                      بازبینی این محتوا از موعد گذشته است.
                    </p>
                  ) : null}
                  {article?.lastReviewedAt ? (
                    <p className="text-xs text-muted-foreground">
                      آخرین تأیید اعتبار: {faDateTime(article.lastReviewedAt)}
                    </p>
                  ) : null}

                  {!readonly ? (
                    <Button size="sm" onClick={saveOwnership} disabled={savingOwnership} className="w-full">
                      ذخیره مالکیت و موعد
                    </Button>
                  ) : null}

                  <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                    <p className="text-xs leading-5 text-muted-foreground">
                      اگر اطلاعات همچنان معتبر است، اعتبار را تأیید کنید تا موعد بازبینی تمدید شود.
                    </p>
                    <div className="flex gap-2">
                      <Select value={confirmMonths} onValueChange={setConfirmMonths}>
                        <SelectTrigger className="w-32 h-9" aria-label="دوره تمدید">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">۱ ماه</SelectItem>
                          <SelectItem value="3">۳ ماه</SelectItem>
                          <SelectItem value="6">۶ ماه</SelectItem>
                          <SelectItem value="12">۱۲ ماه</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={confirmValidity}
                        disabled={confirmingValidity}
                      >
                        تأیید اعتبار اطلاعات
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* بررسی واژه‌نامه برند — نتیجه بررسی سمت سرور؛ اصلاح فقط با اقدام کاربر */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-warning" aria-hidden />
                      بررسی واژه‌نامه برند
                    </CardTitle>
                    {glossaryStamp ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => setGlossaryOpen((o) => !o)}
                        aria-expanded={glossaryOpen}
                      >
                        {glossaryOpen ? 'بستن نتایج' : 'نمایش نتایج'}
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${glossaryOpen ? '' : 'rotate-180'}`}
                          aria-hidden
                        />
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => runGlossaryCheck()}
                      disabled={!editingId || glossaryChecking || saving}
                    >
                      {glossaryChecking ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {glossaryChecking ? 'در حال بررسی…' : glossaryStamp ? 'بررسی مجدد' : 'بررسی واژه‌نامه'}
                    </Button>
                    {!editingId ? (
                      <span className="text-xs text-muted-foreground">برای بررسی، ابتدا محتوا را ذخیره کنید</span>
                    ) : null}
                    {glossaryCheckedAt ? (
                      <span className="text-xs text-muted-foreground">آخرین بررسی: {timeAgo(new Date(glossaryCheckedAt))}</span>
                    ) : null}
                  </div>

                  {/* راهنمای شدت‌ها و اصل بازبینی انسانی */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>شدت‌ها:</span>
                    <Badge className={GLOSSARY_SEVERITY_BADGE.ENFORCING + ' text-[11px]'}>الزام‌آور</Badge>
                    <Badge className={GLOSSARY_SEVERITY_BADGE.WARNING + ' text-[11px]'}>هشدار</Badge>
                    <Badge className={GLOSSARY_SEVERITY_BADGE.SUGGESTION + ' text-[11px]'}>پیشنهاد</Badge>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    اصلاح خودکار سراسری انجام نمی‌شود؛ هر مورد باید بازبینی و تأیید شود.
                  </p>

                  {glossaryError ? (
                    <Alert className="border-destructive/40 [&>svg]:text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle className="text-sm">بررسی واژه‌نامه ناموفق بود</AlertTitle>
                      <AlertDescription className="text-xs">{glossaryError}</AlertDescription>
                    </Alert>
                  ) : null}

                  {glossaryStamp ? (
                    glossaryOpen ? (
                      glossaryFindings.length === 0 ? (
                        <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                          <p className="font-medium text-foreground">
                            موردی در واژه‌نامه یافت نشد؛ محتوا با قواعد فعلی هماهنگ است.
                          </p>
                          {glossaryIgnoredCount > 0 ? (
                            <p>{toFa(glossaryIgnoredCount)} مورد با ثبت دلیل نادیده گرفته شده است.</p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {glossaryGroups.map((group) => (
                            <div key={group.severity} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Badge className={GLOSSARY_SEVERITY_BADGE[group.severity] + ' text-xs'}>
                                  {severityLabel(group.severity)}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{toFa(group.items.length)} مورد</span>
                              </div>
                              {group.items.map((f, i) => (
                                <div key={`${f.ruleId}-${f.field}-${f.index}-${i}`} className="rounded-xl border p-3 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary" className="text-[11px] font-normal">
                                      {GLOSSARY_FIELD_LABELS[f.field]}
                                    </Badge>
                                    <span className="text-sm font-medium" dir="auto">
                                      «{f.observed}»
                                    </span>
                                    {f.preferred ? (
                                      <span className="text-xs text-muted-foreground">
                                        عبارت ترجیحی:{' '}
                                        <span className="font-medium text-foreground">«{f.preferred}»</span>
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="text-xs leading-5 text-muted-foreground" dir="auto">
                                    {f.snippet}
                                  </p>
                                  {f.reason ? <p className="text-xs leading-5">علت: {f.reason}</p> : null}
                                  {f.example ? (
                                    <p className="text-xs leading-5">
                                      <span className="text-muted-foreground">مثال کاربرد درست: </span>
                                      <span dir="auto">{f.example}</span>
                                    </p>
                                  ) : null}
                                  {f.suggestion ? (
                                    <p className="text-xs leading-5">
                                      پیشنهاد: <span className="font-medium text-foreground">«{f.suggestion}»</span>
                                    </p>
                                  ) : null}
                                  <div className="flex flex-wrap gap-2">
                                    {f.suggestion && !readonly ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() => applyGlossaryFix(f)}
                                      >
                                        اعمال اصلاح
                                      </Button>
                                    ) : null}
                                    {canIgnoreGlossary ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-xs"
                                        onClick={() => {
                                          setIgnoreTarget(f)
                                          setIgnoreReason('')
                                        }}
                                      >
                                        نادیده گرفتن
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                          <div className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                            <p>بررسی با {toFa(glossaryStamp.termsCount)} قاعده فعال انجام شد.</p>
                            {glossaryIgnoredCount > 0 ? (
                              <p>{toFa(glossaryIgnoredCount)} مورد با ثبت دلیل نادیده گرفته شده است.</p>
                            ) : null}
                          </div>
                        </div>
                      )
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {toFa(glossaryFindings.length)} مورد یافت شده؛ برای مشاهده جزئیات، نتایج را باز کنید.
                      </p>
                    )
                  ) : null}
                </CardContent>
              </Card>

              {/* دسته‌بندی و برچسب‌ها */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">دسته‌بندی و برچسب‌ها</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="دسته‌بندی" htmlFor="category-select">
                    <Select
                      value={categoryId || 'none'}
                      onValueChange={(v) => {
                        setCategoryId(v === 'none' ? '' : v)
                        markDirty()
                      }}
                      disabled={readonly}
                    >
                      <SelectTrigger id="category-select" className="w-full">
                        <SelectValue placeholder="انتخاب دسته‌بندی" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">بدون دسته‌بندی</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="space-y-2">
                    <Label>برچسب‌ها</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <Badge key={t.id} variant="secondary" className="gap-1">
                          {t.name}
                          {!readonly ? (
                            <button
                              type="button"
                              onClick={() => {
                                setTags((prev) => prev.filter((x) => x.id !== t.id))
                                markDirty()
                              }}
                              aria-label={`حذف برچسب ${t.name}`}
                              className="rounded-full hover:bg-foreground/10 p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          ) : null}
                        </Badge>
                      ))}
                      {tags.length === 0 ? (
                        <span className="text-xs text-muted-foreground">برچسبی انتخاب نشده است</span>
                      ) : null}
                    </div>
                    {!readonly ? (
                      <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <Plus className="h-3.5 w-3.5" />
                            افزودن برچسب
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-64" align="start">
                          <div className="p-2 border-b">
                            <Input
                              value={tagQuery}
                              onChange={(e) => setTagQuery(e.target.value)}
                              placeholder="جست‌وجوی برچسب…"
                              aria-label="جست‌وجوی برچسب"
                              className="h-8"
                            />
                          </div>
                          <ScrollArea className="h-48">
                            {availableTags.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-6" role="status">برچسبی با این عبارت یافت نشد</p>
                            ) : (
                              <div className="p-1">
                                {availableTags.map((t) => (
                                  <button
                                    key={t.id}
                                    type="button"
                                    className="w-full text-start rounded-md px-2.5 py-1.5 text-sm hover:bg-muted transition"
                                    onClick={() => {
                                      setTags((prev) => [...prev, { id: t.id, name: t.name, slug: t.slug }])
                                      markDirty()
                                      setTagQuery('')
                                    }}
                                  >
                                    {t.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              {/* تصویر شاخص */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">تصویر شاخص</CardTitle>
                </CardHeader>
                <CardContent>
                  {coverImageId ? (
                    <div className="space-y-2">
                      <img
                        src={mediaUrl(coverImageId)}
                        alt="تصویر شاخص مقاله"
                        className="w-full aspect-video object-cover rounded-md border"
                      />
                      {!readonly ? (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setMediaPickerOpen(true)}>
                            تغییر تصویر
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive gap-1.5"
                            onClick={() => {
                              setCoverImageId(null)
                              markDirty()
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            حذف تصویر
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : readonly ? (
                    <p className="text-xs text-muted-foreground">تصویری انتخاب نشده است.</p>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setMediaPickerOpen(true)}>
                      <ImagePlus className="h-4 w-4" />
                      انتخاب از کتابخانه
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* خلاصه */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">خلاصه</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    rows={4}
                    value={excerpt}
                    onChange={(e) => {
                      setExcerpt(e.target.value)
                      markDirty()
                    }}
                    placeholder="خلاصه‌ای کوتاه برای فهرست‌ها و نتایج جست‌وجو…"
                    disabled={readonly}
                    aria-label="خلاصه مقاله"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                    {toFa(excerpt.length)} / {toFa(500)} نویسه
                  </p>
                </CardContent>
              </Card>

              {/* آدرس کوتاه */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">آدرس کوتاه (Slug)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Input
                    dir="ltr"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value)
                      markDirty()
                    }}
                    placeholder="article-slug"
                    disabled={readonly}
                    aria-label="آدرس کوتاه مقاله"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">فقط حروف انگلیسی، عدد و خط تیره</p>
                  <div className="mt-3">
                    <ContextHint title="دربارهٔ آدرس کوتاه (slug)">
                      <p>
                        از حروف لاتین، رقم و خط تیره استفاده کنید؛ مثال:{' '}
                        <span dir="ltr" className="font-mono">content-marketing-guide</span>.
                      </p>
                      <p className="mt-1">تغییر آدرس مقالهٔ منتشرشده پیشنهاد ثبت ریدایرکت می‌دهد.</p>
                    </ContextHint>
                  </div>
                </CardContent>
              </Card>

              {/* عملکرد محتوا — شاخص‌های معتبر */}
              {editingId && article ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
                      عملکرد محتوا
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">بازدید</span>
                      <span className="font-semibold tabular-nums">{toFa(article.views)}</span>
                    </div>
                    {article.publishedAt ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">تاریخ انتشار</span>
                          <span className="tabular-nums">{faDate(article.publishedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">میانگین بازدید روزانه</span>
                          <span className="tabular-nums">
                            {toFa(
                              Math.round(
                                article.views /
                                  Math.max(
                                    1,
                                    Math.ceil((Date.now() - new Date(article.publishedAt).getTime()) / 86400000)
                                  )
                              )
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">هنوز منتشر نشده است.</p>
                    )}
                    {article.versions && article.versions.length > 0 ? (
                      <div className="rounded-lg bg-muted/50 p-2.5 mt-1">
                        <p className="text-xs flex items-center gap-1.5">
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          آخرین تغییر مهم: <span className="font-medium">{article.versions[0].editorName}</span>
                          <span className="text-muted-foreground">· {timeAgo(article.versions[0].createdAt)}</span>
                        </p>
                        {article.versions[0].note ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{article.versions[0].note}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </TabsContent>

        {/* ─── تب سئو ─────────────────────────────────────────────── */}
        <TabsContent value="seo" className="mt-4">
          <div className="grid gap-4 max-w-2xl">
            <Field label="عنوان سئو" htmlFor="seo-title" hint="در نتایج موتورهای جست‌وجو نمایش داده می‌شود.">
              <div className="space-y-1">
                <Input
                  id="seo-title"
                  value={seoTitle}
                  onChange={(e) => {
                    setSeoTitle(e.target.value)
                    markDirty()
                  }}
                  disabled={readonly}
                  maxLength={200}
                />
                <p className={`text-xs tabular-nums ${seoTitle.length > 60 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {toFa(seoTitle.length)} / {toFa(60)} نویسه
                </p>
              </div>
            </Field>

            <Field label="توضیحات متا" htmlFor="seo-description" hint="خلاصه‌ای که در نتایج جست‌وجو زیر عنوان نمایش داده می‌شود.">
              <div className="space-y-1">
                <Textarea
                  id="seo-description"
                  rows={4}
                  value={seoDescription}
                  onChange={(e) => {
                    setSeoDescription(e.target.value)
                    markDirty()
                  }}
                  disabled={readonly}
                  maxLength={500}
                />
                <p
                  className={`text-xs tabular-nums ${
                    seoDescription.length > 160 ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {toFa(seoDescription.length)} / {toFa(160)} نویسه
                </p>
              </div>
            </Field>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
              <div>
                <Label htmlFor="noindex">ایندکس نشدن در موتورهای جست‌وجو</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  با فعال‌سازی این گزینه، موتورهای جست‌وجو از نمایش این مقاله در نتایج منع می‌شوند.
                </p>
              </div>
              <Switch
                id="noindex"
                checked={noindex}
                onCheckedChange={(v) => {
                  setNoindex(v)
                  markDirty()
                }}
                disabled={readonly}
              />
            </div>
          </div>
        </TabsContent>

        {/* ─── تب گفتگوها (همکاری در محل محتوا) ───────────────────── */}
        <TabsContent value="discussion" className="mt-4">
          {editingId ? (
            <div className="max-w-3xl">
              <ContentComments entityType="ARTICLE" entityId={editingId} />
            </div>
          ) : null}
        </TabsContent>

        {/* ─── تب نسخه‌ها ─────────────────────────────────────────── */}
        <TabsContent value="versions" className="mt-4">
          {!editingId ? null : versionsLoading && !versions ? (
            <LoadingSpinner label="در حال دریافت نسخه‌ها…" />
          ) : !versions || versions.length === 0 ? (
            <EmptyState
              compact
              title="هنوز نسخه‌ای ثبت نشده است"
              description="نسخه‌ها هنگام ویرایش مقالات منتشرشده یا تأییدشده به‌صورت خودکار ثبت می‌شوند."
            />
          ) : (
            <ul className="rounded-lg border divide-y">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{v.editorName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {faDateTime(v.createdAt)}
                      {v.note ? <span> · {v.note}</span> : null}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setViewVersion(v)}>
                      <Eye className="h-3.5 w-3.5" />
                      مشاهده
                    </Button>
                    {canRestoreVersions ? (
                      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setRestoreTarget(v)}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        بازگردانی
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ─── تب عملکرد ─────────────────────────────────────────── */}
        <TabsContent value="performance" className="mt-4">
          {editingId ? <ArticlePerformancePanel articleId={editingId} /> : null}
        </TabsContent>
      </Tabs>
      <MediaPickerDialog
        open={mediaPickerOpen}
        onOpenChange={setMediaPickerOpen}
        onSelect={(m) => {
          setCoverImageId(m.id)
          markDirty()
          toast.success('تصویر شاخص انتخاب شد.')
        }}
      />

      {/* تأیید انتقال‌های حساس (انتشار / لغو انتشار / بایگانی) */}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={confirmAction ? TRANSITION_LABELS[confirmAction] : ''}
        description={
          confirmAction === 'PUBLISH'
            ? 'مقاله برای همه بازدیدکنندگان سایت منتشر می‌شود.'
            : confirmAction === 'UNPUBLISH'
              ? 'مقاله از حالت انتشار خارج شده و به پیش‌نویس بازمی‌گردد.'
              : 'مقاله بایگانی می‌شود و از فهرست‌های عمومی حذف خواهد شد.'
        }
        confirmLabel={confirmAction ? TRANSITION_LABELS[confirmAction] : 'تأیید'}
        loading={transitioning}
        onConfirm={() => confirmAction && doTransition(confirmAction)}
      />

      {/* تعارض ویرایش هم‌زمان */}
      <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تعارض ویرایش هم‌زمان</AlertDialogTitle>
            <AlertDialogDescription>
              این مقاله پس از باز شدن شما توسط شخص دیگری ویرایش شده است.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setConflictOpen(false)
                if (editingId) load(editingId)
              }}
            >
              بارگیری نسخه سرور
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void save({ skipBase: true })
              }}
            >
              ذخیره با نسخه من
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* گارد تغییر آدرس محتوای منتشرشده (۴۰۹ تغییر اسلاگ) */}
      <AlertDialog
        open={!!slugGuard}
        onOpenChange={(o) => {
          if (!o && !saving) setSlugGuard(null)
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تغییر آدرس محتوای منتشرشده</AlertDialogTitle>
            <AlertDialogDescription>
              آدرس این محتوای منتشرشده تغییر می‌کند. پیوند‌های قدیمی ممکن است بشکنند.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {slugGuard ? (
            <div
              dir="ltr"
              className="truncate rounded-lg border bg-muted/40 px-3 py-2 text-center font-mono text-sm"
            >
              {slugGuard.oldSlug} <span className="text-muted-foreground" aria-hidden>→</span> {slugGuard.newSlug}
            </div>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={slugRegisterRedirect}
              onCheckedChange={(v) => setSlugRegisterRedirect(v === true)}
              disabled={saving}
              aria-label="ثبت ریدایرکت از آدرس قبلی"
            />
            ثبت ریدایرکت از آدرس قبلی
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault()
                void confirmSlugSave(false)
              }}
            >
              {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              ذخیره بدون ریدایرکت
            </AlertDialogAction>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault()
                void confirmSlugSave(true)
              }}
            >
              {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              ذخیره با ریدایرکت
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* مشاهده نسخه */}
      <Dialog open={!!viewVersion} onOpenChange={(o) => !o && setViewVersion(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle>{viewVersion?.title}</DialogTitle>
            <DialogDescription>
              {viewVersion ? `${viewVersion.editorName} · ${faDateTime(viewVersion.createdAt)}` : ''}
              {viewVersion?.note ? ` · ${viewVersion.note}` : ''}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 rounded-md border p-4">
            {viewVersion?.excerpt ? (
              <p className="text-sm text-muted-foreground mb-3 pb-3 border-b">{viewVersion.excerpt}</p>
            ) : null}
            <div className="md-preview">
              <ReactMarkdown>{viewVersion?.content ?? ''}</ReactMarkdown>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* بازگردانی نسخه */}
      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="بازگردانی نسخه"
        description="نسخه فعلی به‌صورت خودکار ثبت و نسخه انتخابی بازیابی می‌شود."
        confirmLabel="بازگردانی"
        loading={restoring}
        onConfirm={doRestore}
      />

      {/* ثبت دلیل نادیده گرفتن مورد واژه‌نامه — دلیل الزامی و مسئول ثبت می‌شود */}
      <Dialog open={!!ignoreTarget} onOpenChange={(o) => !o && setIgnoreTarget(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>نادیده گرفتن مورد واژه‌نامه</DialogTitle>
            <DialogDescription>
              {ignoreTarget
                ? `مورد «${ignoreTarget.observed}» در ${GLOSSARY_FIELD_LABELS[ignoreTarget.field]} فقط برای همین مقاله نادیده گرفته می‌شود؛ هشدار برای سایر مقالات باقی می‌ماند و ثبت دلیل الزامی است.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <Field label="دلیل نادیده گرفتن (الزامی)" htmlFor="glossary-ignore-reason">
            <Textarea
              id="glossary-ignore-reason"
              rows={3}
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              placeholder="مثلاً: این عبارت داخل نقل‌قول تاریخی است و نباید تغییر کند."
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreTarget(null)} disabled={ignoring}>
              انصراف
            </Button>
            <Button onClick={submitGlossaryIgnore} disabled={ignoring || ignoreReason.trim().length < 5}>
              {ignoring ? <Loader2 className="h-4 w-4 animate-spin me-1.5" aria-hidden /> : null}
              ثبت نادیده گرفتن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
