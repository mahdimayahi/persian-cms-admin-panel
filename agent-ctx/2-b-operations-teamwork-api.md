# Task 2-b — Backend: Team Collaboration (§2) + Operations Center (§3)

Agent: 2-b (operations-teamwork-api) | Binding contract: `agent-ctx/phase1-spec.md` sections 2 and 3.
Scope: `src/lib/operations.ts`, `src/app/api/comments-panel/**`, `src/app/api/operations/**` ONLY.
Schema already pushed by orchestrator (ContentComment parentId/versionRef, OperationLog QUEUED/heartbeat/cancelRequested/retryOfId, OperationItem) — `db:push` NOT run. Dev server NOT run.

## Files created / rewritten (8)

| # | Path | Change |
|---|------|--------|
| 1 | `src/lib/operations.ts` | NEW — async operation engine (see below) |
| 2 | `src/app/api/comments-panel/route.ts` | REWRITTEN — GET + POST per spec §2.3 |
| 3 | `src/app/api/comments-panel/[id]/route.ts` | REWRITTEN — PATCH actions RESOLVE/REOPEN/ASSIGN, DELETE with replies cascade + task cancellation; convert-to-task POST kept intact |
| 4 | `src/app/api/operations/route.ts` | REWRITTEN — GET list (sweep + latest 50) + POST bulk start → 202 (old client-registered op POST replaced per task instructions) |
| 5 | `src/app/api/operations/[id]/route.ts` | NEW — GET detail `{ operation, items }` |
| 6 | `src/app/api/operations/[id]/retry/route.ts` | NEW — POST → 202 `{ id, status: 'QUEUED' }` |
| 7 | `src/app/api/operations/[id]/cancel/route.ts` | NEW — POST → `{ ok: true, status }` |
| 8 | `src/app/api/operations/[id]/report/route.ts` | NEW — GET CSV (BOM `\uFEFF`, headers `مورد,شناسه,وضعیت,پیام`) |

## API contract (exact shapes)

### GET /api/comments-panel?entityType&entityId
Permission: `articles.view` (ARTICLE) / `pages.view` (PAGE) via requirePermission; entity lookup → 404 `«مقاله یافت نشد.»` / `«صفحه یافت نشد.»`.
```json
{ "items": [ { ...ContentComment, "mentions": ["id", ...] } ], "openCount": 3 }
```
Rows flat, `orderBy createdAt asc`; include `parentId: string|null`, `versionRef: string|null`, `status`, `assigneeId/Name`, `resolvedAt/ByName`.

### POST /api/comments-panel
Permission same as GET + entity existence. Body `{ entityType, entityId, body, mentions?, assigneeId?, parentId?, versionRef? }`.
- Reply (`parentId`): parent must exist with same entityType+entityId → 400 `«رشتهٔ والد یافت نشد یا به همین محتوا تعلق ندارد.»`; reply ignores assigneeId; status stays `OPEN`.
- Thread with ACTIVE assignee: upsert Task where `relatedType='CONTENT_COMMENT' AND relatedId=threadId AND status='OPEN'` (update assignedToId/assignedById/assignedByName/title/link, else create `title: 'گفتگو: ' + body.slice(0,60)`, `type: ARTICLE→'REVISION' | PAGE→'GENERAL'`, `priority:'MEDIUM'`, `link: '#/articles/{id}/edit' | '#/pages'`). threadId = created comment id (thread) or parentId (reply); replies never get tasks.
- Notifications type `MENTION` `«{user.name} در گفتگویی از شما نام برد»` to mentions + assignee + (reply → thread author) except self; link = editor link.
- Response 201: `{ ...comment, mentions: string[] }`.

### PATCH /api/comments-panel/[id]  body `{ action: 'RESOLVE'|'REOPEN'|'ASSIGN', assigneeId? }`
Permission: row author OR `articles.review` (ARTICLE) / `pages.manage` (PAGE).
- RESOLVE (thread only; reply → 400): `status='RESOLVED', resolvedAt, resolvedByName`; tasks `relatedType='CONTENT_COMMENT', relatedId=row.id, status:'OPEN'` → `DONE`+doneAt; notify thread author + assignee (except actor) type `DISCUSSION` `«گفتگو حل شد»`.
- REOPEN: `status='OPEN', resolvedAt=null, resolvedByName=null`; DONE tasks → `OPEN`, doneAt=null; if 0 affected AND row.assigneeId → recreate task (same shape as POST).
- ASSIGN: assigneeId must be ACTIVE user; row assignee updated; linked OPEN task upserted (threadId = parentId ?? row.id); notify assignee type `DISCUSSION` `«مسئول گفتگو شدید»`.
- Response: `{ ...row, mentions: string[] }`.
- DELETE: same permission; replies deleted (deleteMany + Prisma cascade), open tasks of thread → `CANCELLED`, then row deleted → `{ ok: true }`.
- POST (convert-to-task): unchanged legacy behavior (kept intact per instructions).

### GET /api/operations
```json
{ "items": [ { ...OperationLog, "errors": [{"item":"...","reason":"..."}] } ] }
```
Latest 50, `createdAt desc`. Status may be QUEUED / RUNNING / CANCEL_REQUESTED (i.e. RUNNING+cancelRequested) / SUCCESS / PARTIAL / FAILED / CANCELLED. Runs `sweepStaleOperations()` first. Old ops without items work (errors from errorsJson).

### POST /api/operations  → 202
Permission `articles.publish`. Body `{ type: 'BULK_PUBLISH_ARTICLES'|'BULK_UNPUBLISH_ARTICLES', articleIds: string[] }`. Validates array of non-empty strings, dedupe, 1..100 → Persian 400s (`«فهرست مقالات باید آرایه باشد.»`, `«فهرست مقالات خالی است.»`, `«حداکثر 100 مورد در هر عملیات مجاز است.»`).
Response: `{ "id": "<opId>", "status": "QUEUED" }` with HTTP 202.

