/**
 * API پاسخ‌های فرم‌ها
 * GET /api/form-submissions — فهرست پاسخ‌ها با فیلتر وضعیت/نام فرم، جست‌وجو و صفحه‌بندی
 * پاسخ شامل formNames (نام‌های یکتای فرم‌ها) برای فیلتر رابط کاربری است.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, handleApiError, requirePermission, vEnum, getPaginationParams } from '@/lib/api-utils'
import { FORM_STATUSES } from '@/lib/constants'

export async function GET(req: NextRequest) {
  try {
    await requirePermission('forms.view')
    const sp = req.nextUrl.searchParams
    const { page, pageSize, skip, take } = getPaginationParams(sp)

    const q = sp.get('q')?.trim() ?? ''
    const statusParam = sp.get('status') ?? ''
    const formName = sp.get('formName')?.trim() ?? ''

    const status = statusParam
      ? vEnum(statusParam, FORM_STATUSES.map((s) => s.value), 'وضعیت')
      : undefined

    const where: Prisma.FormSubmissionWhereInput = {}
    if (status) where.status = status
    if (formName) where.formName = formName
    if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }, { subject: { contains: q } }]

    const [items, total, nameRows] = await Promise.all([
      db.formSubmission.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      db.formSubmission.count({ where }),
      db.formSubmission.findMany({
        distinct: ['formName'],
        select: { formName: true },
        orderBy: { formName: 'asc' },
      }),
    ])

    return ok({ items, total, page, pageSize, formNames: nameRows.map((r) => r.formName) })
  } catch (err) {
    return handleApiError(err)
  }
}
