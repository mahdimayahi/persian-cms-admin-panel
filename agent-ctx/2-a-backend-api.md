# Task 2-a — Backend API for Persian CMS Admin Panel

## Status: COMPLETED

---

# Phase 1 Record — «بررسی اثر تغییر» (spec section 1)

## Files Created / Changed

| File | Action | Description |
|---|---|---|
| `src/lib/impact.ts` | CREATED | computeImpact engine — types `ImpactSeverity/ImpactItem/ImpactGroup/ImpactReport` exactly per spec §1.1; cases: article, category, tag, media, user, page; disclosure rules (`articles.view`/`pages.view` gate items; without permission → `items: []`); max 5 samples per group; report severity = worst group severity; `canDelete = severity !== 'BLOCKING'`; `total` = sum of counts; 404 ApiError (Persian) for missing entities |
| `src/app/api/impact/route.ts` | REWRITTEN | GET `requirePermission('articles.view')`; validates `type` ∈ {article,category,tag,media,user,page} (400 otherwise), `id` required (400); calls `computeImpact`; returns the full `ImpactReport` object |
| `src/app/api/media/[id]/route.ts` | EDITED | DELETE: `?force=true` bypass REMOVED; when `coverImageId` count > 0 → 409 with `{ blocking: true, impact: ImpactReport }`; `requireAuth` + `canManage` logic unchanged; `_req` renamed (no longer uses request) |
| `src/app/api/media/[id]/replace-references/route.ts` | CREATED | POST `requireAuth`; body `{ targetMediaId }`; source 404, target 404 + must differ (400); single transaction `article.updateMany({ coverImageId: sourceId }, { coverImageId: targetId })`; logActivity `REPLACE` «تصویر شاخص N مقاله به فایل دیگر منتقل شد»; returns `{ moved }` |
| `src/app/api/categories/[id]/route.ts` | EDITED | DELETE with strategies: `?strategy=TRANSFER&targetCategoryId=` (target must exist, ≠ id → 400 otherwise) and `?strategy=DETACH`; both run `$transaction[updateMany articles, delete category]` + logActivity mentioning strategy; with articles and no valid strategy → 409 `{ error, data: { blocking: true, impact } }`; zero-article category deletes directly |
| `src/app/api/articles/[id]/route.ts` | EDITED | PUT: `confirmSlugChange`/`registerRedirect` body fields; published-slug guard (409 `{slugChange, oldSlug, newSlug}`; `oldSlug` captured before use); redirect upsert INSIDE existing $transaction + `logActivity('SLUG_CHANGE')` when confirmed + registerRedirect. DELETE rewritten: ownership logic unchanged; one `$transaction` does bundleItem.deleteMany → menuItem.deleteMany (url `/articles/{slug}`) → task.updateMany OPEN→CANCELLED → contentComment.deleteMany → favorite.deleteMany (`itemType:'ARTICLE'` — verified against `favorites/route.ts` FAVORITE_TYPES) → redirect.deleteMany → article.delete; returns `{ ok, cleanup: { bundles, menuItems, tasks, comments, favorites, redirects } }` + Persian logActivity details |
| `src/app/api/pages/[id]/route.ts` | EDITED | PUT: `baseUpdatedAt` optimistic lock (409 «این صفحه پس از باز شدن شما توسط شخص دیگری ویرایش شده است.» `{conflict, serverUpdatedAt}`, 1s tolerance, mirrors articles); published-slug guard mirroring articles; `registerRedirect` → `$transaction[page.update + redirect.upsert fromPath /{oldSlug} → toPath /{newSlug}, entityType 'PAGE']` + logActivity('SLUG_CHANGE'); all pre-existing behavior kept |
| `src/app/api/redirects/route.ts` | CREATED | GET `requirePermission('articles.view')`: optional `entityType`/`entityId` filters, newest first, take 100 → `{ items }`; DELETE `requirePermission('articles.edit.any')`: `?id=` required (400), 404 if missing, deletes + logActivity |

## Exact shape returned by GET /api/impact

