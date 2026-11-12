# Task 2-a — Backend API for Persian CMS Admin Panel

## Status: COMPLETED

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
