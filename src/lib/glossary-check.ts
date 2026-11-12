/**
 * موتور بررسی واژه‌نامه برند — مشترک بین ویرایشگر محتوا و بررسی آمادگی بسته انتشار
 *
 * قواعد طراحی (مطابق مشخصات واژه‌نامه برند):
 * - تشخیص با عادی‌سازی انجام می‌شود، اما متن اصلی هرگز بازنویسی نمی‌شود؛ اصلاح فقط با اقدام کاربر.
 * - تفاوت «ی/ي» و «ک/ك» هنگام تطبیق نادیده گرفته می‌شود (هم‌ارز در نظر گرفته می‌شوند).
 * - فاصله و نیم‌فاصله هم‌ارز در نظر گرفته می‌شوند («می باشد» ≈ «می‌باشد»).
 * - تطبیق واژه کامل انجام می‌شود تا هشدار اشتباه برای بخشی از واژه دیگر صادر نشود.
 * - متن ترکیبی فارسی و انگلیسی پشتیبانی می‌شود (تطبیق بدون حساسیت به بزرگ/کوچکی لاتین).
 * - کد، URL و شناسه‌های فنی بررسی نمی‌شوند و اعداد آن‌ها تبدیل نمی‌شوند.
 */

export type GlossaryFieldType = 'TITLE' | 'EXCERPT' | 'CONTENT' | 'SEO_TITLE' | 'SEO_DESCRIPTION'

export const GLOSSARY_FIELD_LABELS: Record<GlossaryFieldType, string> = {
  TITLE: 'عنوان',
  EXCERPT: 'خلاصه',
  CONTENT: 'متن اصلی',
  SEO_TITLE: 'عنوان سئو',
  SEO_DESCRIPTION: 'توضیحات سئو',
}

export type GlossarySeverity = 'SUGGESTION' | 'WARNING' | 'ENFORCING'

/** ورودی قاعده (از رکورد GlossaryTerm ساخته می‌شود) */
export interface GlossaryRuleInput {
  id: string
  /** شکل اصلی نامطلوب/قابل‌بررسی */
  term: string
  /** سایر شکل‌های نامطلوب (از فیلد forms) */
  forms: string[]
  /** عبارت ترجیحی (پیشنهاد اصلاح) */
  preferred: string
  /** BRAND_TERM | BRAND_NAME | STYLE | CLARITY */
  type: string
  /** SUGGESTION | WARNING | ENFORCING */
  severity: string
  /** ALL | TITLE | BODY | SEO */
  scope: string
  language: string
  explanation: string
  example: string
  isActive: boolean
}

export interface GlossaryFinding {
  ruleId: string
  ruleType: string
  ruleTerm: string
  severity: GlossarySeverity
  field: GlossaryFieldType
  /** شکل مشاهده‌شده در متن */
  observed: string
  /** عبارت ترجیحی */
  preferred: string
  /** پیشنهاد اصلاح (متن جایگزین) */
  suggestion: string
  /** توضیح علت هشدار */
  reason: string
  example: string
  /** مکان شروع تطبیق در متن اصلی */
  index: number
  /** طول تطبیق در متن اصلی */
  length: number
  /** بافت متن اطراف تطبیق */
  snippet: string
}

export interface GlossaryExceptionInput {
  termId: string
  field: string
}

// ─── عادی‌سازی متن ──────────────────────────────────────────────

const CHAR_EQUIVALENTS: Record<string, string> = {
  '\u064A': '\u06CC', // ي عربی → ی فارسی
  '\u0643': '\u06A9', // ك عربی → ک فارسی
  '\u0623': '\u0627', // أ → ا
  '\u0625': '\u0627', // إ → ا
  '\u0671': '\u0627', // ٱ → ا
}

/** نویسه‌های جداکننده (فاصله، تب، خط جدید و نیم‌فاصله) که هم‌ارز در نظر گرفته می‌شوند */
const SEPARATORS = /[\s\u200C\u200E\u200F]/