```jsonc
{
  "type": "article",            // 'article'|'category'|'tag'|'media'|'user'|'page'
  "id": "cuid",
  "name": "عنوان/نام موجودیت",
  "severity": "INFO",           // worst of groups: INFO < WARNING < BLOCKING
  "canDelete": true,            // false iff severity === 'BLOCKING'
  "total": 3,                   // Σ group.count
  "groups": [                   // only groups with count > 0, engine order
    {
      "key": "bundle",          // published-content|bundle|menu|tasks|redirects|comments|articles|cover|authored|owned|media
      "label": "اجزای بسته‌های انتشار",
      "detail": "از 2 بسته انتشار حذف می‌شود.",
      "dependencyType": "BUNDLE_ITEM", // PUBLISHED_ARTICLE|PUBLISHED_PAGE|BUNDLE_ITEM|MENU_ITEM|OPEN_TASK|REDIRECT_TARGET|CONTENT_COMMENT|CATEGORY_OF_ARTICLE|ARTICLE_TAG|COVER_OF_ARTICLE|AUTHORED_ARTICLE|OWNED_ARTICLE|UPLOADED_MEDIA
      "count": 2,
      "severity": "WARNING",
      "items": [                // max 5; [] when viewer lacks view permission for that entity type
        { "id": "…", "title": "…", "status": "PUBLISHED", "published": true, "link": "#/articles/cuid/edit" }
      ]
    }
  ]
}
```

Group semantics per case — article: `published-content` (WARNING, count 1, only when status=PUBLISHED), `bundle` (WARNING «از N بسته انتشار حذف می‌شود», bundle items link `#/bundles` gated by articles.view), `menu` (WARNING, `MenuItem.url === '/articles/{slug}'`), `tasks` (INFO, OPEN only), `redirects` (INFO, `Redirect.entityType=ARTICLE & entityId`), `comments` (INFO «گفتگوهای آن حذف می‌شود») — category: `articles` BLOCKING «N مقاله بدون دسته‌بندی می‌شوند؛ ابتدا منتقل کنید یا از دسته خارج کنید» — tag: `articles` INFO «برچسب از N مقاله جداسازی می‌شود» — media: `cover` BLOCKING «تصویر شاخص N مقاله است؛ جایگزین کنید یا ارجاع را بردارید» — page: `published-content` (WARNING, only PUBLISHED, item link `#/pages` gated by pages.view) + `menu` (WARNING, `MenuItem.url === '/{slug}'`) — user: authored/owned/media/openTasks all INFO (same labels/details as the legacy route).

## 409 payloads

- **Media DELETE with covers** → `{ "error": "این فایل در حال استفاده است و حذف مستقیم آن مجاز نیست.", "data": { "blocking": true, "impact": <ImpactReport type=media> } }`
- **Category DELETE with articles, no valid strategy** → `{ "error": "این دسته‌بندی مقاله دارد. ابتدا مقالات را منتقل کنید یا از دسته خارج کنید.", "data": { "blocking": true, "impact": <ImpactReport type=category> } }` (unknown strategy values also land here; TRANSFER without/with-bad target → 400 «دستهٔ مقصد…»)
- **Published slug change unconfirmed (article & page)** → `{ "error": "تغییر آدرس محتوای منتشرشده نیاز به تأیید دارد.", "data": { "slugChange": true, "oldSlug": "old-slug", "newSlug": "new-slug" } }`
- **Page stale edit** → `{ "error": "این صفحه پس از باز شدن شما توسط شخص دیگری ویرایش شده است.", "data": { "conflict": true, "serverUpdatedAt": "<ISO>" } }`

## Verification

- `bun run lint`: clean (0 errors/warnings).
- `bunx tsc --noEmit` scoped grep `src/(lib/impact|app/api/(impact|media|categories|articles|pages|redirects))`: 0 errors. Remaining project errors are pre-existing in `examples/` + `skills/` only.
- Did NOT touch: prisma schema, db:push, frontend files, other agents' files, dev server, git.

## Deviations from spec (with reasons)

1. `redirect` upsert's `update` clause also rewrites `entityType` (spec §1.3 update only lists toPath/entityId) — harmless idempotency, keeps entityType correct if a path was previously registered for a different entity type.
2. Category TRANSFER with invalid/missing `targetCategoryId` → 400 Persian errors (spec silent on failure mode of a broken strategy call; 409 would wrongly re-trigger the blocking dialog).
3. Article DELETE logActivity details enumerates cleanup counts (spec says «logActivity با جزئیات»); response `cleanup` also includes `favorites` count per task instruction (spec §1.3 example omits it).
4. `SLUG_CHANGE` logActivity written only when a redirect is actually registered (task text places it in the registerRedirect branch); the generic `UPDATE` log still fires for every save.
5. Impact item titles for `comments` group: first 60 chars of body (fallback authorName) — ContentComment has no title field.
6. Page published-content group uses `dependencyType: 'PUBLISHED_PAGE'` (article uses `PUBLISHED_ARTICLE`) — consistent naming; label/detail identical to article per task.

## Notes for Next Agents

- Frontend 2-b consumes: GET /api/impact (new shape above), 409 `data.blocking` + `data.impact`, 409 `data.slugChange`, POST /api/media/[id]/replace-references `{moved}`, GET/DELETE /api/redirects, article delete response `cleanup` counts.
- `requireAuth`-only on replace-references is per spec/task (no media ownership check) — dialog users can fix references without delete permission.

