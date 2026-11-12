/**
 * ادغام امن موارد تکراری (با تأیید انسان) — فاز ۳
 * POST /api/duplicates/merge — بدنه:
 * { type: 'tag'|'category', sourceId, targetId, fieldChoices?: { name?, description? }, registerRedirect?: boolean, notes?: string }
 *
 * sourceId = رکورد ادغام‌شونده (قدیمی) — حذف فیزیکی نمی‌شود؛ با mergedIntoId به مقصد نشانه‌گذاری می‌شود.
 * targetId = رکورد مقصد (باقی‌مانده). روابط به مقصد منتقل و کل عملیات در تاریخچه و DataMergeLog ثبت می‌گردد.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ApiError,
  ok,
  handleApiError,
  requireAuth,
  parseBody,
  vEnum,
  vString,
  vBoolean,
} from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

interface MergeBody {
  type?: unknown
  sourceId?: unknown
  targetId?: unknown
  fieldChoices?: unknown
  registerRedirect?: unknown
  notes?: unknown
}

/** مقدار نهایی انتخاب‌شدهٔ فیلدها برای ثبت در گزارش ادغام */
interface AppliedChoices {
  name?: string
  description?: string | null
}

/** خروجی مشترک هر دو نوع ادغام */
interface MergeResult {
  relationCount: number
  redirectCreated: boolean
  sourceName: string
  targetName: string
  finalTargetName: string
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<MergeBody>(req)
    const type = vEnum<'tag' | 'category'>(body.type, ['tag', 'category'] as const, 'نوع')
    const sourceId = vString(body.sourceId, 'رکورد ادغام‌شونده', { required: true, max: 100 })
    const targetId = vString(body.targetId, 'رکورد مقصد', { required: true, max: 100 })

    if (sourceId === targetId) throw new ApiError(400, 'رکورد مبدأ و مقصد نباید یکی باشند.')

    // مجوز بر اساس نوع موجودیت
    if (type === 'tag') {
      if (!roleHasPermission(user.role, 'tags.manage')) {
        throw new ApiError(403, 'شما مجوز ادغام برچسب‌ها را ندارید.')
      }
    } else if (!roleHasPermission(user.role, 'categories.manage')) {
      throw new ApiError(403, 'شما مجوز ادغام دسته‌بندی‌ها را ندارید.')
    }

    const notes =
      body.notes === undefined || body.notes === null || body.notes === ''
        ? null
        : vString(body.notes, 'یادداشت', { max: 500 })
    const registerRedirect = vBoolean(body.registerRedirect)

    // ─── اعتبارسنجی fieldChoices ────────────────────────────────────
    if (
      body.fieldChoices !== undefined &&
      body.fieldChoices !== null &&
      (typeof body.fieldChoices !== 'object' || Array.isArray(body.fieldChoices))
    ) {
      throw new ApiError(400, 'ساختار «fieldChoices» نامعتبر است.')
    }
    const fc = (body.fieldChoices ?? {}) as { name?: unknown; description?: unknown }
    const appliedChoices: AppliedChoices = {}

    let newName: string | undefined
    if (typeof fc.name === 'string' && fc.name.trim() !== '') {
      newName = vString(fc.name, 'نام', { required: true, max: type === 'tag' ? 60 : 100 })
      appliedChoices.name = newName
    }

    let applyDescription = false
    let descriptionValue: string | null = null
    if (type === 'tag') {
      // برچسب فیلد توضیح ندارد
      if (fc.description !== undefined) throw new ApiError(400, 'برچسب توضیح ندارد.')
    } else if (fc.description !== undefined && fc.description !== null) {
      const desc = vString(fc.description, 'توضیح', { max: 500 })
      applyDescription = true
      descriptionValue = desc === '' ? null : desc
      appliedChoices.description = descriptionValue
    }

    const now = new Date()
    const entityTypeLog = type === 'tag' ? 'TAG' : 'CATEGORY'

