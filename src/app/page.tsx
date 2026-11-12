'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { useHashRoute } from '@/hooks/use-hash-route'
import { apiGet, setUnauthorizedHandler } from '@/lib/client/api'
import { useAppStore, type CurrentUser } from '@/store/app-store'
import { LoginScreen } from '@/components/admin/login-screen'
import { AdminShell } from '@/components/admin/admin-shell'
import { DashboardView } from '@/components/views/dashboard-view'
import { ArticlesView } from '@/components/views/articles-view'
import { ArticleEditorView } from '@/components/views/article-editor-view'
import { CategoriesView } from '@/components/views/categories-view'
import { TagsView } from '@/components/views/tags-view'
import { CommentsView } from '@/components/views/comments-view'
import { MediaView } from '@/components/views/media-view'
import { PagesView } from '@/components/views/pages-view'
import { MenusView } from '@/components/views/menus-view'
import { UsersView } from '@/components/views/users-view'
import { RolesView } from '@/components/views/roles-view'
import { FormsView } from '@/components/views/forms-view'
import { ReportsView } from '@/components/views/reports-view'
import { ActivityView } from '@/components/views/activity-view'
import { SettingsView } from '@/components/views/settings-view'
import { AccountView } from '@/components/views/account-view'
import { LoadingSpinner, EmptyState } from '@/components/shared/ui-bits'

type MeResponse = { user: CurrentUser; permissions: string[] }

function renderView(path: string) {
  const seg = path.split('/').filter(Boolean)
  const root = seg[0] ?? 'dashboard'

  switch (root) {
    case 'dashboard':
      return <DashboardView />
    case 'articles':
      if (seg.length === 1) return <ArticlesView />
      return <ArticleEditorView />
    case 'categories':
      return <CategoriesView />
    case 'tags':
      return <TagsView />
    case 'comments':
      return <CommentsView />
    case 'media':
      return <MediaView />
    case 'pages':
      return <PagesView />
    case 'menus':
      return <MenusView />
    case 'users':
      return <UsersView />
    case 'roles':
      return <RolesView />
    case 'forms':
      return <FormsView />
    case 'reports':
      return <ReportsView />
    case 'activity':
      return <ActivityView />
    case 'settings':
      return <SettingsView />
    case 'account':
      return <AccountView />
    default:
      return (
        <EmptyState
          title="صفحه یافت نشد"
          description="مسیر مورد نظر در سامانه وجود ندارد."
        />
      )
  }
}

export default function Page() {
  const { path } = useHashRoute()
  const user = useAppStore((s) => s.user)
  const booting = useAppStore((s) => s.booting)
  const setUser = useAppStore((s) => s.setUser)
  const setPermissions = useAppStore((s) => s.setPermissions)
  const setBooting = useAppStore((s) => s.setBooting)
  const logout = useAppStore((s) => s.logout)

  // راه‌اندازی: بازیابی نشست از کوکی
  React.useEffect(() => {
    setUnauthorizedHandler(() => {
      logout()
      toast.error('نشست شما منقضی شده است. لطفاً دوباره وارد شوید.')
    })
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiGet<MeResponse>('/api/auth/me')
        if (cancelled) return
        setUser(res.user)
        setPermissions(res.permissions)
      } catch {
        // کاربر وارد نشده — صفحه ورود نمایش داده می‌شود
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setUser, setPermissions, setBooting, logout])

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner label="در حال آماده‌سازی سامانه…" />
      </div>
    )
  }

  if (!user) return <LoginScreen />

  return (
    <AdminShell path={path} navigate={(to) => (window.location.hash = to)}>
      {renderView(path)}
    </AdminShell>
  )
}
