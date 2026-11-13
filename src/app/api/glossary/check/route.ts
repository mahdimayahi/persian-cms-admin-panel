/**
 * بررسی محتوا با قواعد فعال واژه‌نامه برند (فاز ۲)
 * POST /api/glossary/check — مجوز articles.view
 *
 * اصول:
 * - این بررسی فقط‌خواندنی است و هرگز متن محتوا را تغییر نمی‌دهد؛ اصلاح فقط با اقدام کاربر انجام می‌شود.
 * - استثناهای ثبت‌شده برای محتوا (با دلیل و مسئول) از نتیجه حذف می‌شوند و تعدادشان گزارش می‌شود.
 * - پاسخ شامل «مُهر نسخه قواعد» است تا مشخص باشد بررسی با کدام نسخه از قواعد انجام شده است.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requirePermission, parseBody } from '@/lib/api-utils'
import {
  checkFieldsWithRules,
  GLOSSARY_FIELD_LABELS,
  type GlossaryRuleInput,
  type GlossaryFieldType,
  type GlossaryExceptionInput,
} from '@/lib/glossary-check'

/** خواندن امن فیلد forms (JSON) از رکورد قاعده */
function safeParseForms(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f): f is string => typeof f === 'string' && f.trim() !== '')
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('articles.view')
    const body = await parseBody<{ entityType?: unknown; entityId?: unknown; fields?: unknown }>(req)

    // ── اعتبارسنجی فیلدهای متنی ────────────────────────────────────
    if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
      throw new ApiError(400, 'فیلدهای متنی برای بررسی الزامی است.')
    }
    const rawFields = body.fields as Record<string, unknown>
    const fields: Partial<Record<GlossaryFieldType, string>> = {}
    for (const key of Object.keys(GLOSSARY_FIELD_LABELS) as GlossaryFieldType[]) {
      const value = rawFields[key]
      if (value === undefined || value === null) continue
      if (typeof value !== 'string') throw new ApiError(400, `«${GLOSSARY_FIELD_LABELS[key]}» باید متن باشد.`)
      if (value.length > 200_000) throw new ApiError(400, `«${GLOSSARY_FIELD_LABELS[key]}» برای بررسی بیش از حد طولانی است.`)
      fields[key] = value
    }
    if (Object.keys(fields).length === 0) {
      throw new ApiError(400, 'حداقل یک فیلد متنی (عنوان، خلاصه، متن اصلی یا سئو) برای بررسی لازم است.')
    }

    // ── موجودیت هدف (در حال حاضر فقط مقاله) ────────────────────────
    const entityType =
      body.entityType === undefined || body.entityType === null || body.entityType === '' ? 'ARTICLE' : body.entityType
    if (entityType !== 'ARTICLE') throw new ApiError(400, 'نوع موجودیت پشتیبانی‌شده «ARTICLE» است.')
    const entityId = typeof body.entityId === 'string' && body.entityId.trim() !== '' ? body.entityId.trim() : null

    // ── بارگذاری قواعد فعال ────────────────────────────────────────
    const activeRules = await db.glossaryTerm.findMany({ where: { isActive: true }, orderBy: { updatedAt: 'desc' } })
    const rules: GlossaryRuleInput[] = activeRules.map((r) => ({
      id: r.id,
      term: r.term,
      forms: safeParseForms(r.forms),
      preferred: r.preferred,
      type: r.type,
      severity: r.severity,
      scope: r.scope,
      language: r.language,
      explanation: r.explanation,
      example: r.example,
      isActive: r.isActive,
    }))
    // مُهر نسخه قواعد: تعداد قواعد فعال و آخرین زمان تغییر این مجموعه
    const lastUpdatedAt = activeRules.length > 0 ? activeRules[0].updatedAt.toISOString() : null

    // ── استثناهای ثبت‌شده برای این محتوا ───────────────────────────
    const exceptions: GlossaryExceptionInput[] = entityId
      ? (
          await db.glossaryException.findMany({
            where: { entityType: 'ARTICLE', entityId },
            select: { termId: true, field: true },
          })
        ).map((e) => ({ termId: e.termId, field: e.field }))
      : []

    // ── اجرای موتور بررسی ──────────────────────────────────────────
    // برای شمارش موارد نادیده‌گرفته‌شده، بررسی یک‌بار بدون استثنا و یک‌بار با استثنا انجام می‌شود.
    const dedupe = (list: ReturnType<typeof checkFieldsWithRules>) => {
      const seen = new Set<string>()
      return list.filter((f) => {
        // وقتی چند شکل از یک قاعده پس از عادی‌سازی یکسان می‌شوند، موتور همان مکان را چند بار گزارش می‌کند؛
        // موارد تکراری (قاعده × فیلد × مکان یکسان) حذف می‌شوند تا هر مورد فقط یک بار به ویرایشگر برسد.
        const key = `${f.ruleId}::${f.field}::${f.index}::${f.length}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    const allMatches = dedupe(checkFieldsWithRules(fields, rules, []))
    const findings = dedupe(exceptions.length > 0 ? checkFieldsWithRules(fields, rules, exceptions) : allMatches)
    const ignoredCount = allMatches.length - findings.length

    return ok({
      findings,
      ignoredCount,
      rulesStamp: {
        termsCount: rules.length,
        lastUpdatedAt,
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