---

## Phase 0 Record (historical)

## Files Created (14 route handlers, all under src/app/api/)

| File | Description |
|---|---|
| `auth/login/route.ts` | POST login — rate limit 10/10min per IP, uniform 401 (no enumeration), auto-activates INVITED users, blocks DISABLED/SUSPENDED, creates session + logs LOGIN |
| `auth/logout/route.ts` | POST logout — requireAuth, destroys current session, logs LOGOUT |
| `auth/me/route.ts` | GET current user (id, email, name, role, status, lastLoginAt, createdAt) + ROLE_PERMISSIONS of role |
| `auth/change-password/route.ts` | POST — verifies current password, min 8 new, revokes all other sessions (keeps current), logs CHANGE_PASSWORD |
| `auth/sessions/route.ts` | GET list sessions (isCurrent flag, sorted lastSeenAt desc) + DELETE revoke all other sessions (logs REVOKE_SESSIONS) |
| `users/route.ts` | GET list (q/role/status filters, pagination, _count.articles) + POST create INVITED user (409 duplicate email, logs CREATE, notifyUser welcome) |
| `users/[id]/route.ts` | GET single + PUT (self-demote guard, last-active-admin guard, Persian change details, RESET_PASSWORD log, session revoke + notify on SUSPENDED/DISABLED) + DELETE (self guard, last-admin guard, article-count 409 with `{articleCount}`, `?transferToUserId=` transfer, logs DELETE) |
| `dashboard/route.ts` | GET — 9 stats via Promise.all, 14-day publish trend (zero-filled), 6 recent activities, 5 pending-review articles (only with `articles.review`), 4 my drafts |
| `notifications/route.ts` | GET — paginated (default 20, max 50), unreadCount |
| `notifications/read/route.ts` | PUT — mark read by `ids[]` or `all`, scoped to current user |
| `activity/route.ts` | GET — q/action/entityType filters, pagination, `actions` list for filter dropdown |
| `settings/route.ts` | GET object of all settings + PUT upsert (allow-list of 8 keys, siteName required, logs UPDATE SETTINGS) |
| `search/route.ts` | GET — q min 2 chars, 5 results per group (articles, pages, media, users gated by `users.view`) |
| `reports/route.ts` | GET — articlesByStatus (6, zero-filled), articlesByCategory (incl. «بدون دسته‌بندی»), 30-day publishTrend (zero-filled), topArticles 5, commentsByStatus, formsByStatus, storageUsed, usersByRole |

## Notes for Next Agents (Frontend 2-b)

- All success responses are JSON via `ok()`; errors via `fail(status, message, data?)` → shape `{ error: string, data?: unknown }`.
- Dynamic routes use Next 16 async params: `const { id } = await params`.
- No `passwordHash` is ever returned anywhere (verified by grep).
- Users list item shape: `{ id, email, name, role, status, createdAt, updatedAt, lastLoginAt, _count: { articles } }`; POST create returns `{ user }` in same shape.

## ⚠️ Pre-existing Bug Found in src/lib/audit.ts (NOT fixed — lib files are off-limits per task rules)

`notifyUser()` (line ~60) references `input.userId`, but `userId` is a separate function parameter. This compiles as `undefined`, so **Prisma throws a validation error inside the try/catch and NO notification is ever created** by `notifyUser()`. `notifyUsers()` (plural, roles-based) is unaffected.

One-token fix for whoever owns `src/lib/*`: change `userId: input.userId` → `userId` in `notifyUser`'s `db.notification.create` call. My routes call `notifyUser(...)` exactly per spec and will work immediately once fixed; until then those notifications are silently skipped (console shows `[notifyUser] failed`).

## Deviations from Spec

1. `usersByRole` in reports includes a `label` (Persian role name) alongside `{role, count}` — additive, for dropdown convenience.
2. DELETE user: Prisma default `Restrict` on required `Media.uploadedBy` relation means deleting a user with media would throw P2003; handled as 409 with Persian message «این کاربر فایل رسانه‌ای بارگذاری کرده است...» (spec only covered articles).
3. Trend windows anchored to start-of-UTC-day (14/30 days ending today) instead of raw `now - N*86400000` — keeps chart buckets exact; still within spec's query window.
4. PUT user with empty change set returns 400 «تغییری برای اعمال ارسال نشده است.» (spec silent on this case).

## Verification

- `tsc --noEmit`: **zero errors in src/app/api/**. Remaining tsc errors are pre-existing in `examples/`, `skills/`, and the `src/lib/audit.ts` bug above.
- Did not run lint/dev/db:push/build per task rules.
