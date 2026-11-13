# Task 3-a — ImpactDialog v2 + حذف ایمن رسانه/دسته‌بندی + گارد slug ویرایشگر

## Files changed (exclusively owned by this task)
1. `src/components/shared/impact-dialog.tsx` — **full rewrite (v2)** per phase1-spec §1 + §4.1
2. `src/components/views/media-view.tsx` — force-delete ConfirmDialog → ImpactDialog
3. `src/components/views/categories-view.tsx` — onDelete with strategy query
4. `src/components/views/article-editor-view.tsx` — slug-change 409 guard (surgical edits only)

Not edited (verified compile-compatible as-is): `tags-view.tsx` (its `onDelete={confirmDelete}` with zero-arg async fn is assignable to the new optional-opts signature), `users-view.tsx` (does not use ImpactDialog; still uses ConfirmDialog + transfer flow per existing backend behavior).

## Final props/type shape of ImpactDialog
```ts
export type ImpactType = 'article' | 'category' | 'tag' | 'media' | 'user' | 'page'
export type ImpactSeverity = 'INFO' | 'WARNING' | 'BLOCKING'
export type ImpactItem   = { id: string; title: string; status?: string | null; published: boolean; link?: string | null }
export type ImpactGroup  = { key: string; label: string; detail: string; dependencyType: string; count: number; severity: ImpactSeverity; items: ImpactItem[] }
export type ImpactReport = { type: ImpactType; id: string; name: string; severity: ImpactSeverity; canDelete: boolean; total: number; groups: ImpactGroup[] }
export type ImpactDeleteOptions = { strategy?: 'TRANSFER' | 'DETACH'; targetCategoryId?: string }

ImpactDialog({ target: { type: ImpactType; id: string; name: string } | null,
               onClose: () => void,
               onDelete: (opts?: ImpactDeleteOptions) => Promise<void> | void,
               onDeleted: () => void })
```
- Fetches `GET /api/impact?type=..&id=..` on open (and on reloadKey change).
- Severity banner: INFO → slate «اطلاع‌رسانی» «حذف با پاک‌سازی خودکار وابستگی‌ها انجام می‌شود»؛ WARNING → amber «هشدار»؛ BLOCKING → rose «مسدودکننده» «حذف تا رفع وابستگی مسدود است». Zero groups → emerald safe box.
- Group cards: label + count badge (toFa) + detail (faDigits) + item rows: title + status chip («منتشرشده» emerald when published; «پیش‌نویس» muted when status && !published; no chip when no status) + ExternalLink button when `link` present → `onClose(); navigate(link)` (link already contains '#').
- Groups list: `max-h-64 overflow-y-auto pe-1`; max 5 items + «و N مورد دیگر…».
- `canDelete === false` → delete button DISABLED + «راه اصلاح» region:
  - `media`: Button «انتخاب رسانهٔ جایگزین…» opens existing `MediaPickerDialog` (open/onOpenChange/onSelect API fits as a stacked dialog) → on select shows «جایگزینی ارجاع‌ها و آزادسازی فایل» → `POST /api/media/{id}/replace-references { targetMediaId }` → toast success (moved count, toFa) → refetch report (now safe). Replacing spinner state.
  - `category`: RadioGroup — «انتقال مقالات به دستهٔ دیگر» (+ Select from `GET /api/categories`, excluding the target itself; auto-switches to DETACH if no other category exists) / «خروج مقالات از دسته (بدون دسته‌بندی)» → primary button becomes «حذف با انتقال» (disabled until targetCategoryId chosen) or «حذف با خروج از دسته» → `onDelete({ strategy: 'TRANSFER', targetCategoryId } | { strategy: 'DETACH' })`.
  - Other blocking types: generic «ابتدا وابستگی‌های فهرست‌شده را رفع کنید…» hint, button stays disabled.
- `canDelete === true` → «حذف قطعی» calls `onDelete()`; on success `onDeleted()` + `onClose()`; on failure toasts server message and dialog stays open. All Persian, dir="rtl", aria labels preserved.

## Parent view wiring
- **media-view**: removed `deleting`/`deleteOpen`/`forceInfo` states and `doDelete(force)`; delete button in details dialog sets `deleteTarget { id, name: originalName }`; `onDelete = handleDeleteMedia` → `apiDelete('/api/media/${id}')` WITHOUT `?force=true`, on success toasts + closes details dialog (`setDetails(null)`). No local 409 branch needed: any thrown error (incl. 409 `{ blocking, impact }`) propagates to ImpactDialog which toasts the server error message and keeps the dialog open showing the blocker/resolver. `onDeleted={load}` refreshes the grid. Upload/alt-edit/list untouched.
- **categories-view**: `confirmDelete(opts?)` builds query — `?strategy=TRANSFER&targetCategoryId=...` or `?strategy=DETACH` — and awaits `apiDelete`; errors propagate to ImpactDialog (toast + stays open); success toasts, then ImpactDialog runs `onDeleted={load}` + `onClose` (target cleared). Create/edit flows untouched.
- **article-editor** (save flow ~L428-522 + dialog ~L1510-1565):
  - `save` opts extended with `forceSlugConfirm?: boolean; registerRedirect?: boolean` → merges `payload.confirmSlugChange = true` and `payload.registerRedirect = !!opts.registerRedirect`; `save` now returns `Promise<boolean>` (true on success).
  - 409 handler branches: `data.conflict` → existing conflict dialog; `data.slugChange` → `setSlugGuard({ oldSlug: data.oldSlug ?? article?.slug, newSlug: data.newSlug ?? slug })` (redirect checkbox reset to checked); else → server-message toast.
  - New AlertDialog «تغییر آدرس محتوای منتشرشده»: warning text, LTR mono `oldSlug → newSlug` row, Checkbox «ثبت ریدایرکت از آدرس قبلی» (default checked), footer: انصراف (closes, editor state kept) / «ذخیره بدون ریدایرکت» / «ذخیره با ریدایرکت» → `confirmSlugSave(bool)` → `save({ forceSlugConfirm: true, registerRedirect })` → on success applyArticle (updates `baseUpdatedAtRef` from response) + toast + close; while resending `saving` drives spinner and disables all buttons/dialog close.

## Verification
- `bunx tsc --noEmit` — zero errors under `src/components/shared/impact-dialog` and all five views (only pre-existing errors in `examples/` + `skills/`, unrelated).
- `bun run lint` — clean.
- dev.log — GET / 200s, no compile errors.

## Deviations (with reasons)
1. **`pendingPayload` state omitted** for the slug guard: the dialog buttons reuse `save({ forceSlugConfirm, registerRedirect })`, which rebuilds the identical PUT payload from editor state; the AlertDialog is modal so state cannot change between the 409 and confirmation, making a stored payload redundant (and riskier if stale). oldSlug/newSlug ARE stored in state with server-value-first fallbacks.
2. Media replacement picker reuses `MediaPickerDialog` as a stacked controlled dialog inside the AlertDialog (its open/onOpenChange/onSelect API fits); it cannot exclude the media being deleted (no exclusion prop, file not owned by this task) — picking the same file is a harmless no-op retry path.
3. Parents no longer swallow delete errors (media/categories): errors must propagate so ImpactDialog can toast the server message and stay open (previous categories-view swallowed errors and closed the dialog — fixed as a side effect of the new contract).
4. ImpactDialog renders one banner for INFO/WARNING with the auto-cleanup text and adds «N وابستگی یافت شد» inside it; spec §4.1 does not fix exact banner wording beyond severity labels, so this is a wording-level choice.
