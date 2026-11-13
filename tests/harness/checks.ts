/**
 * چارچوب کوچک اجرای چک‌ها — بدون وابستگی بیرونی
 * هر چک: نام + تابع؛ نتیجه‌ها جمع و در پایان خلاصهٔ PASS/FAIL چاپ می‌شود.
 */

export type CheckResult = { name: string; ok: boolean; error?: string; ms: number }

const results: CheckResult[] = []

export function assert(cond: unknown, msg = 'شرط برقرار نیست'): asserts cond {
  if (!cond) throw new Error(msg)
}

export function assertEquals<T>(actual: T, expected: T, msg = ''): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(`${msg || 'مقدار ناهم‌خوان است'} — انتظار: ${e} — واقعی: ${a}`)
  }
}

/** اجرای یک چک با ثبت نتیجه — خطا در نتیجه ثبت می‌شود، اجرای بقیه متوقف نمی‌شود */
export async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  const t0 = performance.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: performance.now() - t0 })
    console.log(`  ✔ PASS (${Math.round(performance.now() - t0)}ms) ${name}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    results.push({ name, ok: false, error: msg, ms: performance.now() - t0 })
    console.log(`  ✘ FAIL ${name}\n      └─ ${msg}`)
  }
}

export function getResults(): CheckResult[] {
  return results
}

export function summarize(): { pass: number; fail: number; total: number } {
  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok).length
  return { pass, fail, total: results.length }
}
