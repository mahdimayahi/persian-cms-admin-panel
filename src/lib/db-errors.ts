/**
 * طبقه‌بندی خطاهای Prisma — تفکیک صریح «تعارض واقعی»، «خطای موقت» و «خطای داخلی»
 *
 * اصل: علت هرگز پنهان نمی‌شود — کد خطا در پاسخ و در لاگ سرور هر دو ثبت می‌گردد.
 *
 * نگاشت قراردادی:
 *  - P2002  نقض یکتایی (ارسال هم‌زمان رکورد تکراری)      → 409 CONFFLICT   — تعارض واقعی؛ نسخهٔ تازه لازم است
 *  - P2034  شکست سری‌سازی/قفل‌گذاری نویسنده (SQLite BUSY)  → 409 CONFLICT + transient — رقابت هم‌زمان قابل تلاش مجدد
 *  - P2024  اتمام مهلت گرفتن اتصال از استخر               → 503 transient  — خطای موقت ظرفیت؛ تغییر سمت داده نیست
 *  - P2028  تراکنش تعاملی پیش از پایان بسته شد (timeout)  → 503 transient  — هیچ نوشتن ناقصی کامیت نشده؛ تلاش مجدد امن است
 *  - سایر کدها / بدون کد                                  → 500            — خطای داخلی؛ علت کامل فقط در لاگ سرور
 *
 * چرا P2028 دیگر 409 نیست؟
 *  پیام ۴۰۹ به کاربر می‌گوید «دیگری این رکورد را تغییر داد» که دربارهٔ P2028 نادرست و گمراه‌کننده است؛
 *  P2028 یعنی تراکنش به‌دلیل مهلت زمانی خنثی شده — نه تعارض نسخه. گارد تعارض واقعی، CAS اتمی
 *  داخل تراکنش‌هاست که مستقلاً ۴۰۹ اختصاصی با serverUpdatedAt می‌دهد.
 */

export type DbErrorClassification = {
  /** وضعیت HTTP پیشنهادی */
  status: number
  /** پیام فارسی برای کاربر */
  message: string
  /** کد اصلی Prisma — همیشه در بدنهٔ پاسخ حاضر است (شفافیت علت) */
  code: string
  /** تعارض واقعی نسخه/یکتایی — کلاینت باید نسخهٔ تازه بگیرد */
  conflict: boolean
  /** خطای موقت زیرساخت — تلاش مجدد همان درخواست بدون تغییر مجاز است */
  transient: boolean
}

const CONFLICT_DUPLICATE = 'رکورد تکراری است؛ تغییر مشابهی هم‌زمان ثبت شده است.'
const CONCURRENT_WRITE = 'این رکورد هم‌زمان توسط دیگری تغییر کرد؛ نسخه تازه بگیرید و دوباره تلاش کنید.'
const DB_BUSY = 'پایگاه داده موقتاً مشغول است؛ چند لحظه بعد دوباره تلاش کنید.'
const TX_ABORTED = 'تراکنش پایگاه داده به‌دلیل وقفهٔ زمانی ناتمام ماند؛ هیچ تغییر ناقصی ثبت نشده است. دوباره تلاش کنید.'

export function classifyPrismaError(err: unknown): DbErrorClassification | null {
  const code = (err as { code?: string } | null)?.code
  if (typeof code !== 'string' || !/^P\d{4}$/.test(code)) return null

  switch (code) {
    case 'P2002':
      return { status: 409, message: CONFLICT_DUPLICATE, code, conflict: true, transient: false }
    case 'P2034':
      return { status: 409, message: CONCURRENT_WRITE, code, conflict: true, transient: true }
    case 'P2024':
      return { status: 503, message: DB_BUSY, code, conflict: false, transient: true }
    case 'P2028':
      return { status: 503, message: TX_ABORTED, code, conflict: false, transient: true }
    default:
      // کدهای شناخته‌شدهٔ دیگر (P2003 کلید خارجی، P2025 رکورد یافت نشد و ...) خطای کاربر/داخلی‌اند
      // و در این لایه تعارض تلقی نمی‌شوند — دستهٔ عمومی 500 با ثبت علت در لاگ.
      return null
  }
}

/**
 * تشخیص «اشغال گذرای پایگاه داده» حتی بدون کد P استاندارد.
 * در نقاطی که علت رقابت معلوم است (CAS روی یک سطر مشخص)، مسیر فراخوان می‌تواند
 * این خطا را به تعارض ۴۰۹ با serverUpdatedAt تازه ترجمه کند — علت در لاگ ثبت می‌شود.
 */
export function isTransientDbContention(err: unknown): boolean {
  const cls = classifyPrismaError(err)
  if (cls?.transient) return true
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('Socket timeout') || msg.includes('database is locked') || msg.includes('SQLITE_BUSY')
}
