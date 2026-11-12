'use client'

import * as React from 'react'
import {
  ChevronDown,
  FilePlus2,
  History,
  Info,
  LayoutTemplate,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingSpinner,
  PageHeader,
  SearchInput,
  StatusBadge,
} from '@/components/shared/ui-bits'
import { apiGet, apiPost, apiDelete } from '@/lib/client/api'
import { toFa, timeAgo, faDate } from '@/lib/client/format'
import { navigate } from '@/hooks/use-hash-route'
import { useCan } from '@/store/app-store'

/**
 * کمک‌تابع محلی برای endpointهایی که فقط PATCH را می‌پذیرند
 * (کتابخانه api کلاینت متد PATCH ندارد) — با همان قرارداد خطای فارسی
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
    throw new Error(b.error || 'خطای غیرمنتظره در ارتباط با سرور.')
  }
  return res.json() as Promise<T>
}

// ─── انواع داده ──────────────────────────────────────────────────

type TemplateType = 'ARTICLE' | 'LANDING'
type StructureKind = 'FIELD' | 'BLOCK'

type StructureRow = {
  key: string
  label: string
  kind: StructureKind
  required: boolean
  guide: string
}

type ContentTemplate = {
  id: string
  name: string
  description: string
  type: TemplateType
  titleTemplate: string
  excerptTemplate: string
  contentTemplate: string
  structure: string
  guideText: string
  checklist: string
  tagNames: string
  categoryId: string | null
  isActive: boolean
  version: number
  isSystem: boolean
  createdByName: string | null
  createdAt: string
  updatedAt: string
  parsedStructure?: StructureRow[]
  parsedChecklist?: string[]
  parsedTagNames?: string[]
  articlesCount?: number
  _count?: { articles?: number }
}

type TemplateVersionRow = {
  id: string
  version: number
  name: string
  type: string
  changeNote: string
  createdByName: string
  createdAt: string
}

type TemplatesDetailResponse = {
  template: ContentTemplate
  versions: TemplateVersionRow[]
  usedByCount: number
}

type CategoryOption = { id: string; name: string }

// ─── ظاهر نشان‌ها (پالت اسلیت/کهربایی/زمرد/سرخ/بنفش) ─────────────

const TYPE_META: Record<TemplateType, { label: string; colorClass: string; bgClass: string }> = {
  ARTICLE: {
    label: 'مقاله',
    colorClass: 'text-warning',
    bgClass: 'bg-warning/10',
  },
  LANDING: {
    label: 'صفحه فرود',
    colorClass: 'text-info',
    bgClass: 'bg-info/10',
  },
}

const ACTIVE_META = {
  colorClass: 'text-success',
  bgClass: 'bg-success/10',
}

const INACTIVE_META = {
  colorClass: 'text-muted-foreground',
  bgClass: 'bg-muted',
}

const KIND_META: Record<StructureKind, { label: string; colorClass: string; bgClass: string }> = {
  FIELD: { label: 'فیلد', colorClass: 'text-muted-foreground', bgClass: 'bg-muted' },
  BLOCK: {
    label: 'بلوک',
    colorClass: 'text-info',
    bgClass: 'bg-info/10',
  },
}

// ─── تجزیه امن فیلدهای JSON ──────────────────────────────────────

function parseStructureJson(json: string): StructureRow[] {
  if (!json || !json.trim()) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is StructureRow => !!r && typeof r === 'object' && typeof (r as StructureRow).label === 'string')
      .map((r, i) => ({
        key: typeof r.key === 'string' && r.key ? r.key : `item-${i + 1}`,
        label: r.label,
        kind: r.kind === 'BLOCK' ? 'BLOCK' : 'FIELD',
        required: r.required === true,
        guide: typeof r.guide === 'string' ? r.guide : '',
      }))
  } catch {
    return []
  }
}

function parseStringListJson(json: string): string[] {
  if (!json || !json.trim()) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
  } catch {
    return []
  }
}

/** ساختار تجزیه‌شده (با اتکا به فیلد parsed سرور و بازگشت به تجزیه محلی) */
function tplStructure(t: ContentTemplate): StructureRow[] {
  if (Array.isArray(t.parsedStructure)) return t.parsedStructure
  return parseStructureJson(t.structure)
}

function tplChecklist(t: ContentTemplate): string[] {
  if (Array.isArray(t.parsedChecklist)) return t.parsedChecklist
  return parseStringListJson(t.checklist)
}

function tplTags(t: ContentTemplate): string[] {
  if (Array.isArray(t.parsedTagNames)) return t.parsedTagNames
  return parseStringListJson(t.tagNames)
}

