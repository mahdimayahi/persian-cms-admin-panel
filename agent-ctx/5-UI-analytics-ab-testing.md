# مرحله ۴ — سنجش نتیجه محتوا و آزمایش A/B (تکمیل‌شده)

تاریخ: ۱۴۰۵/۰۹/۰۲ (Asia/Tehran) — وضعیت: پذیرش مرورگری کامل، آمادهٔ commit

## چه ساخته شد

### Schema (prisma/schema.prisma)
- `ContentGoal` — هدف محتوا با قرارداد شاخص: successEvent، metricLabel، metricNumerator/Denominator (تعریف ثابت صورت/مخرج)، attributionRule (AFTER_FIRST_VIEW | SAME_SESSION)، attributionHours، owner، رابطه با Article
- `AnalyticsEvent` — قرارداد رویداد محدود (PAGE_VIEW/CTA_CLICK/FORM_START/FORM_SUCCESS/FORM_INVALID/SIGNUP/PURCHASE)، eventId یکتا (ضد شمارش تکراری)، visitorId مستعار، referrer پالایش‌شده، پرچم‌های isInternal/isBot/isConsented/isSimulated
- `EventIngestLog` — دفتر پذیرش (ACCEPTED/DUPLICATE/INVALID) برای شفافیت کیفیت داده
- `Experiment` + `ExperimentAssignment` (تخصیص پایدار + firstExposedAt + convertedAt یکتا) + `ExperimentHistory`
- روابط Experiment/ContentGoal → Article (Cascade)

### Lib
- `src/lib/analytics.ts` — normalizeEvent (اعتبارسنجی، sanitizeReferrer، detectBot با ~۲۰ الگو، detectInternal با clientHint)، tehranDay با Intl، computeGoalReport (قیف ترتیبی، نرخ با CI ویلسون، مقایسهٔ بازهٔ قبل با جملهٔ احتیاط، روند، کیفیت داده، hasSufficientData)، wilsonCI/diffCI/srmCheck (chi2 df=1 با تقریب erf)، attributeExperimentConversion (ضد دوباره‌شماری، گروه از تخصیص سرور)
- `src/lib/experiments.ts` — stableAssignGroup (sha256 قطعی)، runPreflight (۷ بررسی: اتصال نسخه، تأیید محتوا، یک آزمایش برای هر محل، شاخص‌ها، برنامهٔ نمونه، A/A، هشدار ترافیک کم)، computeExperimentResults (گروه‌ها، SRM، شاخص‌های محافظ، پیشرفت، readiness اطلاعاتی، هشدارهای کیفیت، dataCaveats)

### API
- `POST/GET /api/analytics/events` — پذیرش تکی/دسته‌ای (rate-limit، بدون احراز هویت مانند endpoint عمومی) + فهرست شفاف
- `GET /api/analytics/quality` — پوشش، خارج‌شده‌ها، دفتر پذیرش، تأخیر به‌روزرسانی
- `POST /api/analytics/demo-setup` — صفحهٔ معرفی خدمت + هدف نمایشی
- `GET/POST /api/goals`، `GET/PATCH/DELETE /api/goals/[id]` (بایگانی به‌جای حذف)، `GET /api/goals/[id]/report`
- `GET/POST /api/experiments`، `GET/PATCH /api/experiments/[id]` (ویرایش فقط DRAFT)، `POST .../actions` (PREFLIGHT/START/PAUSE/RESUME/EMERGENCY_STOP/END/DECISION/INVALIDATE)، `POST .../assign` (fallback کنترل وقتی غیر RUNNING)، `POST .../expose` (occurredAt اختیاری با اعتبارسنجی ≥ startedAt)، `GET .../results`
- `GET /api/articles/[id]/performance`

### UI
- `outcomes-view.tsx` — سه تب: اهداف و نتایج (لیست + داشبورد: تعریف شاخص، KPI، قیف، روند recharts، کیفیت، سابقهٔ انتشار)، کیفیت دادهٔ رویدادها (رویدادهای اخیر با نشان‌ها)، شبیه‌ساز ترافیک (پارامترهای قیف، ربات/داخلی/بدون رضایت، تکرار رویداد، اثر نسخهٔ B، seed پایدار)
- `experiments-view.tsx` — لیست + جزئیات (طرح/بررسی فنی/نتایج/سابقه) + dialog تعریف (حالت A/A) + dialog تصمیم ۴ گزینه‌ای + dialog توقف اضطراری
- `article-performance.tsx` — تب «عملکرد» در ویرایشگر مقاله (analytics.view)
- nav: «اهداف و نتایج محتوا» + «آزمایش A/B» با perm analytics.view؛ مجوزهای جدید analytics.view/manage (EDITOR/ADMIN + VIEWER فقط view)؛ page.tsx گارد مسیر با permissions

## یافته‌های پذیرش مرورگری
1. eventId با «#» در ID_SAFE نبود → INVALID انبوه؛ به «:» تغییر کرد
2. مواجههٔ تاریخ‌ساخت (شبیه‌سازی) با firstExposedAt=now ناسازگار بود → expose وقتی occurredAt (validated) می‌پذیرد
3. same-hash ناوبری مؤلفه را remount نمی‌کند → شبیه‌ساز فهرست آزمایش‌ها را در آغاز هر اجرا تازه می‌گیرد
4. stale ref پس از hot-reload باعث چند اقدام چرخهٔ آزمایش شد (PAUSE/RESUME/END) — در QA با snapshot تازه قبل از هر click کنترل شد؛ در کد محصول مشکل نیست
5. برچسب readiness به عبارت مثبت بود و در متن محدودیت‌ها متناقض می‌شد → صورت شرطی شد
6. preflight شاخص اصلی فارسی شد؛ maxLiftPp با ارقام فارسی

## پذیرش‌های انجام‌شده
- هدف+شبیه‌سازی: قیف ۱۰۷→۳۶→۲۴→۹، نرخ ۸.۴٪ با CI، روند تهران، پوشش ۸۸.۴٪، خارج‌شده داخلی/ربات/بدون رضایت
- رویداد تکراری: هر اجرا ۱ تکراری ردشده (شمارش نشد)
- A/A: prefill ۶ PASS → شروع → ۵۳/۵۵ مواجهه → نتیجه ناسازگار (CI شامل صفر) → پایان → تصمیم INCONCLUSIVE با دلیل + محدودیت‌ها
- A/B: ایجاد با UI → preflight PASS (اعتبارسنجی A/A برقرار) → شروع → شبیه‌سازی اثر ۳۰٪ → B: ۱۲.۷۳٪ vs A: ۸.۹۳٪ → توقف اضطراری (دلیل الزامی) → assign = CONTROL fallback ✓ → RESUME مسدود ✓ → پایان → تصمیم WIN_VARIANT با دلیل صادقانه
- عملکرد مقاله در ویرایشگر: ۶۴۵ مشاهده، ۴۲ تبدیل، ۶.۵٪
- مجوزها: نویسنده بدون nav و با EmptyState «دسترسی ندارید»؛ API ها ۴۰۳
- موبایل ۳۹۰×۷۰۰ + فوتر طبیعی؛ کنسول و page error صفر؛ lint/tsc پاک
