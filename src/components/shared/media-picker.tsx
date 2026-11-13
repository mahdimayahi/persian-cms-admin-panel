'use client'

import * as React from 'react'
import { FileText, ImageIcon, Upload } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiPost, PagedResponse } from '@/lib/client/api'
import { EmptyState, ErrorState, SearchInput } from '@/components/shared/ui-bits'
import { toFa, faBytes, faDate } from '@/lib/client/format'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export type MediaItem = {
  id: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  width?: number | null
  height?: number | null
  altText: string
  createdAt: string
  uploadedBy?: { id: string; name: string }
}

export function mediaUrl(id: string): string {
  return `/api/media/${id}/raw`
}

export function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSelect: (media: MediaItem) => void
}) {
  const [items, setItems] = React.useState<MediaItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const [uploading, setUploading] = React.useState(false)

  const load = React.useCallback(async (query = '') => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<PagedResponse<MediaItem>>(`/api/media?pageSize=24&q=${encodeURIComponent(query)}`)
      setItems(res.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در دریافت رسانه‌ها')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        await apiPost('/api/media', fd)
      }
      toast.success('فایل با موفقیت بارگذاری شد.')
      await load(q)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'بارگذاری فایل ناموفق بود.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle>انتخاب رسانه</DialogTitle>
          <DialogDescription>فایل موجود را انتخاب کنید یا فایل جدیدی بارگذاری کنید.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="library" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="w-fit">
            <TabsTrigger value="library" className="gap-1.5">
              <ImageIcon className="h-4 w-4" />
              کتابخانه
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5">
              <Upload className="h-4 w-4" />
              بارگذاری جدید
            </TabsTrigger>
          </TabsList>
          <TabsContent value="library" className="flex-1 min-h-0 flex flex-col gap-3 mt-3">
            <div className="flex gap-2">
              <SearchInput
                value={q}
                onChange={(v) => {
                  setQ(v)
                  load(v)
                }}
                placeholder="جست‌وجو در رسانه‌ها…"
                className="flex-1"
              />
            </div>
            <ScrollArea className="h-[45vh] rounded-md border p-3">
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-video rounded-md" />
                  ))}
                </div>
              ) : error ? (
                <ErrorState message={error} onRetry={() => load(q)} />
              ) : items.length === 0 ? (
                <EmptyState title="فایلی یافت نشد" description="از تب «بارگذاری جدید» فایل اضافه کنید." compact />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {items.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onSelect(m)
                        onOpenChange(false)
                      }}
                      className="group text-start rounded-lg border overflow-hidden hover:ring-2 hover:ring-primary/50 transition focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                        {m.mimeType.startsWith('image/') ? (
                          <img src={mediaUrl(m.id)} alt={m.altText || m.originalName} className="h-full w-full object-cover group-hover:scale-105 transition" loading="lazy" />
                        ) : (
                          <FileText className="h-10 w-10 text-muted-foreground" />
                        )}
                      </div>
                      <div className="p-2 text-xs">
                        <p className="font-medium truncate" title={m.originalName}>
                          {m.originalName}
                        </p>
                        <p className="text-muted-foreground mt-0.5">
                          {faBytes(m.size)} · {faDate(m.createdAt)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="upload" className="mt-3">
            <label
              className={cn(
                'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 cursor-pointer hover:border-primary/50 hover:bg-muted/40 transition',
                uploading && 'opacity-60 pointer-events-none'
              )}
            >
              <div className="rounded-full bg-muted p-4">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">{uploading ? 'در حال بارگذاری…' : 'فایل را اینجا رها کنید یا کلیک کنید'}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  فرمت‌های مجاز: PNG، JPEG، WebP، GIF، PDF — حداکثر {toFa(5)} مگابایت
                </p>
              </div>
              <input type="file" className="sr-only" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => onUpload(e.target.files)} />
            </label>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
