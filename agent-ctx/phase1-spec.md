# مشخصات مرحله ۱ — «بررسی اثر تغییر»، «همکاری تیمی» و «مرکز عملیات»

> این سند قرارداد رسمی پیاده‌سازی است. هر تغییر در قرارداد باید همین‌جا به‌روز شود.

## ۰. پیش‌نیازهای مشترک — وضعیت موجود و تصمیم‌ها

| پیش‌نیاز | وضعیت | تصمیم |
|---|---|---|
| شناسه پایدار موجودیت‌ها | CUID از قبل در همه مدل‌ها | بدون تغییر |
| قرارداد مجوزها | `roleHasPermission` + `requirePermission` | بدون کلید مجوز جدید؛ استفاده از کلیدهای موجود |
| ثبت رویداد و سابقه | `logActivity` / `notifyUser` از `@/lib/audit` | همهٔ اقدامات حساس (حذف با پاک‌سازی، تعویض slug، جایگزینی رسانه، تلاش مجدد) ثبت شوند |
| کنترل تعارض نسخه | مقاله: `baseUpdatedAt` → 409 وجود دارد | صفحه: همان الگو اضافه شود |
| قرارداد اعلان‌ها | مدل Notification مشترک | بدون زیرساخت اعلان جدید |
| مرزبندی سازمان‌ها | سامانه تک‌سازمانی است | خارج از نسخه اول؛ مستند شده |

## ۱. بررسی اثر تغییر (Change Impact)

### ۱.۱ موتور: `src/lib/impact.ts` (جدید)

```ts
export type ImpactSeverity = 'INFO' | 'WARNING' | 'BLOCKING'
export type ImpactItem = {
  id: string
  title: string
  status?: string | null      // وضعیت محتوا (DRAFT | PUBLISHED | ...) یا null
  published: boolean          // خلاصه برای چیپ وضعیت
  link?: string | null        // مسیر داخلی مثل '#/articles/x/edit' — فقط با مجوز مشاهده، وگرنه null
}
export type ImpactGroup = {
  key: string                 // 'cover' | 'articles' | 'menu' | 'bundle' | ...
  label: string               // عنوان فارسی گروه
  detail: string              // اثر حذف (فارسی، ارقام لاتین — کلاینت فا می‌کند)
  dependencyType: string      // 'COVER_OF_ARTICLE' | 'CATEGORY_OF_ARTICLE' | ...
  count: number
  severity: ImpactSeverity
  items: ImpactItem[]         // حداکثر ۵ نمونه
}
export type ImpactReport = {
  type: 'article' | 'category' | 'tag' | 'media' | 'user' | 'page'
  id: string
  name: string
  severity: ImpactSeverity    // بدترین شدت گروه‌ها
  canDelete: boolean          // severity === 'BLOCKING' → false
  total: number               // مجموع count گروه‌ها
  groups: ImpactGroup[]
}
export async function computeImpact(
  type: string, id: string,
  viewer: { id: string; role: string }
): Promise<ImpactReport>
```

**قواعد افشا:** عنوان/لینک آیتم‌ها فقط اگر بیننده مجوز مشاهدهٔ آن نوع را دارد (`articles.view` برای مقاله، `pages.view` برای صفحه)؛ در غیر این صورت `items: []` و فقط count + detail عمومی.

### ۱.۲ سیاست شدت (نسخه اول)

