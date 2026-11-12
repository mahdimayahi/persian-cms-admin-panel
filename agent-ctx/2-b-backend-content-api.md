# Task 2-b — Backend Content API (Persian RTL CMS)

Agent: 2-b | Scope: `src/app/api/**` route handlers ONLY. No changes to schema, libs, package.json, or frontend. db:push / dev / lint NOT run (per task rules). `bunx tsc --noEmit` verified: zero type errors in all API files.

## Created files (19)

| # | Path | Description |
|---|------|-------------|
| 1 | `src/app/api/articles/route.ts` | GET list (filters q/status/categoryId/authorId/tag-slug, sort createdAt/publishedAt/views/title, dir, pagination) + POST create (always DRAFT) |
| 2 | `src/app/api/articles/[id]/route.ts` | GET detail (full content + last 5 versions + comments count) + PUT edit (ownership + optimistic lock + auto versioning) + DELETE |
| 3 | `src/app/api/articles/[id]/transition/route.ts` | POST status transition workflow (SUBMIT_REVIEW/APPROVE/REJECT/PUBLISH/UNPUBLISH/ARCHIVE/BACK_TO_DRAFT) with notifications |
| 4 | `src/app/api/articles/[id]/versions/route.ts` | GET version list + POST restore (snapshots current state first) |
| 5 | `src/app/api/categories/route.ts` | GET all (with `_count.articles`) + POST (case-insensitive unique name, slug counter suffix) |
| 6 | `src/app/api/categories/[id]/route.ts` | PUT (regenerates slug when name changes, uniqueness excluding self) + DELETE (articles get categoryId=null via schema SetNull) |
| 7 | `src/app/api/tags/route.ts` | GET all (with `_count.articles`) + POST (unique name, slug counter suffix) |
| 8 | `src/app/api/tags/[id]/route.ts` | DELETE tag |
| 9 | `src/app/api/comments/route.ts` | GET paginated list (filters status/articleId/q over content+authorName) |
| 10 | `src/app/api/comments/[id]/route.ts` | PUT moderate (PENDING/APPROVED/REJECTED) + DELETE |
| 11 | `src/app/api/media/route.ts` | GET paginated list (q over originalName/altText, mimeType prefix match, NO `data` field) + POST multipart upload (5MB limit, mime whitelist, sharp dimensions) |
| 12 | `src/app/api/media/[id]/route.ts` | PUT altText (uploader or `media.delete.any`) + DELETE (usage check as cover image; `?force=true` bypass) |
| 13 | `src/app/api/media/[id]/raw/route.ts` | GET serves file binary (Buffer→Uint8Array, Content-Type, `Cache-Control: private, max-age=86400`) |
| 14 | `src/app/api/pages/route.ts` | GET all ordered by `order` asc + POST (slug unique → 409) |
| 15 | `src/app/api/pages/[id]/route.ts` | GET + PUT + DELETE |
| 16 | `src/app/api/menus/route.ts` | GET all + POST (order defaults to max+1) |
| 17 | `src/app/api/menus/[id]/route.ts` | PUT + DELETE |
| 18 | `src/app/api/form-submissions/route.ts` | GET paginated (status/formName/q) + `formNames: string[]` distinct for filter |
| 19 | `src/app/api/form-submissions/[id]/route.ts` | PUT status (NEW/READ/ARCHIVED) + DELETE |

## Response contract (for frontend agents)

- Success: HTTP **200** (even for POST create) with `NextResponse.json` body. Check `res.ok`, not status codes.
- Error: `{ error: string /* Persian */, data?: unknown }` with proper status (400/401/403/404/409/413/415/500).
- Paginated lists: `{ items, total, page, pageSize }` — articles, comments, media, form-submissions.
- Plain JSON arrays (no wrapper): categories, tags, pages, menus.
- Articles list items: **no `content`** field; `excerpt` kept. Detail GET/PUT return full `content`, `versions[5]{id,editorName,createdAt,note}`, `_count.comments`, `author{id,name}`, `category{id,name,color}`, `tags[{tag{id,name,slug}}]` (note nested `tag` key inside `tags`).
- Versions GET: `{ items: ArticleVersion[](incl. content, no editorId), title, updatedAt }`.
- Form submissions GET: `{ items, total, page, pageSize, formNames }`.
- Media items: NEVER include `data` (base64). Serve file via `/api/media/{id}/raw`. Items include `uploadedBy{id,name}`.

## Notable behaviors / decisions

- **Create article**: ignores any passed `status` (always DRAFT). Duplicate slug → 409 `این آدرس کوتاه قبلاً استفاده شده است. آدرس دیگری انتخاب کنید.` (no auto-suffix for articles; counter-suffix used for categories/tags only).
- **Update article (PUT)**: `status` in body ignored. Ownership: needs `articles.edit.any`, else `articles.edit.own` + own article, else 403. Authors additionally blocked from editing PUBLISHED/ARCHIVED (403). Optimistic lock: send `baseUpdatedAt` (ISO string from article.updatedAt) → 409 with `data: { conflict: true, serverUpdatedAt }` if stale (>1s). Auto-version snapshot of the OLD state when editing PUBLISHED/APPROVED articles with changed title/excerpt/content.
- **Transition**: `note` required (min 5 chars) only for REJECT (stored in `reviewNote`); reviewNote cleared on all other transitions. `publishedAt` set on PUBLISH only if empty. Notifications: SUBMIT_REVIEW→ADMIN+EDITOR (excludes actor), APPROVE/REJECT/PUBLISH→author.
- **Media upload**: multipart/form-data, field `file` (+ optional `altText`). Errors: 413 size, 415 mime, 400 no file. Images get width/height via sharp (best-effort). `filename` = `Date.now()-slugified-base.ext`.
- **Media delete**: if used as coverImageId by N articles → 409 with `data: { usedBy: N }` unless `?force=true`.
- **Auth errors**: 401 `نشست شما منقضی شده است...`, 403 permission errors — all Persian, handled by `handleApiError`.
- SQLite/Prisma notes: no `mode: 'insensitive'` used (unsupported on SQLite); `createMany` used for tag joins.
- Activity log actions used: CREATE/UPDATE/DELETE/UPLOAD/MODERATE/RESTORE + raw transition actions (SUBMIT_REVIEW, APPROVE, REJECT, PUBLISH, UNPUBLISH, ARCHIVE, BACK_TO_DRAFT). EntityTypes: ARTICLE, CATEGORY, TAG, COMMENT, MEDIA, PAGE, MENU, FORM.
