'use client'

import { create } from 'zustand'

export type CurrentUser = {
  id: string
  email: string
  name: string
  role: string
  status: string
  lastLoginAt?: string | null
  createdAt?: string | null
}

type AppState = {
  user: CurrentUser | null
  permissions: string[]
  unreadCount: number
  booting: boolean
  setUser: (u: CurrentUser | null) => void
  setPermissions: (p: string[]) => void
  setUnreadCount: (n: number) => void
  setBooting: (b: boolean) => void
  logout: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  permissions: [],
  unreadCount: 0,
  booting: true,
  setUser: (u) => set({ user: u }),
  setPermissions: (p) => set({ permissions: p }),
  setUnreadCount: (n) => set({ unreadCount: n }),
  setBooting: (b) => set({ booting: b }),
  logout: () => set({ user: null, permissions: [], unreadCount: 0 }),
}))

/** بررسی مجوز در سمت رابط کاربری (اعمال واقعی همیشه در سرور انجام می‌شود) */
export function useCan(): (permission: string) => boolean {
  const permissions = useAppStore((s) => s.permissions)
  return (permission: string) => permissions.includes(permission)
}