| حذف/تغییر | گروه | وابستگی | شدت | سیاست |
|---|---|---|---|---|
| رسانه | تصویر شاخص مقالات | `coverImageId` | **BLOCKING** | جایگزینی ارجاع‌ها یا رفع آن‌ها؛ سپس حذف |
| دسته‌بندی | مقالات دسته | `categoryId` | **BLOCKING** | انتقال به دستهٔ دیگر یا خروج از دسته |
| مقاله | اجزای بسته‌های انتشار | `BundleItem` | WARNING | حذف خودکار جزء از بسته‌ها هنگام حذف مقاله |
| مقاله | آیتم‌های منو | `MenuItem.url === '/articles/{slug}'` | WARNING | حذف خودکار آیتم منو |
| مقاله | کارهای باز | `Task(relatedType=ARTICLE)` | INFO | بستن خودکار (CANCELLED) |
| مقاله | ریدایرکت‌های مقصد | `Redirect(entityId)` | INFO | حذف خودکار |
| برچسب | مقالات برچسب‌خورده | `ArticleTag` | INFO | جداسازی خودکار |
| صفحه | آیتم‌های منو | `MenuItem.url === '/{slug}'` | WARNING | حذف خودکار آیتم منو |
| کاربر | مانند فعلی (نوشته‌ها/مالکیت/فایل/کار باز) | — | INFO | بدون تغییر رفتار |

- «بلوک مشترک» مستقل در اسکیمای فعلی وجود ندارد؛ نزدیک‌ترین معادل (منو/صفحه) پوشش داده شد و مدل بلوک آینده به همین موتور یک case اضافه می‌کند. **مرز نسخه اول:** ارجاع‌های ساختاریافته درون سامانه؛ کشف لینک داخل HTML محتوا تضمین نمی‌شود.

### ۱.۳ قرارداد API

- `GET /api/impact?type=article|category|tag|media|user|page&id=...` → `ImpactReport` (بازنویسی کامل route فعلی؛消费者: impact-dialog)
- `DELETE /api/media/[id]` → اگر پوشش تصویر شاخص دارد: **409** `{ error, data: { blocking: true, impact: ImpactReport } }` — **bypass ?force=true حذف می‌شود**
- `POST /api/media/[id]/replace-references` بدنه `{ targetMediaId }` → جایگزینی همهٔ coverImageIdها در تراکنش → `{ moved: n }` + logActivity('REPLACE')
- `DELETE /api/categories/[id]?strategy=TRANSFER&targetCategoryId=...` یا `?strategy=DETACH` → اگر مقاله دارد و strategy نیست: **409** `{ error, data: { blocking: true, impact } }`؛ با strategy در یک تراکنش انتقال/جدا‌سازی + حذف + logActivity
- `DELETE /api/articles/[id]` → بدون مسدودکننده؛ پاک‌سازی در تراکنش (بسته‌ها، آیتم منو، کارهای باز→CANCELLED، گفتگوها، علاقه‌مندی‌ها، ریدایرکت‌ها) → `{ ok, cleanup: { bundles, menuItems, tasks, comments, redirects } }` + logActivity با جزئیات
- `PUT /api/articles/[id]` فیلدهای جدید: `confirmSlugChange?: boolean`، `registerRedirect?: boolean`
  - تغییر slug مقالهٔ PUBLISHED بدون `confirmSlugChange` → **409** `{ error, data: { slugChange: true, oldSlug, newSlug } }`
  - با `registerRedirect: true` → ساخت/upsert `Redirect` ازPath `/articles/{oldSlug}` به `/articles/{newSlug}` + logActivity('SLUG_CHANGE')
- `PUT /api/pages/[id]` → همان گارد برای صفحهٔ PUBLISHED (fromPath `/{oldSlug}`) + قفل خوش‌بینانه `baseUpdatedAt`
- `GET /api/redirects?entityType=ARTICLE&entityId=...` → `{ items }` (مجوز articles.view)؛ `DELETE /api/redirects?id=...` (مجوز articles.edit.any)

### ۱.۴ مدل Redirect (جدید)

```prisma
model Redirect {
  id            String   @id @default(cuid())
  fromPath      String   @unique
  toPath        String
  kind          String   @default("SLUG_CHANGE") // SLUG_CHANGE | MANUAL
  entityType    String?  // ARTICLE | PAGE
  entityId      String?
  createdById   String?
  createdByName String?
  createdAt     DateTime @default(now())
  @@index([entityType, entityId])
}
```

## ۲. همکاری تیمی — گفتگوی رکوردی

