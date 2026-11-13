/**
 * پیکربندی هارنس تست — همهٔ مسیرها نسبت به ریشهٔ مخزن محاسبه می‌شوند؛
 * هیچ وابستگی به مسیر مطلق محیط اجرا (sandbox) وجود ندارد.
 */
import path from 'node:path'

export const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')
export const HARNESS_DIR = path.join(REPO_ROOT, 'db', 'harness')
export const HARNESS_DB = path.join(HARNESS_DIR, 'harness.db')
/** مسیر مطلق — بدون ابهام حل مسیر نسبی در CLI/runtime */
export const HARNESS_DB_URL = `file:${HARNESS_DB}`
export const HARNESS_PORT = 3211
export const BASE_URL = `http://127.0.0.1:${HARNESS_PORT}`
/** پوشهٔ خروجی dev جدا از .next سرور توسعهٔ جاری */
export const HARNESS_DIST_DIR = '.next-harness'
export const SERVER_LOG = path.join(HARNESS_DIR, 'server.log')
