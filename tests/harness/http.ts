/**
 * کلاینت HTTP سبک برای API سرور هارنس — مدیریت کوکی نشست و پاسخ ساختاریافته
 */
import { BASE_URL } from './config'

export type ApiResponse<T = unknown> = {
  status: number
  body: T | null
  headers: Headers
  setCookies: string[]
}

export class Api {
  cookie: string | null = null

  constructor(public label: string) {}

  /** ورود؛ کوکی cms_session از Set-Cookie استخراج و برای درخواست‌های بعدی حفظ می‌شود */
  async login(email: string, password: string, extraHeaders: Record<string, string> = {}) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ email, password }),
    })
    const setCookies = collectSetCookies(res.headers)
    const m = setCookies.find((c) => c.startsWith('cms_session='))
    if (m) this.cookie = m.split(';')[0]
    return { status: res.status, body: await safeJson(res), setCookies }
  }

  async req<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: { headers?: Record<string, string>; form?: FormData } = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      ...(this.cookie ? { cookie: this.cookie } : {}),
      ...(opts.headers ?? {}),
    }
    let payload: BodyInit | undefined
    if (opts.form) {
      payload = opts.form // content-type را مرورگر/کلاینت با boundary ست می‌کند
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: payload })
    return { status: res.status, body: await safeJson<T>(res), headers: res.headers, setCookies: collectSetCookies(res.headers) }
  }
}

function collectSetCookies(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** انتظار وضعیت مشخص — در صورت مغایرت، پیام و بدنه گزارش می‌شود */
export function expectStatus(r: ApiResponse, expected: number, ctx = ''): void {
  if (r.status !== expected) {
    throw new Error(
      `${ctx ? ctx + ' — ' : ''}وضعیت انتظار ${expected} بود اما ${r.status} دریافت شد — بدنه: ${JSON.stringify(r.body)?.slice(0, 400)}`
    )
  }
}