### ۲.۱ مدل: توسعهٔ `ContentComment`

```prisma
parentId   String?                                    // رشته پاسخ (عمق ۱)
parent     ContentComment? @relation("CommentThread", fields: [parentId], references: [id], onDelete: Cascade)
replies    ContentComment[] @relation("CommentThread")
versionRef String?                                    // اتصال اختیاری به نسخه مقاله
@@index([parentId])
```

### ۲.۲ دسترسی

- مشاهده/مشارکت گفتگوی ARTICLE → `articles.view`؛ PAGE → `pages.view` (در هر GET/POST/PATCH چک می‌شود؛ پس از تغییر مجوز، دسترسی خودبه‌خود به‌روز است)
- منشن، دسترسی نمی‌سازد — فقط اعلان می‌سازد
- مدیریت (حل/بازگشایی/انتقال مسئول/حذف): نویسندهٔ ردیف یا `articles.review` (مقاله) / `pages.manage` (صفحه)

### ۲.۳ قرارداد API (بازنویسی comments-panel)

- `GET /api/comments-panel?entityType&entityId` → `{ items: CommentRow[] (مسطح؛ کلاینت رشته می‌سازد), openCount }`؛ CommentRow شامل `parentId: string|null`, `versionRef: string|null`
- `POST /api/comments-panel` بدنه `{ entityType, entityId, body, mentions?, assigneeId?, parentId?, versionRef? }`
  - پاسخ به رشته: `parentId` الزامی معتبر با همان entityType/entityId؛ در پاسخ، assignee نادیده گرفته می‌شود
  - تعیین مسئول روی رشتهٔ اصلی → ساخت/انتقال کار در کارتابل: Task(relatedType='CONTENT_COMMENT', relatedId=threadId, type='REVISION' برای مقاله، link=`#/articles/{id}/edit`، priority='MEDIUM') — اگر کار OPEN برای همان رشته هست، فقط مسئولش عوض می‌شود (بدون کار تکراری)
  - اعلان (نوع MENTION): منشن‌شدگان + مسئول + (در پاسخ: نویسندهٔ رشته) بدون خود فرستنده
- `PATCH /api/comments-panel/[id]` بدنه `{ action: 'RESOLVE'|'REOPEN'|'ASSIGN', assigneeId? }`
  - RESOLVE → resolvedAt/By + بستن کارهای OPEN مرتبط با رشته (DONE) + اعلان به نویسندهٔ رشته/مسئول (جز خودِ انجام‌دهنده)
  - REOPEN → OPEN + بازگشایی کار مرتبط (OPEN، doneAt=null؛ اگر نبود، بساز)
  - ASSIGN → تغییر مسئول + انتقال/ساخت کار + اعلان مسئول جدید
- `DELETE` موجود می‌ماند (نویسنده یا مجوز مدیریت؛ حذف رشته، پاسخ‌ها را کاسکید حذف می‌کند)

### ۲.۴ اتصال‌ها

- کارت ابژکت در «کارهای من» به‌طور خودکار از روی Task نمایش داده می‌شود (زیرساخت فعلی) — بدون تغییر tasks-center
- گفتگوی حل‌شده در پیش‌نمایش/گزارش عمومی نمایش داده نمی‌شود (پیش‌فرض فیلتر OPEN در UI حفظ شده)

## ۳. مرکز عملیات و بازیابی خطا

### ۳.۱ مدل‌ها

```prisma
model OperationLog {
  // فیلدهای فعلی + موارد زیر؛ مقدار پیش‌فرض status → "QUEUED"
  status          String @default("QUEUED") // QUEUED | RUNNING | SUCCESS | PARTIAL | FAILED | CANCEL_REQUESTED | CANCELLED
  startedAt       DateTime?
  heartbeatAt     DateTime?
  cancelRequested Boolean @default(false)
  retryOfId       String?   // عملیات اصلی در «تلاش مجدد»
  items           OperationItem[]
  @@index([status])
}

model OperationItem {
  id          String   @id @default(cuid())
  operationId String
  operation   OperationLog @relation(fields: [operationId], references: [id], onDelete: Cascade)
  refType     String   // ARTICLE | ...
  refId       String
  label       String
  status      String   @default("PENDING") // PENDING | SUCCEEDED | FAILED | SKIPPED | CANCELLED
  message     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([operationId, status])
}
```

