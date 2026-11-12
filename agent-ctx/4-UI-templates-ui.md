# Task 4-UI — Ready Templates (الگوهای آماده) Module UI

Agent: 4-UI | Scope: exactly TWO files (`templates-view.tsx` full rewrite, `articles-view.tsx` create-flow addition + row badge). No API/lib/shared/store files touched. Dev server NOT restarted, no build run. Committed nothing.

## Verification

- `bunx tsc --noEmit`: 0 errors in my files (only 3 pre-existing errors remain in `examples/websocket/*` + `skills/image-edit/*`, owned by others).
- `bun run lint`: clean, no findings.
- Live API smoke test (admin session, all test data cleaned up afterwards): POST create (v1) → PATCH w/o changeNote = 400 → PATCH w/ changeNote = v2 → DEACTIVATE/ACTIVATE (no version bump) → create-content on inactive = 409 → create-content on active = 201 `{id,title,slug}` → detail shows usedByCount + limited version rows → DELETE used template = 409 Persian → after article delete, template DELETE = 200. All contracts confirmed on the running server.

## File 1 — src/components/views/templates-view.tsx (full rewrite, export `TemplatesView()` unchanged)

- Cards grid (`md:grid-cols-2 xl:grid-cols-3`): name, type badge (مقاله amber / صفحه فرود violet), «نسخه N» outline badge (fa numerals), فعال emerald / غیرفعال slate StatusBadge, «{n} محتوا ساخته‌شده», tag chips, creator + timeAgo(updatedAt), description line-clamp-2.
- Card actions: «ساخت محتوا با این الگو» (perm `articles.create`; POST `/api/templates/create-content` → toast → `navigate('/articles/{id}/edit')` — same pattern as article-editor create flow); disabled + Tooltip for inactive templates («الگوی غیرفعال برای ساخت محتوای جدید قابل انتخاب نیست.»). «نسخه‌ها» (History icon → versions dialog). «ویرایش» (perm `articles.review`; disabled+Tooltip for system templates without `settings.manage`, mirroring server 403). فعال/غیرفعال Switch (POST `{action:'ACTIVATE'|'DEACTIVATE'}`, optimistic update + rollback on error, no version bump). «حذف» disabled + Tooltip when usage>0 («الگو در حال استفاده است؛ فقط می‌توانید آن را غیرفعال کنید.») or system-without-settings.manage; delete via ConfirmDialog; disabled buttons wrapped in a span so Radix Tooltip still fires.
- Create/Edit dialog (reviewers only, button hidden otherwise): name/description/type/category + titleTemplate/excerptTemplate/contentTemplate (hint «جای‌نگهدارها مثل [[عنوان را وارد کنید]] تا جایگزین نشوند، مانع انتشار می‌شوند») + guideText; structure editor (label input + فیلد/بلوک Select + الزامی Checkbox + guide input + delete row + «افزودن آیتم», max validated server-side 30); checklist editor (numbered text rows, add/remove); tagNames as chips (Enter/comma/paste, max 10 with Persian toast); category select from GET /api/categories. Client validations mirror server (name≥3, title≥3, content≥10, structure labels required).
- Versioning UX: edit compares form vs deep-copied original snapshot (structure normalized to {label,kind,required,guide}) → any content-affecting change (same field list as server CONTENT_FIELDS) reveals required «شرح تغییر» input (min 3 chars, sent as `changeNote`); Save disabled when nothing changed («برای ذخیره، حداقل یکی از فیلدها را تغییر دهید.»); submit label «ذخیره و ثبت نسخه جدید». Uses a local `apiPatch` helper (same pattern as support-view/bundles-view/tasks-view) because `lib/client/api.ts` has no PATCH and lib files are out of scope.
- Versions dialog: GET /api/templates/{id} → shows usedByCount, Collapsible «پیش‌نمایش ساختار و چک‌لیست نسخه فعلی» (structure rows with فیلد/بلوک/الزامی + checklist; per-version snapshots are NOT returned by the API — see mismatch #2), then version list «نسخه N — {changeNote} ({createdByName}، faDate)» newest-first in `max-h-80 overflow-y-auto`; stale-response guard via `versionsData.id === versionsTarget.id`.
- Search (name/description/title/tags/creator) + status filter (همه/فعال/غیرفعال) client-side; summary line «{n} الگو · {n} فعال · {n} غیرفعال»; Persian loading/error/empty states (LoadingSpinner/ErrorState+retry/EmptyState, compact for filtered-empty); placeholder guide Alert with [[...]] wording; palette slate/amber/emerald/red/violet (no blue/indigo).

## File 2 — src/components/views/articles-view.tsx (surgical additions)

- Header button renamed «مقاله جدید» → «ایجاد محتوا» opening a 3-step dialog (same `can('articles.create')` gate; nothing else on the page changed):
  - Step 1: two option cards — «شروع خالی» keeps the EXACT existing behavior (close + `navigate('/articles/new')`); «ساخت با الگو» → step 2.
  - Step 2: `loadTemplates()` (race-guarded seq ref) → only `isActive` templates as selectable cards (name, type badge, «نسخه N», description clamp, chevron) in `max-h-[46vh] overflow-y-auto`; back button; Persian loading/ErrorState+retry/empty states (empty offers «شروع خالی» escape hatch).
  - Step 3: preview — name/type/version badges, description, title/excerpt previews (dir=auto), scrollable guideText, «بلوک‌ها و فیلدها» list (فیلد/بلوک/الزامی badges + guide), numbered checklist, amber Alert with exact hint «خروجی همیشه یک پیش‌نویس مستقل است؛ تأییدها منتقل نمی‌شود و تاریخ انتشار خالی است.»; footer «ایجاد پیش‌نویس مستقل» → POST /api/templates/create-content → success toast → close dialog → `navigate('/articles/{id}/edit')`. Dialog state fully reset on close.
- List rows: `ArticleRow` extended with `sourceTemplateName?/sourceTemplateVersion?` (present in GET /api/articles `articleListSelect` — verified), subtle outline Badge under the slug meta line: LayoutTemplate icon + «الگو: {name}» with truncate + title tooltip incl. version; renders nothing when field absent (graceful).

## Contract mismatches found (task brief vs actual API — UI adapted, APIs untouched)

1. **Usage count field**: GET /api/templates returns `_count: { articles: n }`, NOT `articlesCount`. Handled by `usageCount()` helper reading `_count?.articles` (with `articlesCount` fallback if backend later adds it).
2. **Version snapshots are lightweight**: GET /api/templates/{id} `versions` select only returns `{id, version, name, type, changeNote, createdByName, createdAt}` — no structure/checklist/content per version. The requested "expandable structure/checklist preview" is therefore implemented for the CURRENT version (Collapsible at top of versions dialog using the detail payload's parsed fields); per-version full snapshots would need an API change (flagged for lead).
3. **POST/PATCH response shape**: POST /api/templates and PATCH /api/templates/{id} return the template object directly (201/200), not wrapped as `{ template }` — typed accordingly.
4. **Edit method is PATCH, not PUT**: original templates-view used `apiPut` which would 405 (route exports PATCH only); replaced with local `apiPatch` helper (established pattern in 4 other view files).
5. Task brief mentioned an existing «ایجاد محتوا» dialog in articles-view — none existed (button navigated straight to `/articles/new`); implemented the dialog fresh with «شروع خالی» preserving that exact navigation as its behavior.
6. `/api/articles` list DOES include `sourceTemplateName`/`sourceTemplateVersion` (verified in `articleListSelect`), so the row badge is fully wired — no graceful-skip fallback needed in practice, but code still guards for absence.

## Notes for other agents

- `article-editor-view.tsx` still supports `#/articles/new?template={id}` (its own fetch path) — unaffected by this change; the canonical creation flow from templates is now create-content POST → `/articles/{id}/edit`.
- No changes to `lib/client/api.ts`; if a shared `apiPatch` is ever added there, the local helpers in support/bundles/tasks/views + this file can be migrated.