    // هر دو نوع در یک تراکنش واحد اجرا می‌شوند (خوانش تازه داخل تراکنش)
    const result = await db.$transaction(async (tx): Promise<MergeResult> => {
      if (type === 'tag') {
        // ─── برچسب ────────────────────────────────────────────────
        const source = await tx.tag.findUnique({ where: { id: sourceId } })
        const target = await tx.tag.findUnique({ where: { id: targetId } })
        if (!source || !target) throw new ApiError(404, 'یکی از رکوردها یافت نشد.')
        if (source.mergedIntoId !== null || target.mergedIntoId !== null) {
          throw new ApiError(409, 'ادغام ممکن نیست؛ یکی از این رکوردها قبلاً ادغام شده است.')
        }

        // اعتبار یکتایی نام جدید (نام رکوردهای ادغام‌شده همچنان اشغال است)
        if (newName) {
          const others = await tx.tag.findMany({ where: { id: { not: targetId } }, select: { name: true } })
          if (others.some((r) => r.name.trim().toLowerCase() === newName.toLowerCase())) {
            throw new ApiError(409, 'برچسبی با این نام وجود دارد.')
          }
        }

        // انتقال روابط بدون ایجاد جفت تکراری
        const sourceLinks = await tx.articleTag.findMany({ where: { tagId: sourceId }, select: { articleId: true } })
        const existingTarget = await tx.articleTag.findMany({ where: { tagId: targetId }, select: { articleId: true } })
        const existingSet = new Set(existingTarget.map((l) => l.articleId))
        const toCreate = sourceLinks.filter((l) => !existingSet.has(l.articleId))

        await tx.articleTag.deleteMany({ where: { tagId: sourceId } })
        if (toCreate.length > 0) {
          await tx.articleTag.createMany({
            data: toCreate.map((l) => ({ tagId: targetId, articleId: l.articleId })),
          })
        }

        const targetData: { name?: string } = {}
        if (newName) targetData.name = newName
        if (Object.keys(targetData).length > 0) {
          await tx.tag.update({ where: { id: targetId }, data: targetData })
        }

        await tx.tag.update({
          where: { id: sourceId },
          data: { mergedIntoId: targetId, mergedAt: now, mergedByName: user.name },
        })

        return {
          relationCount: toCreate.length,
          redirectCreated: false,
          sourceName: source.name,
          targetName: target.name,
          finalTargetName: newName ?? target.name,
        }
      }

      // ─── دسته‌بندی ──────────────────────────────────────────────
      const source = await tx.category.findUnique({ where: { id: sourceId } })
      const target = await tx.category.findUnique({ where: { id: targetId } })
      if (!source || !target) throw new ApiError(404, 'یکی از رکوردها یافت نشد.')
      if (source.mergedIntoId !== null || target.mergedIntoId !== null) {
        throw new ApiError(409, 'ادغام ممکن نیست؛ یکی از این رکوردها قبلاً ادغام شده است.')
      }

      // اعتبار یکتایی نام جدید (نام رکوردهای ادغام‌شده همچنان اشغال است)
      if (newName) {
        const others = await tx.category.findMany({ where: { id: { not: targetId } }, select: { name: true } })
        if (others.some((r) => r.name.trim().toLowerCase() === newName.toLowerCase())) {
          throw new ApiError(409, 'دسته‌بندی‌ای با این نام وجود دارد.')
        }
      }

      // گارد چرخه: منبع نباید در زنجیرهٔ والدین مقصد باشد.
      // تنها استثنا: والدِ مستقیمِ مقصد خودِ منبع باشد — در این حالت با ادغام، مقصد ریشه می‌شود.
      const targetIsDirectChild = target.parentId === sourceId
      if (!targetIsDirectChild) {
        let cursorId = target.parentId
        for (let depth = 0; cursorId && depth < 50; depth++) {
          if (cursorId === sourceId) {
            throw new ApiError(409, 'مقصد در زیرشاخهٔ منبع قرار دارد؛ این ادغام چرخه در ساختار ایجاد می‌کند.')
          }
          const row = await tx.category.findUnique({ where: { id: cursorId }, select: { parentId: true } })
          if (!row) break
          cursorId = row.parentId
        }
      }

      // انتقال مقالات به مقصد
      const moved = await tx.article.updateMany({
        where: { categoryId: sourceId },
        data: { categoryId: targetId },
      })

      // جابه‌جایی فرزندان منبع به مقصد
      await tx.category.updateMany({ where: { parentId: sourceId }, data: { parentId: targetId } })

      // به‌روزرسانی فیلدهای مقصد بر اساس انتخاب‌ها
      const targetData: Prisma.CategoryUncheckedUpdateInput = {}
      if (newName) targetData.name = newName
      if (applyDescription) targetData.description = descriptionValue
      if (targetIsDirectChild) targetData.parentId = null // جلوگیری از والدِ خودِ مقصد
      if (Object.keys(targetData).length > 0) {
        await tx.category.update({ where: { id: targetId }, data: targetData })
      }

      // علامت‌گذاری منبع به‌عنوان ادغام‌شده
      await tx.category.update({
        where: { id: sourceId },
        data: { mergedIntoId: targetId, mergedAt: now, mergedByName: user.name },
      })

      // ثبت ریدایرکت آدرس (در صورت درخواست و متفاوت‌بودن slug ها)
      let redirectCreated = false
      if (registerRedirect && source.slug !== target.slug) {
        const fromPath = `/category/${source.slug}`
        const toPath = `/category/${target.slug}`
        await tx.redirect.upsert({
          where: { fromPath },
          create: {
            fromPath,
            toPath,
            kind: 'SLUG_CHANGE',
            entityType: 'CATEGORY',
            entityId: targetId,
            createdById: user.id,
            createdByName: user.name,
          },
          update: {
            toPath,
            kind: 'SLUG_CHANGE',
            entityType: 'CATEGORY',
            entityId: targetId,
            createdById: user.id,
            createdByName: user.name,
          },
        })
        redirectCreated = true
      }

      return {
        relationCount: moved.count,
        redirectCreated,
        sourceName: source.name,
        targetName: target.name,
        finalTargetName: newName ?? target.name,
      }
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType: entityTypeLog,
      entityId: targetId,
      entityTitle: result.finalTargetName,
      details: `ادغام «${result.sourceName}» در «${result.targetName}» — انتقال روابط ${result.relationCount} مقاله${result.redirectCreated ? ' — ریدایرکت ثبت شد.' : ''}`,
    })

    const mergeLog = await db.dataMergeLog.create({
      data: {
        entityType: entityTypeLog,
        sourceId,
        sourceName: result.sourceName,
        targetId,
        targetName: result.targetName,
        relationCount: result.relationCount,
        fieldChoices: JSON.stringify(appliedChoices),
        notes,
        performedById: user.id,
        performedByName: user.name,
      },
    })

    return ok({ ok: true, movedCount: result.relationCount, redirectCreated: result.redirectCreated, mergeLogId: mergeLog.id })
  } catch (err) {
    return handleApiError(err)
  }
}
