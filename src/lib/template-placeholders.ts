/**
 * تشخیص جای‌نگهدارهای ضروری الگو در محتوا
 *
 * محتوای ساخته‌شده از الگو، متن‌های راهنما/نمونه را به‌عنوان جای‌نگهدار به ارث می‌برد.
 * وجود جای‌نگهدار ضروری مانع انتشار می‌شود (محتوا هنوز تکمیل نشده است).
 * این بررسی مشترک است: ویرایشگر، انتقال وضعیت مقاله و بررسی آمادگی بسته انتشار.
 */

export type PlaceholderFieldType = 'TITLE' | 'EXCERPT' | 'CONTENT' | 'SEO_TITLE' | 'SEO_DESCRIPTION'

export const PLACEHOLDER_FIELD_LABELS: Record<PlaceholderFieldType, string> = {
  TITLE: 'عنوان',
  EXCERPT: 'خلاصه',
  CONTENT: 'متن اصلی',
  SEO_TITLE: 'عنوان سئو',
  SEO_DESCRIPTION: 'توضیحات سئو',
}

export interface PlaceholderFinding {
  field: PlaceholderFieldType
  /** متن جای‌نگهدار مشاهده‌شده */
  label: string
  index: number
  length: number
  snippet: string
}

/**
 * نشانه‌گذاری جای‌نگهدار: [[ ... ]] — مثال: [[عنوان را وارد کنید]]
 * و الگوهای متنی رایج متن نمونه که نباید منتشر شوند.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[\[\s*([^\][\n]{1,80}?)\s*\]\]/g, // [[ ... ]]
  /\[\s*([^\[\]{}]{2,60}?)\s*\](?!\()/g, // [ ... ] (بدون پرانتز — تا لینک مارک‌داون [متن](آدرس) اشتباه گرفته نشود)
  /«\s*عنوان را وارد کنید\s*»/g,
  /«\s*متن را وارد کنید\s*»/g,
  /«\s*خلاصه را وارد کنید\s*»/g,
  /«\s*متن نمونه\s*»/g,
  /LOREM\s+IPSUM/gi,
]

function buildSnippet(text: string, start: number, end: number, radius = 30): string {
  const s = Math.max(0, start - radius)
  const e = Math.min(text.length, end + radius)
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '')
}

/**
 * فهرست جای‌نگهدارهای یافت‌شده در فیلدهای داده‌شده.
 */
export function findPlaceholders(
  fields: Partial<Record<PlaceholderFieldType, string>>
): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = []
  for (const key of Object.keys(PLACEHOLDER_FIELD_LABELS) as PlaceholderFieldType[]) {
    const text = fields[key] ?? ''
    if (!text) continue
    // جلوگیری از شمارش دوباره: تطبیق‌های هم‌پوشان (مثل [[...]]) فقط یک‌بار ثبت می‌شوند
    const taken: { start: number; end: number }[] = []
    const isTaken = (start: number, end: number) =>
      taken.some((t) => start < t.end && t.start < end)
    for (const re of PLACEHOLDER_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const start = m.index
        const end = m.index + m[0].length
        if (!isTaken(start, end)) {
          const label = (m[1] ?? m[0]).trim()
          findings.push({
            field: key,
            label,
            index: start,
            length: end - start,
            snippet: buildSnippet(text, start, end),
          })
          taken.push({ start, end })
        }
        if (m[0].length === 0) re.lastIndex++
      }
    }
  }
  const fieldOrder: PlaceholderFieldType[] = ['TITLE', 'EXCERPT', 'CONTENT', 'SEO_TITLE', 'SEO_DESCRIPTION']
  findings.sort((a, b) => {
    const fd = fieldOrder.indexOf(a.field) - fieldOrder.indexOf(b.field)
    if (fd !== 0) return fd
    return a.index - b.index
  })
  return findings
}

/** آیا محتوا جای‌نگهدار ضروری دارد؟ (مانع انتشار) */
export function hasBlockingPlaceholders(
  fields: Partial<Record<PlaceholderFieldType, string>>
): boolean {
  return findPlaceholders(fields).length > 0
}

/** خلاصه شمارش جای‌نگهدارها بر اساس فیلد */
export function placeholderSummary(
  fields: Partial<Record<PlaceholderFieldType, string>>
): { field: PlaceholderFieldType; count: number }[] {
  const findings = findPlaceholders(fields)
  const byField = new Map<PlaceholderFieldType, number>()
  for (const f of findings) byField.set(f.field, (byField.get(f.field) ?? 0) + 1)
  return Array.from(byField.entries()).map(([field, count]) => ({ field, count }))
}