### ۳.۲ موتور: `src/lib/operations.ts` (جدید)

- `startOperation(def, actor)` → OperationLog(QUEUED) + آیتم‌ها(PENDING) → اجرای نامتزامن (`void runOperation(id)` پس از پاسخ 202)
- `runOperation`: status=RUNNING+startedAt؛ برای هر آیتم: اگر `cancelRequested` → آیتم CANCELLED و پایان؛ وگرنه `runItem` + ثبت نتیجه و heartbeatAt=now در هر گام؛ پایان: SUCCESS/PARTIAL/FAILED + resultSummary + finishedAt
- `sweepStaleOperations()`: هر op با status RUNNING و heartbeatAt قدیمی‌تر از ۹۰ ثانیه → FAILED + پیام «پردازشگر قطع شد» + آیتم‌های PENDING→FAILED — در ابتدای همهٔ GETها فراخوانی می‌شود (بستن مرورگر/قطع پردازشگر، op را برای همیشه RUNNING نمی‌گذارد)
- `retryOperation(id, actor)`: فقط برای opهای تمام‌شده؛ چک مجوز متناظر در لحظهٔ درخواست؛ op جدید با `retryOfId` و **فقط آیتم‌های FAILED** → بدون تکرار اثرهای موفق قبلی
- `cancelOperation(id)`: QUEUED → CANCELLED فوری؛ RUNNING → `cancelRequested=true` (در گام بعدی متوقف می‌شود؛ اگر آیتم موفقی داشت → PARTIAL وگرنه CANCELLED)

### ۳.۳ عملیات نسخه اول

| type | مجوز | رفتار هر آیتم |
|---|---|---|
| `BULK_PUBLISH_ARTICLES` | `articles.publish` | APPROVED → انتشار + بستن کارها + اعلان نویسنده + logActivity؛ PUBLISHED → SUCCEEDED «از قبل منتشر شده بود»؛ بقیه → FAILED با دلیل |
| `BULK_UNPUBLISH_ARTICLES` | `articles.publish` | PUBLISHED → DRAFT + publishedAt=null + logActivity؛ بقیه → FAILED «منتشر نشده بود» |

### ۳.۴ قرارداد API

- `POST /api/operations` بدنه `{ type, articleIds: string[] }` → **202** `{ id, status: 'QUEUED' }` (حداکثر ۱۰۰ مورد؛ اعتبارسنجی وجود مقاله‌ها)
- `GET /api/operations` → sweep + ۵۰ مورد آخر `{ items: [...] , errors: parsed }` (opهای قدیمی بدون آیتم هم باید کار کنند)
- `GET /api/operations/[id]` → `{ operation, items }` (آیتم‌ها به ترتیب ایجاد)
- `POST /api/operations/[id]/retry` → **202** `{ id }` عملیات جدید
- `POST /api/operations/[id]/cancel` → `{ ok, status }`
- `GET /api/operations/[id]/report` → پاسخ `text/csv` (ستون‌ها: مورد، شناسه، وضعیت، پیام) — بدون داده حساس

### ۳.۵ تفاوت «تلاش مجدد» و «بازگردانی»

نسخه اول فقط تلاش مجدد آیتم‌های ناموفق را دارد؛ «بازگردانی عمومی» (undo) خارج از محدوده است.

## ۴. قراردادهای فرانت‌اند

