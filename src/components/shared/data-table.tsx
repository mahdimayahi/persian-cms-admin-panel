'use client'

import * as React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, Pagination } from '@/components/shared/ui-bits'
import { cn } from '@/lib/utils'

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  className?: string
  headerClassName?: string
}

type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  /** خطای دریافت داده */
  error?: React.ReactNode
  emptyState?: React.ReactNode
  emptyTitle?: string
  emptyDescription?: string
  // صفحه‌بندی سمت سرور
  page?: number
  pageSize?: number
  total?: number
  onPageChange?: (p: number) => void
  onPageSizeChange?: (s: number) => void
  itemLabel?: string
  // انتخاب گروهی
  selectable?: boolean
  selected?: string[]
  onSelectedChange?: (ids: string[]) => void
  // نوار عملیات گروهی
  bulkBar?: React.ReactNode
  /** حداکثر ارتفاع با اسکرول برای جدول‌های طولانی */
  maxHeightClass?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  emptyState,
  emptyTitle = 'موردی یافت نشد',
  emptyDescription,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel,
  selectable = false,
  selected = [],
  onSelectedChange,
  bulkBar,
  maxHeightClass,
}: DataTableProps<T>) {
  const rowIds = React.useMemo(() => rows.map(rowKey), [rows, rowKey])
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.includes(id))
  const someSelected = rowIds.some((id) => selected.includes(id)) && !allSelected

  const toggleAll = () => {
    if (!onSelectedChange) return
    if (allSelected) onSelectedChange(selected.filter((id) => !rowIds.includes(id)))
    else onSelectedChange(Array.from(new Set([...selected, ...rowIds])))
  }

  const toggleRow = (id: string) => {
    if (!onSelectedChange) return
    onSelectedChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  if (error) return <>{error}</>

  return (
    <div className="space-y-0">
      {bulkBar}
      <div className={cn('rounded-lg border overflow-x-auto', maxHeightClass)}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {selectable ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label="انتخاب همه ردیف‌های این صفحه"
                  />
                </TableHead>
              ) : null}
              {columns.map((col) => (
                <TableHead key={col.key} className={cn('whitespace-nowrap', col.headerClassName)}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  {selectable ? (
                    <TableCell>
                      <Skeleton className="h-4 w-4" />
                    </TableCell>
                  ) : null}
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full max-w-32" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (selectable ? 1 : 0)}>
                  {emptyState ?? <EmptyState title={emptyTitle} description={emptyDescription} compact />}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const id = rowKey(row)
                return (
                  <TableRow key={id} data-selected={selected.includes(id) || undefined} className={cn(selected.includes(id) && 'bg-muted/40')}>
                    {selectable ? (
                      <TableCell>
                        <Checkbox checked={selected.includes(id)} onCheckedChange={() => toggleRow(id)} aria-label={`انتخاب ردیف ${id}`} />
                      </TableCell>
                    ) : null}
                    {columns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      {page !== undefined && total !== undefined && onPageChange ? (
        <Pagination
          page={page}
          pageSize={pageSize ?? 10}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          itemLabel={itemLabel}
        />
      ) : null}
    </div>
  )
}