/** تعداد محتوای ساخته‌شده از الگو — بر اساس شمارش سرور */
function usageCount(t: ContentTemplate): number {
  if (typeof t.articlesCount === 'number') return t.articlesCount
  return t._count?.articles ?? 0
}

/** دکمه با راهنمای شناور (برای وضعیت‌های غیرفعال که دلیلشان باید دیده شود) */
function HintWrap({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default">{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-56 text-center leading-5">{hint}</TooltipContent>
    </Tooltip>
  )
}

// ─── فرم ایجاد/ویرایش الگو ───────────────────────────────────────

type StructureFormRow = { label: string; kind: StructureKind; required: boolean; guide: string }

type TemplateFormCore = {
  name: string
  description: string
  type: TemplateType
  titleTemplate: string
  excerptTemplate: string
  contentTemplate: string
  guideText: string
  structure: StructureFormRow[]
  checklist: string[]
  tags: string[]
  categoryId: string // مقدار «none» یعنی بدون دسته‌بندی
}

type FormErrors = {
  name?: string
  title?: string
  content?: string
  structure?: string
  changeNote?: string
}

const PLACEHOLDER_HINT = 'جای‌نگهدارها مثل [[عنوان را وارد کنید]] تا جایگزین نشوند، مانع انتشار می‌شوند.'

