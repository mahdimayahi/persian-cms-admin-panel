'use client'

import * as React from 'react'
import { Check, Info, Minus, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/shared/ui-bits'
import { toFa } from '@/lib/client/format'
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type Role,
} from '@/lib/permissions'
import { useAppStore } from '@/store/app-store'

/**
 * صفحه مرجع نقش‌ها و ماتریس مجوزها (فقط‌خواندنی)
 * اعمال واقعی مجوزها در سمت سرور انجام می‌شود؛ این صفحه صرفاً مستندات رابط کاربری است.
 */
export function RolesView() {
  const user = useAppStore((s) => s.user)
  const myRole = (user?.role ?? null) as Role | null

  return (
    <div className="space-y-6">
      <PageHeader
        title="نقش‌ها و مجوزها"
        description="ماتریس دسترسی نقش‌ها به عملیات سامانه — مجوزها سمت سرور نیز اعمال می‌شوند"
        icon={<ShieldCheck className="h-5 w-5" />}
      />

      {/* کارت نقش‌ها */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((role) => {
          const isMine = myRole === role
          return (
            <Card
              key={role}
              className={isMine ? 'ring-2 ring-primary' : undefined}
              aria-label={`${ROLE_LABELS[role]}${isMine ? ' — نقش شما' : ''}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                    {ROLE_LABELS[role]}
                  </CardTitle>
                  {isMine ? <Badge>نقش شما</Badge> : null}
                </div>
                <CardDescription className="text-xs leading-5 min-h-10">{ROLE_DESCRIPTIONS[role]}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  <span className="font-bold text-foreground tabular-nums">{toFa(ROLE_PERMISSIONS[role].length)}</span>{' '}
                  مجوز
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ماتریس مجوزها */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ماتریس دسترسی</CardTitle>
          <CardDescription>مجوزهای هر نقش برای انجام عملیات سامانه</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 sticky top-0 z-10">
                  <TableHead className="min-w-48">عملیات</TableHead>
                  {ROLES.map((r) => (
                    <TableHead key={r} className="text-center whitespace-nowrap">
                      {ROLE_LABELS[r]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {PERMISSION_GROUPS.map((group) => (
                  <React.Fragment key={group.group}>
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/50 font-semibold text-sm">
                        {group.group}
                      </TableCell>
                    </TableRow>
                    {group.permissions.map((p) => (
                      <TableRow key={p}>
                        <TableCell className="text-sm">{PERMISSION_LABELS[p]}</TableCell>
                        {ROLES.map((r) =>
                          ROLE_PERMISSIONS[r].includes(p) ? (
                            <TableCell key={r} className="text-center">
                              <Check
                                className="h-4 w-4 text-success mx-auto"
                                aria-label="دارد"
                                role="img"
                              />
                            </TableCell>
                          ) : (
                            <TableCell key={r} className="text-center">
                              <Minus
                                className="h-4 w-4 text-muted-foreground/40 mx-auto"
                                aria-label="ندارد"
                                role="img"
                              />
                            </TableCell>
                          ),
                        )}
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* یادداشت پایانی */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          تغییر ماتریس مجوزها نیازمند اعمال تغییر در کد و بازبینی امنیتی است؛ این صفحه مرجع مستندات است.
        </AlertDescription>
      </Alert>
    </div>
  )
}