interface NormalizedText {
  norm: string
  /** offsets[i] = اندیس نویسه اصلی متناظر با نویسه i متن عادی‌شده */
  offsets: number[]
}

function normalizeText(text: string): NormalizedText {
  const chars: string[] = []
  const offsets: number[] = []
  let lastWasSep = false
  for (let i = 0; i < text.length; i++) {
    let ch = text[i]
    // اعراب و کشیده: حذف
    if (/[\u064B-\u065F\u0670\u0640]/.test(ch)) continue
    ch = CHAR_EQUIVALENTS[ch] ?? ch
    ch = ch.toLowerCase()
    if (SEPARATORS.test(ch)) {
      if (!lastWasSep && chars.length > 0) {
        chars.push(' ')
        offsets.push(i)
        lastWasSep = true
      }
      continue
    }
    chars.push(ch)
    offsets.push(i)
    lastWasSep = false
  }
  return { norm: chars.join(''), offsets }
}

// ─── ناحیه‌های مستثنی (کد، URL، شناسه فنی) ───────────────────────

interface Zone {
  start: number
  end: number
}

function computeSkipZones(text: string): Zone[] {
  const zones: Zone[] = []
  const patterns: RegExp[] = [
    /```[\s\S]*?```/g, // بلوک کد
    /`[^`\n]+`/g, // کد درون‌خطی
    /https?:\/\/[^\s"'<>)\]]+/g, // URL
    /<code[\s\S]*?<\/code>/gi, // تگ code
    /<pre[\s\S]*?<\/pre>/gi, // تگ pre
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, // UUID
  ]
  for (const re of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      zones.push({ start: m.index, end: m.index + m[0].length })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return zones
}

function overlaps(zones: Zone[], start: number, end: number): boolean {
  return zones.some((z) => start < z.end && z.start < end)
}

// ─── تطبیق واژه کامل ─────────────────────────────────────────────

/** نویسه متعلق به کلمه (حرف یا رقم یا زیرخط) — برای بررسی مرز واژه */
function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false
  return /[\p{L}\p{N}_]/u.test(ch)
}

function buildSnippet(text: string, start: number, end: number, radius = 40): string {
  const s = Math.max(0, start - radius)
  const e = Math.min(text.length, end + radius)
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '')
}

function fieldsForScope(scope: string): GlossaryFieldType[] {
  if (scope === 'TITLE') return ['TITLE']
  if (scope === 'BODY') return ['CONTENT']
  if (scope === 'SEO') return ['SEO_TITLE', 'SEO_DESCRIPTION']
  return ['TITLE', 'EXCERPT', 'CONTENT', 'SEO_TITLE', 'SEO_DESCRIPTION']
}

function toSeverity(value: string): GlossarySeverity {
  return value === 'WARNING' || value === 'ENFORCING' ? value : 'SUGGESTION'
}

// ─── بررسی اصلی ──────────────────────────────────────────────────

/**
 * بررسی فیلدهای متنی با فهرست قواعد فعال واژه‌نامه.
 * خروجی: فهرست موارد مشاهده‌شده مرتب‌شده بر اساس فیلد و مکان.
 * exceptions: موارد نادیده‌گرفته‌شده ثبت‌شده برای این محتوا (با دلیل).
 */
export function checkFieldsWithRules(
  fields: Partial<Record<GlossaryFieldType, string>>,
  rules: GlossaryRuleInput[],
  exceptions: GlossaryExceptionInput[] = []
): GlossaryFinding[] {
  const findings: GlossaryFinding[] = []
  const activeRules = rules.filter((r) => r.isActive && (r.term.trim() !== '' || r.forms.length > 0))
  if (activeRules.length === 0) return findings

  // عادی‌سازی هر فیلد یک‌بار
  const normalizedFields = new Map<GlossaryFieldType, { text: string; norm: NormalizedText; zones: Zone[] }>()
  for (const key of Object.keys(GLOSSARY_FIELD_LABELS) as GlossaryFieldType[]) {
    const text = fields[key] ?? ''
    if (!text) continue
    normalizedFields.set(key, { text, norm: normalizeText(text), zones: computeSkipZones(text) })
  }

  const exceptionKeys = new Set(exceptions.map((e) => `${e.termId}::${e.field}`))

  for (const rule of activeRules) {
    // شکل‌های قابل تشخیص: term + forms
    const observedForms = [rule.term, ...rule.forms].map((f) => f.trim()).filter((f) => f !== '')
    if (observedForms.length === 0) continue

    for (const field of fieldsForScope(rule.scope)) {
      const nf = normalizedFields.get(field)
      if (!nf) continue
      const exceptionKey = `${rule.id}::${field}`
      if (exceptionKeys.has(exceptionKey)) continue // مورد نادیده‌گرفته‌شده با دلیل

      for (const form of observedForms) {
        const needle = normalizeText(form).norm
        if (!needle) continue
        let idx = nf.norm.norm.indexOf(needle)
        while (idx !== -1) {
          const normStart = idx
          const normEnd = idx + needle.length
          // مرز واژه: نویسه قبل و بعد در متن اصلی نباید حرف/رقم باشد
          const origStart = nf.norm.offsets[normStart]
          const origEndInclusive = nf.norm.offsets[normEnd - 1]
          const before = origStart > 0 ? nf.text[origStart - 1] : undefined
          const after = origEndInclusive + 1 < nf.text.length ? nf.text[origEndInclusive + 1] : undefined
          if (!isWordChar(before) && !isWordChar(after) && !overlaps(nf.zones, origStart, origEndInclusive + 1)) {
            findings.push({
              ruleId: rule.id,
              ruleType: rule.type,
              ruleTerm: rule.term,
              severity: toSeverity(rule.severity),
              field,
              observed: nf.text.slice(origStart, origEndInclusive + 1),
              preferred: rule.preferred,
              suggestion: rule.preferred || rule.explanation,
              reason: rule.explanation || rule.example || 'این عبارت با واژه‌نامه برند هماهنگ نیست.',
              example: rule.example,
              index: origStart,
              length: origEndInclusive + 1 - origStart,
              snippet: buildSnippet(nf.text, origStart, origEndInclusive + 1),
            })
          }
          idx = nf.norm.norm.indexOf(needle, normEnd)
        }
      }
    }
  }

  // مرتب‌سازی پایدار: فیلد → مکان
  const fieldOrder: GlossaryFieldType[] = ['TITLE', 'EXCERPT', 'CONTENT', 'SEO_TITLE', 'SEO_DESCRIPTION']
  findings.sort((a, b) => {
    const fd = fieldOrder.indexOf(a.field) - fieldOrder.indexOf(b.field)
    if (fd !== 0) return fd
    return a.index - b.index
  })
  return findings
}

/** اعمال اصلاح یک مورد مشخص روی متن اصلی (فقط با اقدام کاربر فراخوانی می‌شود) */
export function applyFixToText(text: string, index: number, length: number, replacement: string): string {
  if (index < 0 || index + length > text.length) return text
  return text.slice(0, index) + replacement + text.slice(index + length)
}

/** برچسب فارسی شدت قاعده */
export function severityLabel(severity: string): string {
  if (severity === 'ENFORCING') return 'الزام‌آور'
  if (severity === 'WARNING') return 'هشدار'
  return 'پیشنهاد'
}

/** برچسب فارسی نوع قاعده */
export function ruleTypeLabel(type: string): string {
  if (type === 'BRAND_TERM') return 'اصطلاح برند'
  if (type === 'BRAND_NAME') return 'نام برند'
  if (type === 'CLARITY') return 'وضوح محتوا'
  return 'سبک نگارش'
}