### GET /api/operations/[id]
```json
{ "operation": { ...OperationLog, "errors": [...] }, "items": [ {...OperationItem} ] }
```
Items `createdAt asc`. 404 `«عملیات یافت نشد.»`. Sweep runs first.

### POST /api/operations/[id]/retry → 202 `{ "id": "<newOpId>", "status": "QUEUED" }`
Permission `articles.publish`. Only final statuses SUCCESS/PARTIAL/FAILED; only FAILED items copied into new op (`title: 'تلاش مجدد: ' + op.title`, `retryOfId`), success effects never re-run. 400s: `«فقط عملیات تمام‌شده قابل تلاش مجدد است.»`, `«مورد ناموفقی برای تلاش مجدد وجود ندارد.»`.

### POST /api/operations/[id]/cancel → `{ "ok": true, "status": "<final status>" }`
Permission `articles.publish`.

### GET /api/operations/[id]/report
`text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="operation-{id}.csv"`. BOM `\uFEFF`, header `مورد,شناسه,وضعیت,پیام`, cells CSV-escaped; status rendered in Persian (در انتظار/موفق/ناموفق/ردشده/لغوشده); ops without items fall back to errorsJson rows.

## Engine mechanics (src/lib/operations.ts)

- `startBulkArticleOperation(type, ids, actor)`: fetch articles (id/title/status); zero found → 400 `«هیچ مقالهٔ معتبری برای این عملیات یافت نشد.»` (only found articles become items — missing ids are dropped, not failed items). Creates QUEUED op + PENDING items, then `void runOperation(opId)` (not awaited).
- `runOperation`: sets RUNNING+startedAt+heartbeatAt → per item: re-read op (`cancelRequested` / deleted → all remaining PENDING items `CANCELLED`, break), heartbeat=now, runItem inside try/catch (errors → item FAILED with message or Persian fallback `«خطای نامشخص در اجرای مورد.»`).
  - BULK_PUBLISH_ARTICLES: APPROVED → PUBLISHED+publishedAt, close open ARTICLE REVIEW/REVISION tasks, notifyUser author (`PUBLISHED`), logActivity PUBLISH, message `«منتشر شد.»`; PUBLISHED → SUCCEEDED `«از قبل منتشر شده بود.»` with NO article write; else FAILED with bundle-runner Persian reasons.
  - BULK_UNPUBLISH_ARTICLES: PUBLISHED → DRAFT+publishedAt=null+logActivity UNPUBLISH `«لغو انتشار شد.»`; else FAILED `«مقاله منتشر نشده بود.»`; missing article FAILED `«مقاله یافت نشد.»`.
  - finish: doneItems=SUCCEEDED count, failedItems=FAILED count; status = cancelled&&done>0 → PARTIAL, cancelled → CANCELLED, failed==0 → SUCCESS, done==0 → FAILED, else PARTIAL; resultSummary `«N مورد موفق؛ M مورد ناموفق.»` + `« عملیات لغو شد.»` when cancelled; errorsJson from FAILED items; finishedAt=now.
- Cancellation/stale-sweep: `cancelOperation` — QUEUED → immediate CANCELLED (+items PENDING→CANCELLED); RUNNING → only `cancelRequested=true`, processor stops at next item step; final status re-read and returned. `sweepStaleOperations()` — RUNNING ops whose heartbeatAt (fallback startedAt) is older than 90s (or both null) → FAILED, `«پردازشگر قطع شد و عملیات ناتمام ماند.»`, PENDING items → FAILED `«به‌دلیل قطع پردازشگر اجرا نشد.»`, errorsJson from them, counts refreshed, finishedAt=now. Called at the start of every operations GET (list/detail/report) so a dead processor never leaves an op RUNNING forever.

## Deviations (with reasons)

1. **Sweep also refreshes doneItems/failedItems** when marking a stale op FAILED — instruction didn't mention counts, but leaving them stale would corrupt the list view; recomputed from items.
2. **Final status uses a local `wasCancelled` flag** (observed during the item loop) instead of re-reading `cancelRequested` after the loop — avoids marking an op PARTIAL when cancel was requested after the last item already succeeded; matches spec §3.2 semantics («اگر آیتم موفقی داشت → PARTIAL وگرنه CANCELLED»).
3. **REOPEN also clears `resolvedByName=null`** (instruction listed only resolvedAt=null) — consistent with previous route behavior.
4. **REOPEN reopens tasks with `status:'DONE'` filter** (only tasks closed by RESOLVE), per "reopen tasks" intent; zero affected + assigneeId → task recreated via same upsert shape.
5. **ASSIGN on a reply row** links the task to the thread (`parentId ?? row.id`) so no orphan task is keyed by a reply id; UI only exposes ASSIGN on threads anyway.
6. **logActivity added on retry/cancel routes** (`RETRY` / `CANCEL` on entityType OPERATION_LOG) — spec §0 requires sensitive actions (incl. تلاش مجدد) to be audited; task text was silent on it.
7. Old POST /api/operations contract (client-registered MEDIA_UPLOAD/CSV_EXPORT ops) intentionally removed per task instruction ("REWRITE"); old rows still render in GET (errors parsed, no items).

## Verification

- `bun run lint` → clean.
- `bunx tsc --noEmit` → zero errors in `src/lib/operations.ts`, `src/app/api/operations/**`, `src/app/api/comments-panel/**` (remaining project errors only in `examples/` + `skills/`, owned by others).
- Runtime probe not possible: dev server on :3000 was down at verification time (gateway :81 → 502); dev server is system-managed and must not be started by agents.
