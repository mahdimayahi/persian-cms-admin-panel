'use client'

/** کلاینت API با مدیریت خطای یکپارچه فارسی */

export class ApiError extends Error {
  status: number
  data?: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

type UnauthorizedHandler = (err: ApiError) => void
let unauthorizedHandler: UnauthorizedHandler | null = null

/** ثبت رفتار هنگام انقضای نشست (به‌صورت خودکار در store فراخوانی می‌شود) */
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  unauthorizedHandler = fn
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'اتصال به سرور برقرار نشد. اتصال شبکه خود را بررسی کنید.')
  }

  if (res.status === 401 && unauthorizedHandler && !path.includes('/api/auth/')) {
    const err = new ApiError(401, 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.')
    unauthorizedHandler(err)
    throw err
  }

  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!res.ok) {
    const errBody = (body as { error?: string; data?: unknown }) ?? {}
    throw new ApiError(res.status, errBody.error || 'خطای غیرمنتظره در ارتباط با سرور.', errBody.data)
  }
  return body as T
}

export const apiGet = <T,>(path: string) => request<T>(path)
export const apiPost = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined })
export const apiPut = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined })
export const apiDelete = <T,>(path: string) => request<T>(path, { method: 'DELETE' })

export type PagedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