### ۴.۱ ImpactDialog نسخه ۲ (`shared/impact-dialog.tsx`)
- props سازگار با قبل: `{ target: { type: ImpactType; id: string; name: string } | null, onClose, onDelete, onDeleted }` — `ImpactType = 'article'|'category'|'tag'|'media'|'user'|'page'` و `onDelete: (opts?: { strategy?: 'TRANSFER'|'DETACH'; targetCategoryId?: string }) => Promise<void>`
- نشان شدت: INFO خاکستری «اطلاع‌رسانی»، WARNING کهربایی «هشدار»، BLOCKING سرخابی «مسدودکننده»
- هر آیتم: چیپ وضعیت («منتشرشده» سبز / «پیش‌نویس» خاکستری) + لینک مشاهده فقط وقتی link هست
- BLOCKING: دکمهٔ حذف غیرفعال + بخش «راه اصلاح»:
  - media: انتخاب رسانهٔ جایگزین (media-picker موجود) → POST replace-references → بارگیری مجدد گزارش
  - category: رادیو «انتقال مقالات به دستهٔ دیگر» (Select دسته‌ها از GET /api/categories) / «خروج مقالات از دسته» → onDelete با strategy
- حساب‌رسیدگی: پس از هر حذف موفق، توست + refresh والد

### ۴.۲ ویرایشگر مقاله — گارد تغییر آدرس منتشرشده
- هنگام ذخیره، اگر PUT با 409 `data.slugChange` برگشت → AlertDialog: نمایش oldSlug → newSlug + چک‌باکس «ثبت ریدایرکت از آدرس قبلی» (پیش‌فرض روشن) + سه دکمه: انصراف / ذخیره با ریدایرکت / ذخیره بدون ریدایرکت → ارسال مجدد با `confirmSlugChange: true` و `registerRedirect`

### ۴.۳ ویو عملیات (`views/operations-view.tsx`)
- وضعیت‌های جدید QUEUED/ CANCEL_REQUESTED/ CANCELLED + برچسب فارسی
- بازکردن جزئیات هر op → GET /api/operations/[id] → جدول آیتم‌ها (برچسب، وضعیت چیپ، پیام)؛ opهای قدیمی بدون آیتم → fallback به errors
- دکمه‌ها: «تلاش مجدد» (فقط FAILED/PARTIAL → POST retry → toast + refresh)، «لغو» (QUEUED/RUNNING → POST cancel)، «دانلود گزارش» از items (downloadCsv موجود)
- نظرسنجی ۵ ثانیه تا وقتی op فعال هست

### ۴.۴ ویو مقالات (`views/articles-view.tsx`)
- «انتشار» گروهی → POST /api/operations (BULK_PUBLISH_ARTICLES) + توست «عملیات در مرکز عملیات آغاز شد» + لینک
- دکمهٔ جدید «لغو انتشار» گروهی → BULK_UNPUBLISH_ARTICLES
- حذف تک‌مقاله → ImpactDialog با type 'article' (به‌جای تأیید ساده)؛ «بایگانی» گروهی به‌صورت فعلی می‌ماند

## ۵. سناریوهای پذیرش پایان مرحله

1. **حذف تصویر استفاده‌شده:** ImpactDialog محل‌های استفاده (شاخص N مقاله با وضعیت) را نشان می‌دهد؛ حذف مستقیم UI و API (بدون جایگزینی) با 409 مسدود می‌شود؛ پس از جایگزینی ارجاع‌ها، حذف موفق است.
2. **درخواست اصلاح محتوا:** گفتگو ساخته می‌شود، مسئول می‌گیرد → کار در «کارهای من» ظاهر می‌شود → پاسخ در رشته ثبت می‌شود → RESOLVE کار را می‌بندد و گفتگو «حل‌شده» می‌شود؛ REOPEN برمی‌گرداند.
3. **عملیات دسته‌ای با شکست جزئی:** انتشار گروهی مقالات با وضعیت‌های مختلف → op در مرکز عملیات با نتیجهٔ تک‌تک موارد؛ «تلاش مجدد» فقط ناموفق‌ها را اجرا می‌کند و مقاله‌های از قبل منتشرشده دست‌نخورده می‌مانند؛ «لغو» حین اجرا متوقف می‌کند.
