# راهنمای آزمون‌های staging و بازگشت به عقب (Rollback)

این سند رویهٔ **اجرای staging از خروجی production** و رویهٔ **rollback** (کد و داده، جدا) را مستند می‌کند. همهٔ آزمون‌ها فقط در محیط ایزوله اجرا می‌شوند؛ production هرگز دست‌کاری نمی‌شود.

---

## ۱) اجرای staging محلی (خروجی production واقعی)

```bash
# ۱. ساخت ایزوله (بدون دست‌زدن به .next سرور توسعه)
bun run build:isolated

# ۲. دیتابیس staging مستقل (مسیر جدید، خارج از مخزن یا gitignore‌شده)
DATABASE_URL="file:/tmp/cms-staging/staging.db" bunx prisma db push --skip-generate
DATABASE_URL="file:/tmp/cms-staging/staging.db" bunx tsx prisma/seed.ts

# ۳. اجرای خروجی production — فقط روی localhost (پشت proxy)
NODE_ENV=production PORT=3311 HOSTNAME=127.0.0.1 \
  DATABASE_URL="file:/tmp/cms-staging/staging.db" \
  bun .next-prod/standalone/server.js
```

## ۲) پروکسی معکوس + TLS واقعی

نمونهٔ Caddyfile staging (TLS داخلی؛ برای اعتبار عمومی، دامنه + Let's Encrypt لازم است):

```caddyfile
{
	auto_https off
}

# HTTP → HTTPS
http://:3080 {
	redir https://{host}:3443{uri} permanent
}

https://127.0.0.1:3443, https://localhost:3443 {
	tls internal        # یا: tls /path/cert.pem /path/key.pem
	reverse_proxy 127.0.0.1:3311
}
```

الزامات این کانفیگ (قرارداد اعتماد):
- Caddy به‌طور خودکار `X-Forwarded-Proto` را از روی scheme واقعی ورودی **بازنویسی** می‌کند؛ هدر جعلی کلاینت هرگز به backend نمی‌رسد.
- backend فقط روی `127.0.0.1` گوش می‌دهد (`HOSTNAME=127.0.0.1`) و مستقیماً از اینترنت در دسترس نیست؛ اگر backend مستقیم عرضه شود، هدر جعلی `x-forwarded-proto: https` می‌تواند کوکی Secure تولید کند (اثبات‌شده در آزمون D1) — پس فایروال الزامی است.
- رفتار نبود/نامعتبر بودن هدر در production: بدون هدر معتبر = کوکی بدون Secure (برای HTTP خام)؛ یعنی **production بدون proxy با HTTPS در دسترس نیست** — این رفتار امن و مستند است.

## ۳) چک‌لیست آزمون staging (نتایج این نسخه ثبت شد — برای هر انتشار مجدد تکرار شود)

| # | آزمون | انتظار | نتیجهٔ این نسخه |
| --- | --- | --- | --- |
| S1 | HTTP→HTTPS redirect | 301 به https | ✔ (3080→3443) |
| S2 | TLS handshake واقعی | نصب گواهی، بدون خطای انتقال | ✔ (self-signed؛ اعتبار عمومی LE = مسدود محیطی) |
| S3 | کوکی ورود روی HTTPS | `Secure; HttpOnly; SameSite=lax` | ✔ |
| S4 | جعل `x-forwarded-proto: http` از طریق proxy | همچنان Secure (بازنویسی proxy) | ✔ |
| S5 | ورود مستقیم به backend با هدر جعلی https | Secure صادر می‌شود → اثبات نیاز به فایروال | ✔ (مستند) |
| S6 | me / logout / نشست باطل | 200 → خروج → 401 | ✔ |
| S7 | ورود VIEWER و گردش‌های مجاز | داشبورد/مقالات/رسانه بار می‌شود | ✔ |
| S8 | کنترل‌های نوشتن VIEWER | غیرفعال/پنهان (تنظیمات disabled، منوی عملیات خالی) | ✔ |
| S9 | تلاش مستقیم API نوشتن با VIEWER | 403 و **دیتابیس بی‌تغییر** | ✔ (PUT settings/articles/publish/upload/users) |
| S10 | RTL فارسی + موبایل 360px | بدون overflow، rtl | ✔ |
| S11 | خطای console مرورگر | صفر | ✔ |

## ۴) Rollback — کد و داده جدا

### ۴.۱) rollback کد (بدون rollback داده)
- `git checkout <SHA قبلی>` → `bun install` → `bun run build` → restart (گام ۸ `DEPLOYMENT.md`).
- **سازگاری با اسکیمای جدید:** تنها تغییر اسکیمای این نسخه نسبت به مبنا، افزودن ستون nullable `PublishBundle.runOpId` است (تغییر **additive**). آزمون واقعی با کلاینت Prisma قدیم روی دیتابیس جدید اجرا شد: خواندن/ساخت/ویرایش همه سبز — پس rollback کدِ تنها روی اسکیمای جدید **امن** است (ستون اضافه نادیده گرفته می‌شود). اگر اسکیما در آینده حذف/تغییر نوع ستون داشت، این نتیجه دیگر برقرار نیست و باید دوباره آزمون شود.

### ۴.۲) rollback داده (بازیابی پشتیبان)
- فقط طبق `docs/backup-restore.md`: توقف سرویس → بازیابی به مسیر جدید → راستی‌آزمایی → جایگزینی → روشن‌کردن.
- **خطر:** نوشته‌های پس از لحظهٔ پشتیبان از بین می‌روند (نشست‌ها، رویدادهای Analytics، مقالات تازه). قبل از rollback، این بازه را ثبت کنید و در صورت امکان یک پشتیبان تازه هم بگیرید.
- rollback **تمرین‌شده در محیط ایزوله**: پشتیبانِ پیش‌ازارتقا → بازیابی در مسیر جدید → اسکیمای قدیم (بدون `runOpId`) و دادهٔ اصلی برگشت؛ همگی سبز.
- برگشت Git به‌تنهایی rollback دیتابیس **نیست** — این دو را جدا نگه دارید.

## ۵) قواعد ایمنی همیشگی

- هیچ `--accept-data-loss`، reset دیتابیس، یا force push در هیچ‌کدام از این رویه‌ها وجود ندارد.
- rollback فقط در محیط ایزوله تمرین شود؛ هرگز مستقیماً روی دادهٔ اصلی.
- مقدارهای محرمانه (کوکی/توکن/رمز) در خروجی آزمون‌ها ماسک می‌شوند؛ نمونهٔ آزمون‌های این نسخه این قاعده را رعایت کرد.
