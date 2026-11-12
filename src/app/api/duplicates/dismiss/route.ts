/**
 * علامت‌گذاری یک جفت تکراری به‌عنوان «غیرتکراری» — فاز ۳
 * POST /api/duplicates/dismiss — بدنه: { type: 'tag'|'category', idA, idB, reason?: string }
 * جفت در DuplicateDismissal ثبت می‌شود (کلید مرتب: idA < idB) و دیگر به‌عنوان تکراری پیشنهاد نمی‌گردد.
 * عملیات idempotent است (upsert بر اساس @@unique).
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, ok, handleApiError, requireAuth, parseBody, vEnum, vString } from '@/lib/api-utils'
import { logActivity } from '@/lib/audit'
import { roleHasPermission } from '@/lib/permissions'

interface DismissBody {
  type?: unknown
  idA?: unknown
  idB?: unknown
  reason?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await parseBody<DismissBody>(req)
    const type = vEnum<'tag' | 'category'>(body.type, ['tag', 'category'] as const, 'نوع')
    const idA = vString(body.idA, 'رکورد اول', { required: true, max: 100 })
    const idB = vString(body.idB, 'رکورد دوم', { required: true, max: 100 })
    const reason =
      body.reason === undefined || body.reason === null || body.reason === ''
        ? null
        : vString(body.reason, 'دلیل', { max: 300 })

    if (idA === idB) throw new ApiError(400, 'شناسه دو رکورد نباید یکی باشد.')

    // مجوز — همان مجوز ادغام
    if (type === 'tag') {
      if (!roleHasPermission(user.role, 'tags.manage')) {
        throw new ApiError(403, 'شما مجوز مدیریت برچسب‌ها را ندارید.')
      }
    } else if (!roleHasPermission(user.role, 'categories.manage')) {
      throw new ApiError(403, 'شما مجوز مدیریت دسته‌بندی‌ها را ندارید.')
    }

    const entityType = type === 'tag' ? 'TAG' : 'CATEGORY'

    // نام هر دو رکورد باید موجود باشد
    const [recA, recB] = await Promise.all([
      type === 'tag' ? db.tag.findUnique({ where: { id: idA } }) : db.category.findUnique({ where: { id: idA } }),
      type === 'tag' ? db.tag.findUnique({ where: { id: idB } }) : db.category.findUnique({ where: { id: idB } }),
    ])
    if (!recA || !recB) throw new ApiError(404, 'یکی از رکوردها یافت نشد.')
    if (recA.mergedIntoId !== null || recB.mergedIntoId !== null) {
      throw new ApiError(409, 'این رکوردها ادغام شده‌اند.')
    }

    // کلید مرتب جفت (idA < idB از نظر لغوی) — مستقل از ترتیب درخواست
    const [firstId, secondId] = idA < idB ? [idA, idB] : [idB, idA]
    const [firstName, secondName] = idA < idB ? [recA.name, recB.name] : [recB.name, recA.name]

    await db.duplicateDismissal.upsert({
      where: { entityType_idA_idB: { entityType, idA: firstId, idB: secondId } },
      create: {
        entityType,
        idA: firstId,
        idB: secondId,
        nameA: firstName,
        nameB: secondName,
        reason,
        dismissedById: user.id,
        dismissedByName: user.name,
      },
      update: {
        nameA: firstName,
        nameB: secondName,
        reason,
        dismissedById: user.id,
        dismissedByName: user.name,
      },
    })

    await logActivity({
      userId: user.id,
      userName: user.name,
      action: 'UPDATE',
      entityType,
      entityId: idA,
      entityTitle: recA.name,
      details: `علامت‌گذاری «${recA.name}» و «${recB.name}» به‌عنوان غیرتکراری${reason ? ` — دلیل: ${reason}` : ''}`,
    })

    return ok({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