export function TemplatesView() {
  const can = useCan()
  const canManage = can('articles.review')
  const canCreateContent = can('articles.create')

  const [items, setItems] = React.useState<ContentTemplate[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // فیلترها (سمت کلاینت — فهرست الگوها حجم بالایی ندارد)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all')

  // گفت‌وگوی ایجاد/ویرایش
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ContentTemplate | null>(null)
  const [form, setForm] = React.useState<TemplateFormCore>({
    name: '',
    description: '',
    type: 'ARTICLE',
    titleTemplate: '',
    excerptTemplate: '',
    contentTemplate: '',
    guideText: '',
    structure: [],
    checklist: [],
    tags: [],
    categoryId: 'none',
  })
  const [changeNote, setChangeNote] = React.useState('')
  const [errors, setErrors] = React.useState<FormErrors>({})
  const [saving, setSaving] = React.useState(false)
  const [categories, setCategories] = React.useState<CategoryOption[]>([])
  const [tagDraft, setTagDraft] = React.useState('')

  // عکس فیلدهای الگوی اصلی برای تشخیص «تغییر اثرگذار» (نیازمند شرح تغییر)
  const originalRef = React.useRef<TemplateFormCore | null>(null)

  // ساخت محتوا از الگو
  const [creatingContentId, setCreatingContentId] = React.useState<string | null>(null)

  // تغییر وضعیت فعال/غیرفعال
  const [togglingId, setTogglingId] = React.useState<string | null>(null)

  // حذف الگو
  const [deleteTarget, setDeleteTarget] = React.useState<ContentTemplate | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // گفت‌وگوی نسخه‌ها
  const [versionsOpen, setVersionsOpen] = React.useState(false)
  const [versionsTarget, setVersionsTarget] = React.useState<ContentTemplate | null>(null)
  const [versionsData, setVersionsData] = React.useState<(TemplatesDetailResponse & { id: string }) | null>(null)
  const [versionsLoading, setVersionsLoading] = React.useState(false)
  const [versionsError, setVersionsError] = React.useState<string | null>(null)
  const [versionsPreviewOpen, setVersionsPreviewOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<{ items: ContentTemplate[] }>('/api/templates')
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت الگوها')
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const loadCategories = React.useCallback(async () => {
    try {
      const res = await apiGet<CategoryOption[]>('/api/categories')
      setCategories(res)
    } catch {
      /* دسته‌بندی اختیاری است؛ خطای بارگذاری آن نادیده گرفته می‌شود */
    }
  }, [])

  // ─── تشخیص تغییر اثرگذار (فیلدهایی که نسخه جدید می‌سازند) ─────
  const contentChanged = React.useMemo(() => {
    if (!editing || !originalRef.current) return false
    return JSON.stringify(form) !== JSON.stringify(originalRef.current)
  }, [form, editing])

  const openCreate = () => {
    setEditing(null)
    setForm({
      name: '',
      description: '',
      type: 'ARTICLE',
      titleTemplate: '',
      excerptTemplate: '',
      contentTemplate: '',
      guideText: '',
      structure: [],
      checklist: [],
      tags: [],
      categoryId: 'none',
    })
    originalRef.current = null
    setChangeNote('')
    setErrors({})
    setTagDraft('')
    setDialogOpen(true)
    loadCategories()
  }

  const openEdit = (t: ContentTemplate) => {
    setEditing(t)
    const core: TemplateFormCore = {
      name: t.name,
      description: t.description ?? '',
      type: t.type,
      titleTemplate: t.titleTemplate,
      excerptTemplate: t.excerptTemplate ?? '',
      contentTemplate: t.contentTemplate,
      guideText: t.guideText ?? '',
      structure: tplStructure(t).map((r) => ({
        label: r.label,
        kind: r.kind === 'BLOCK' ? 'BLOCK' : 'FIELD',
        required: r.required === true,
        guide: r.guide ?? '',
      })),
      checklist: tplChecklist(t),
      tags: tplTags(t),
      categoryId: t.categoryId ?? 'none',
    }
    setForm({ ...core })
    originalRef.current = core
    setChangeNote('')
    setErrors({})
    setTagDraft('')
    setDialogOpen(true)
    loadCategories()
  }

  // ─── ویرایشگر ساختار الگو ────────────────────────────────────────
  const updateStructureRow = (index: number, patch: Partial<StructureFormRow>) => {
    setForm((f) => ({
      ...f,
      structure: f.structure.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }))
  }
  const addStructureRow = () => {
    setForm((f) => ({ ...f, structure: [...f.structure, { label: '', kind: 'FIELD', required: false, guide: '' }] }))
  }
  const removeStructureRow = (index: number) => {
    setForm((f) => ({ ...f, structure: f.structure.filter((_, i) => i !== index) }))
  }

  // ─── ویرایشگر چک‌لیست تکمیل ─────────────────────────────────────
  const updateChecklistItem = (index: number, value: string) => {
    setForm((f) => ({ ...f, checklist: f.checklist.map((c, i) => (i === index ? value : c)) }))
  }
  const addChecklistItem = () => {
    setForm((f) => ({ ...f, checklist: [...f.checklist, ''] }))
  }
  const removeChecklistItem = (index: number) => {
    setForm((f) => ({ ...f, checklist: f.checklist.filter((_, i) => i !== index) }))
  }

  // ─── برچسب‌ها (تراشه) ────────────────────────────────────────────
  const commitTag = (raw: string) => {
    // ورودی می‌تواند چند برچسب با ویرگول باشد (مثلاً هنگام چسباندن متن)
    const parts = raw.split(/[,،]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) return
    let tags = form.tags
    for (const value of parts) {
      if (tags.length >= 10) {
        toast.error('برچسب‌های الگو حداکثر می‌توانند ۱۰ مورد باشند.')
        break
      }
      if (!tags.includes(value)) tags = [...tags, value]
    }
    if (tags !== form.tags) setForm((f) => ({ ...f, tags }))
    setTagDraft('')
  }
  const removeTag = (tag: string) => {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))
  }

  // ─── ذخیره الگو (ایجاد با POST / ویرایش با PATCH) ─────────────
  const save = async () => {
    const errs: FormErrors = {}
    if (form.name.trim().length < 3) errs.name = 'نام الگو باید حداقل ۳ نویسه باشد.'
    if (form.titleTemplate.trim().length < 3) errs.title = 'عنوان الگو باید حداقل ۳ نویسه باشد.'
    if (form.contentTemplate.trim().length < 10) errs.content = 'محتوای الگو باید حداقل ۱۰ نویسه باشد.'
    if (form.structure.some((r) => r.label.trim() === ''))
      errs.structure = 'برچسب همه سطرهای ساختار را وارد کنید یا سطر خالی را حذف کنید.'
    if (editing && contentChanged && changeNote.trim().length < 3)
      errs.changeNote = 'برای تغییر اثرگذار، شرح تغییر (حداقل ۳ نویسه) الزامی است.'
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        type: form.type,
        titleTemplate: form.titleTemplate.trim(),
        excerptTemplate: form.excerptTemplate.trim(),
        contentTemplate: form.contentTemplate,
        guideText: form.guideText.trim(),
        structure: form.structure.map((r) => ({
          label: r.label.trim(),
          kind: r.kind,
          required: r.required,
          guide: r.guide.trim(),
        })),
        checklist: form.checklist.map((c) => c.trim()).filter((c) => c !== ''),
        tagNames: form.tags,
        categoryId: form.categoryId === 'none' ? null : form.categoryId,
      }
      if (editing) {
        // ویرایش بدون تغییر اثرگذار در دکمه ذخیره غیرفعال می‌شود؛ این گارد صرفاً محافظتی است
        if (!contentChanged) {
          setDialogOpen(false)
          toast.info('تغییری برای ذخیره وجود نداشت.')
          return
        }
        payload.changeNote = changeNote.trim()
        await apiPatch<ContentTemplate>(`/api/templates/${editing.id}`, payload)
        toast.success('الگو ویرایش شد و نسخه جدید ثبت شد.')
      } else {
        await apiPost<ContentTemplate>('/api/templates', payload)
        toast.success('الگو ایجاد شد (نسخه ۱).')
      }
      setDialogOpen(false)
      load()
    } catch (e) {
      // پیام فارسی سرور (مثل کوتاه بودن شرح تغییر) مستقیماً نمایش داده می‌شود
      toast.error(e instanceof Error ? e.message : 'ذخیره الگو ناموفق بود.')
    } finally {
      setSaving(false)
    }
  }

  // ─── فعال/غیرفعال‌سازی (بدون تغییر نسخه) ────────────────────────
  const toggleActive = async (t: ContentTemplate) => {
    const next = !t.isActive
    setTogglingId(t.id)
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: next } : x)))
    try {
      await apiPost<ContentTemplate>(`/api/templates/${t.id}`, { action: next ? 'ACTIVATE' : 'DEACTIVATE' })
      toast.success(
        next
          ? 'الگو فعال شد و برای ساخت محتوای جدید قابل انتخاب است.'
          : 'الگو غیرفعال شد و برای ساخت محتوای جدید قابل انتخاب نیست.'
      )
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: !next } : x)))
      toast.error(e instanceof Error ? e.message : 'تغییر وضعیت الگو ناموفق بود.')
    } finally {
      setTogglingId(null)
    }
  }

  // ─── ساخت محتوا از الگو (پیش‌نویس مستقل) ────────────────────────
  const createContent = async (t: ContentTemplate) => {
    setCreatingContentId(t.id)
    try {
      const created = await apiPost<{ id: string; title: string; slug: string }>('/api/templates/create-content', {
        templateId: t.id,
      })
      toast.success(`پیش‌نویس «${created.title}» از الگوی «${t.name}» ساخته شد.`)
      navigate(`/articles/${created.id}/edit`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ساخت محتوا از الگو ناموفق بود.')
    } finally {
      setCreatingContentId(null)
    }
  }

  // ─── حذف الگو (فقط وقتی هیچ محتوایی از آن ساخته نشده باشد) ────
  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/templates/${deleteTarget.id}`)
      toast.success('الگو حذف شد.')
      setDeleteTarget(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف الگو ناموفق بود.')
    } finally {
      setDeleting(false)
    }
  }

  // ─── نسخه‌ها ─────────────────────────────────────────────────────
  const openVersions = (t: ContentTemplate) => {
    setVersionsTarget(t)
    setVersionsData(null)
    setVersionsError(null)
    setVersionsPreviewOpen(false)
    setVersionsOpen(true)
    loadVersions(t.id)
  }

  const loadVersions = async (id: string) => {
    setVersionsLoading(true)
    setVersionsError(null)
    try {
      const res = await apiGet<TemplatesDetailResponse>(`/api/templates/${id}`)
      setVersionsData({ ...res, id })
    } catch (e) {
      setVersionsError(e instanceof Error ? e.message : 'خطا در دریافت نسخه‌های الگو')
    } finally {
      setVersionsLoading(false)
    }
  }

  // ─── فیلتر فهرست ────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((t) => {
      if (statusFilter === 'active' && !t.isActive) return false
      if (statusFilter === 'inactive' && t.isActive) return false
      if (q) {
        const haystack = `${t.name} ${t.description} ${t.titleTemplate} ${tplTags(t).join(' ')} ${t.createdByName ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [items, search, statusFilter])

  const activeCount = items.filter((t) => t.isActive).length
  const inactiveCount = items.length - activeCount

  if (!loaded && loading) return <LoadingSpinner label="در حال بارگذاری الگوها…" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="الگوهای آماده"
        description="الگوهای تأییدشده تیم — محتوای جدید به‌جای شروع از صفر، از روی همین الگوها ساخته می‌شود"
        icon={<LayoutTemplate className="h-5 w-5" />}
        actions={
          canManage ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              الگوی جدید
            </Button>
          ) : null
        }
      />

      {/* راهنمای جای‌نگهدارها */}
      <Alert className="rounded-2xl">
        <Info className="h-4 w-4" />
        <AlertDescription>
          جای‌نگهدارها با دو کروشه نوشته می‌شوند؛ مانند [[عنوان را وارد کنید]]. این متن‌های راهنما هنگام ساخت محتوا
          عمداً حفظ می‌شوند و تا جایگزین‌شدن، انتشار محتوا مسدود است.
        </AlertDescription>
      </Alert>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          title="الگویی ثبت نشده است"
          description={
            canManage
              ? 'اولین الگو را بسازید تا نویسنده‌ها به‌جای شروع از صفر، از الگوی آماده شروع کنند.'
              : 'هنوز الگویی برای ساخت محتوا ثبت نشده است.'
          }
          action={
            canManage ? (
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="h-4 w-4" />
                الگوی جدید
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* خلاصه وضعیت و فیلترها */}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {toFa(items.length)} الگو · {toFa(activeCount)} فعال · {toFa(inactiveCount)} غیرفعال
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="جست‌وجو در الگوها…"
                className="sm:w-64"
              />
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'inactive')}>
                <SelectTrigger className="sm:w-36" aria-label="فیلتر وضعیت الگو">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه</SelectItem>
                  <SelectItem value="active">فعال</SelectItem>
                  <SelectItem value="inactive">غیرفعال</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              compact
              title="موردی مطابق فیلترها یافت نشد"
              description="عبارت جست‌وجو یا فیلتر وضعیت را تغییر دهید."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((t) => {
                const meta = TYPE_META[t.type] ?? TYPE_META.ARTICLE
                const usage = usageCount(t)
                const usageInUse = usage > 0
                const canEditThis = !t.isSystem || can('settings.manage')
                const editHint = t.isSystem && !can('settings.manage') ? 'الگوهای سیستمی فقط توسط مدیر کل قابل ویرایش هستند.' : ''
                const deleteHint = usageInUse
                  ? 'الگو در حال استفاده است؛ فقط می‌توانید آن را غیرفعال کنید.'
                  : t.isSystem && !can('settings.manage')
                    ? 'الگوهای سیستمی فقط توسط مدیر کل قابل حذف هستند.'
                    : ''
                const tags = tplTags(t)

                return (
                  <article key={t.id} className="rounded-2xl border bg-card p-4 flex flex-col gap-3 shadow-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold" dir="auto">
                        {t.name}
                      </h3>
                      <StatusBadge label={meta.label} colorClass={meta.colorClass} bgClass={meta.bgClass} />
                      <Badge variant="outline" className="text-xs font-normal">
                        نسخه {toFa(t.version)}
                      </Badge>
                      <StatusBadge
                        label={t.isActive ? 'فعال' : 'غیرفعال'}
                        colorClass={t.isActive ? ACTIVE_META.colorClass : INACTIVE_META.colorClass}
                        bgClass={t.isActive ? ACTIVE_META.bgClass : INACTIVE_META.bgClass}
                      />
                      {t.isSystem ? <Badge variant="secondary">سیستمی</Badge> : null}
                    </div>

                    {t.description ? (
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-6" dir="auto">
                        {t.description}
                      </p>
                    ) : null}

                    {tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="font-normal text-[11px]" dir="auto">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    <p className="text-xs text-muted-foreground mt-auto">
                      {toFa(usage)} محتوا ساخته‌شده
                      {t.createdByName ? ` · ${t.createdByName}` : ''} · آخرین تغییر {timeAgo(t.updatedAt)}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      {canCreateContent ? (
                        !t.isActive ? (
                          <HintWrap hint="الگوی غیرفعال برای ساخت محتوای جدید قابل انتخاب نیست.">
                            <Button size="sm" disabled className="gap-1.5">
                              <FilePlus2 className="h-4 w-4" />
                              ساخت محتوا با این الگو
                            </Button>
                          </HintWrap>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => createContent(t)}
                            disabled={creatingContentId === t.id}
                            className="gap-1.5"
                            aria-label={`ساخت محتوا با این الگو: ${t.name}`}
                          >
                            {creatingContentId === t.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FilePlus2 className="h-4 w-4" />
                            )}
                            ساخت محتوا با این الگو
                          </Button>
                        )
                      ) : null}

                      <div className="ms-auto flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openVersions(t)}
                          aria-label={`نسخه‌های الگوی ${t.name}`}
                          title="نسخه‌ها"
                        >
                          <History className="h-4 w-4" />
                        </Button>

                        {canManage ? (
                          <>
                            {editHint ? (
                              <HintWrap hint={editHint}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  disabled
                                  aria-label={`ویرایش الگوی ${t.name}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </HintWrap>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEdit(t)}
                                aria-label={`ویرایش الگوی ${t.name}`}
                                title="ویرایش"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}

                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                              <Switch
                                checked={t.isActive}
                                disabled={togglingId === t.id}
                                onCheckedChange={() => toggleActive(t)}
                                aria-label={`فعال یا غیرفعال کردن الگوی ${t.name}`}
                              />
                              {t.isActive ? 'فعال' : 'غیرفعال'}
                            </label>

                            {deleteHint ? (
                              <HintWrap hint={deleteHint}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  disabled
                                  aria-label={`حذف الگوی ${t.name}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </HintWrap>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(t)}
                                aria-label={`حذف الگوی ${t.name}`}
                                title="حذف"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* گفت‌وگوی ایجاد/ویرایش الگو */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش الگو' : 'الگوی جدید'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'تغییر فیلدهای اثرگذار، نسخه جدیدی از الگو ثبت می‌کند؛ نسخه‌های پیشین در سابقه نسخه‌ها حفظ می‌شوند.'
                : 'متن‌ها و ساختار پیش‌فرضی که محتوای جدید از روی آن‌ها ساخته می‌شود را تعیین کنید.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <Field label="نام الگو" required htmlFor="tpl-name" error={errors.name}>
              <Input
                id="tpl-name"
                dir="auto"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثلاً: قالب مقاله آموزشی"
                maxLength={120}
              />
            </Field>

            <Field label="توضیح" htmlFor="tpl-description" hint="کاربرد این الگو برای نویسنده‌ها (اختیاری).">
              <Input
                id="tpl-description"
                dir="auto"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="توضیح کوتاه درباره کاربرد الگو…"
                maxLength={300}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="نوع الگو" htmlFor="tpl-type">
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as TemplateType }))}
                >
                  <SelectTrigger id="tpl-type" className="w-full" aria-label="نوع الگو">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARTICLE">مقاله</SelectItem>
                    <SelectItem value="LANDING">صفحه فرود</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="دسته‌بندی پیش‌فرض" htmlFor="tpl-category" hint="هنگام ساخت محتوا کپی می‌شود (اختیاری).">
                <Select
                  value={form.categoryId}
                  onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                >
                  <SelectTrigger id="tpl-category" className="w-full" aria-label="دسته‌بندی پیش‌فرض الگو">
                    <SelectValue />
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
            </div>

            <Field label="عنوان پیش‌فرض" required htmlFor="tpl-title" hint={PLACEHOLDER_HINT} error={errors.title}>
              <Input
                id="tpl-title"
                dir="auto"
                value={form.titleTemplate}
                onChange={(e) => setForm((f) => ({ ...f, titleTemplate: e.target.value }))}
                placeholder="مثلاً: [[عنوان را وارد کنید]] — راهنمای گام‌به‌گام"
                maxLength={200}
              />
            </Field>

            <Field label="خلاصه پیش‌فرض" htmlFor="tpl-excerpt" hint={PLACEHOLDER_HINT}>
              <Textarea
                id="tpl-excerpt"
                rows={2}
                dir="auto"
                value={form.excerptTemplate}
                onChange={(e) => setForm((f) => ({ ...f, excerptTemplate: e.target.value }))}
                placeholder="خلاصه‌ای کوتاه که در فهرست‌ها نمایش داده می‌شود…"
                maxLength={500}
              />
            </Field>

            <Field
              label="محتوای الگو (Markdown)"
              required
              htmlFor="tpl-content"
              hint={`حداقل ۱۰ نویسه. ${PLACEHOLDER_HINT}`}
              error={errors.content}
            >
              <Textarea
                id="tpl-content"
                rows={10}
                dir="auto"
                className="font-mono text-xs"
                value={form.contentTemplate}
                onChange={(e) => setForm((f) => ({ ...f, contentTemplate: e.target.value }))}
                placeholder={'## مقدمه\n\n[[متن مقدمه را وارد کنید]]\n\n## نتیجه‌گیری'}
              />
            </Field>

            <Field
              label="متن راهنمای استفاده"
              htmlFor="tpl-guide"
              hint="راهنمای نگارش و نکات ویژه این الگو برای نویسنده (اختیاری)."
            >
              <Textarea
                id="tpl-guide"
                rows={3}
                dir="auto"
                value={form.guideText}
                onChange={(e) => setForm((f) => ({ ...f, guideText: e.target.value }))}
                placeholder="مثلاً: لحن رسمی، ارجاع به مستندات رسمی و ذکر نسخه محصول الزامی است."
                maxLength={5000}
              />
            </Field>

            {/* ویرایشگر ساختار: فیلدها و بلوک‌ها */}
            <Field
              label="ساختار الگو (فیلدها و بلوک‌ها)"
              hint="هر سطر یک فیلد یا بلوک محتوایی است که نویسنده باید تکمیل کند (حداکثر ۳۰ سطر)."
              error={errors.structure}
            >
              <div className="space-y-2">
                {form.structure.map((row, i) => (
                  <div key={i} className="rounded-xl border bg-muted/30 p-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        dir="auto"
                        value={row.label}
                        onChange={(e) => updateStructureRow(i, { label: e.target.value })}
                        placeholder={`برچسب سطر ${toFa(i + 1)} — مثلاً: مقدمه`}
                        className="h-8 min-w-40 flex-1"
                        maxLength={120}
                        aria-label={`برچسب سطر ${toFa(i + 1)} ساختار`}
                      />
                      <Select
                        value={row.kind}
                        onValueChange={(v) => updateStructureRow(i, { kind: v as StructureKind })}
                      >
                        <SelectTrigger
                          className="h-8 w-24 shrink-0"
                          aria-label={`نوع سطر ${toFa(i + 1)} ساختار`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FIELD">فیلد</SelectItem>
                          <SelectItem value="BLOCK">بلوک</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeStructureRow(i)}
                        aria-label={`حذف سطر ${toFa(i + 1)} ساختار`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          checked={row.required}
                          onCheckedChange={(v) => updateStructureRow(i, { required: v === true })}
                          aria-label={`الزامی بودن سطر ${toFa(i + 1)} ساختار`}
                        />
                        الزامی
                      </label>
                      <Input
                        dir="auto"
                        value={row.guide}
                        onChange={(e) => updateStructureRow(i, { guide: e.target.value })}
                        placeholder="راهنمای نویسنده برای این سطر (اختیاری)"
                        className="h-8 min-w-40 flex-1"
                        maxLength={300}
                        aria-label={`راهنمای سطر ${toFa(i + 1)} ساختار`}
                      />
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addStructureRow} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  افزودن آیتم
                </Button>
              </div>
            </Field>

            {/* ویرایشگر چک‌لیست تکمیل */}
            <Field
              label="چک‌لیست تکمیل"
              hint="نکاتی که پیش از انتشار محتوای ساخته‌شده باید بررسی شود (حداکثر ۲۰ آیتم)."
            >
              <div className="space-y-2">
                {form.checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{toFa(i + 1)}.</span>
                    <Input
                      dir="auto"
                      value={item}
                      onChange={(e) => updateChecklistItem(i, e.target.value)}
                      placeholder="مثلاً: آمارها به منبع معتبر ارجاع داده شده باشند"
                      className="h-8 flex-1"
                      maxLength={200}
                      aria-label={`آیتم ${toFa(i + 1)} چک‌لیست`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeChecklistItem(i)}
                      aria-label={`حذف آیتم ${toFa(i + 1)} چک‌لیست`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addChecklistItem} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  افزودن آیتم چک‌لیست
                </Button>
              </div>
            </Field>

            {/* برچسب‌های پیشنهادی */}
            <Field
              label="برچسب‌های پیشنهادی"
              hint="Enter یا ویرگول برای افزودن؛ هنگام ساخت محتوا فقط برچسب‌های هم‌نامِ موجود متصل می‌شوند (حداکثر ۱۰ مورد)."
            >
              <div className="rounded-xl border bg-background p-2.5 space-y-2">
                {form.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {form.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 font-normal" dir="auto">
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="rounded-sm hover:text-destructive"
                          aria-label={`حذف برچسب ${tag}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <Input
                  dir="auto"
                  value={tagDraft}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v.endsWith(',') || v.endsWith('،')) {
                      commitTag(v.slice(0, -1))
                    } else {
                      setTagDraft(v)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTag(tagDraft)
                    }
                  }}
                  onBlur={() => commitTag(tagDraft)}
                  placeholder="برچسب را بنویسید و Enter بزنید…"
                  aria-label="افزودن برچسب پیشنهادی"
                />
              </div>
            </Field>

            {/* شرح تغییر — فقط در ویرایش با تغییر اثرگذار */}
            {editing && contentChanged ? (
              <Field
                label="شرح تغییر"
                required
                htmlFor="tpl-change-note"
                hint="این توضیح همراه نسخه جدید در سابقه نسخه‌ها ثبت می‌شود (حداقل ۳ نویسه)."
                error={errors.changeNote}
              >
                <Input
                  id="tpl-change-note"
                  dir="auto"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="مثلاً: افزودن بلوک نتیجه‌گیری و اصلاح عنوان پیش‌فرض"
                  maxLength={300}
                />
              </Field>
            ) : null}
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-end">
            {editing && !contentChanged ? (
              <p className="text-xs text-muted-foreground me-auto">برای ذخیره، حداقل یکی از فیلدها را تغییر دهید.</p>
            ) : null}
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving || (!!editing && !contentChanged)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : null}
              {editing ? 'ذخیره و ثبت نسخه جدید' : 'ایجاد الگو'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* گفت‌وگوی سابقه نسخه‌ها */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>نسخه‌های الگوی «{versionsTarget?.name ?? ''}»</DialogTitle>
            <DialogDescription>
              {versionsData
                ? `${toFa(versionsData.usedByCount)} محتوا از این الگو ساخته شده است · نسخه فعلی: ${toFa(
                    versionsData.template.version
                  )}`
                : 'سابقه تغییرات ثبت‌شده الگو به‌ترتیب از جدیدترین نسخه.'}
            </DialogDescription>
          </DialogHeader>

          {versionsLoading ? (
            <LoadingSpinner label="در حال دریافت نسخه‌ها…" />
          ) : versionsError ? (
            <ErrorState message={versionsError} onRetry={() => versionsTarget && loadVersions(versionsTarget.id)} />
          ) : versionsData && versionsTarget && versionsData.id === versionsTarget.id ? (
            <div className="space-y-4 py-1">
              {/* پیش‌نمایش ساختار و چک‌لیست نسخه فعلی (سرور فقط شناسنامه نسخه‌ها را برمی‌گرداند) */}
              <Collapsible open={versionsPreviewOpen} onOpenChange={setVersionsPreviewOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full gap-2 justify-between">
                    پیش‌نمایش ساختار و چک‌لیست نسخه فعلی (نسخه {toFa(versionsData.template.version)})
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${versionsPreviewOpen ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 space-y-3 rounded-xl border bg-muted/30 p-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">بلوک‌ها و فیلدها</p>
                      {tplStructure(versionsData.template).length > 0 ? (
                        <ul className="space-y-1.5">
                          {tplStructure(versionsData.template).map((r, i) => {
                            const kind = KIND_META[r.kind] ?? KIND_META.FIELD
                            return (
                              <li key={r.key || i} className="flex flex-wrap items-center gap-2 text-sm">
                                <Badge
                                  variant="outline"
                                  className={`text-[11px] font-normal ${kind.colorClass} ${kind.bgClass}`}
                                >
                                  {kind.label}
                                </Badge>
                                <span className="font-medium" dir="auto">
                                  {r.label}
                                </span>
                                {r.required ? (
                                  <Badge variant="secondary" className="text-[10px] font-normal">
                                    الزامی
                                  </Badge>
                                ) : null}
                                {r.guide ? (
                                  <span className="text-xs text-muted-foreground" dir="auto">
                                    {r.guide}
                                  </span>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">ساختاری ثبت نشده است.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">چک‌لیست تکمیل</p>
                      {tplChecklist(versionsData.template).length > 0 ? (
                        <ol className="space-y-1">
                          {tplChecklist(versionsData.template).map((item, i) => (
                            <li key={i} className="flex gap-1.5 text-sm">
                              <span className="text-xs text-muted-foreground tabular-nums mt-0.5">
                                {toFa(i + 1)}.
                              </span>
                              <span dir="auto">{item}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-xs text-muted-foreground">چک‌لیستی ثبت نشده است.</p>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* فهرست نسخه‌ها (جدیدترین اول) */}
              {versionsData.versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">نسخه‌ای ثبت نشده است.</p>
              ) : (
                <ul className="space-y-2 max-h-80 overflow-y-auto">
                  {versionsData.versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-col gap-1 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="shrink-0">
                          نسخه {toFa(v.version)}
                        </Badge>
                        <span className="text-sm font-medium truncate" dir="auto" title={v.changeNote}>
                          {v.changeNote || 'بدون شرح تغییر'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                        {v.createdByName || '—'}، {faDate(v.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* تأیید حذف الگو */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف الگو"
        description={`حذف الگوی «${deleteTarget?.name ?? ''}». محتواهای ساخته‌شده از این الگو حذف نمی‌شوند و مبدأ آن‌ها حفظ می‌شود.`}
        confirmLabel="حذف الگو"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
