# راهنمای گام‌به‌گام پیاده‌سازی و استقرار

این سند، مسیر کامل «از صفر تا سیستم عملیاتی» را توضیح می‌دهد: نیازمندی‌ها، پیاده‌سازی در محیط توسعه، استقرار روی سرور، اجرای پایدار، پشتیبان‌گیری، بروزرسانی و رفع اشکال.

---

## فهرست مطالب

- [معماری کلی استقرار](#معماری-کلی-استقرار)
- [نیازمندی‌های سخت‌افزاری](#نیازمندی‌های-سخت‌افزاری)
- [نیازمندی‌های نرم‌افزاری](#نیازمندی‌های-نرم‌افزاری)
- [متغیرهای محیطی](#متغیرهای-محیطی)
- [فاز ۱ — پیاده‌سازی در محیط توسعه](#فاز-۱--پیاده‌سازی-در-محیط-توسعه)
- [فاز ۲ — آماده‌سازی سرور](#فاز-۲--آماده‌سازی-سرور)
- [فاز ۳ — استقرار اولیه](#فاز-۳--استقرار-اولیه)
- [فاز ۴ — اجرای پایدار با systemd](#فاز-۴--اجرای-پایدار-با-systemd)
- [فاز ۵ — پروکسی معکوس و HTTPS](#فاز-۵--پروکسی-معکوس-و-https)
- [فاز ۶ — اقدامات پس از استقرار](#فاز-۶--اقدامات-پس-از-استقرار)
- [فاز ۷ — پشتیبان‌گیری و بازیابی](#فاز-۷--پشتیبان‌گیری-و-بازیابی)
- [فاز ۸ — بروزرسانی و بازگشت به عقب](#فاز-۸--بروزرسانی-و-بازگشت-به-عقب)
- [چک‌لیست امنیتی](#چک‌لیست-امنیتی)
- [رفع اشکال متداول](#رفع-اشکال-متداول)
- [ملاحظات مقیاس و مهاجرت پایگاه‌داده](#ملاحظات-مقیاس-و-مهاجرت-پایگاه‌داده)

---

## معماری کلی استقرار

```
کاربر (مرورگر)
   │  HTTPS (443)
   ▼
پروکسی معکوس — Caddy یا Nginx      ← گواهی TLS خودکار (Let's Encrypt)
   │  HTTP (localhost:3000)
   ▼
سرور Next.js (خروجی standalone)     ← مدیریت‌شده با systemd
   │  Prisma ORM
   ▼
پایگاه‌داده SQLite — فایل db/custom.db
   + نسخه‌های پشتیبان روزانه / رپلیکیشن پیوسته (اختیاری)
```

نکات کلیدی معماری:

- کل سیستم یک سرویس واحد است؛ پایگاه‌داده یک فایل SQLite است و سرویس پایگاه‌داده جداگانه ندارد.
- **فایل‌های رسانه به‌صورت base64 داخل پایگاه‌داده ذخیره می‌شوند**؛ پس رشد دیسک عمدتاً در فایل پایگاه‌داده رخ می‌دهد.
- خروجی ساخت، «standalone» است: پس از ساخت، اجرای آن فقط به Bun نیاز دارد و `node_modules` لازم نیست.

---

## نیازمندی‌های سخت‌افزاری

### سرور

| سناریو | CPU | RAM | دیسک | کاربر هم‌زمان تقریبی |
|---|---|---|---|---|
| توسعه محلی (لپ‌تاپ/PC) | ۲ هسته | ۴ GB | ۳ GB آزاد | ۱ کاربر |
| استقرار کوچک (حداقل عملیاتی) | ۱ vCPU | ۲ GB | ۲۰ GB SSD | تا ~۱۰ کاربر پنل |
| استقرار پیشنهادی | ۲ vCPU | ۴ GB | ۴۰ GB SSD | تا ~۵۰ کاربر پنل |
| استقرار با ترافیک بالا / رسانه زیاد | ۴ vCPU | ۸ GB | ۱۰۰+ GB SSD | صد کاربر پنل و بیشتر |

### برآورد رشد دیسک

| جزء | اندازه تقریبی |
|---|---|
| سورس کد + `node_modules` | ~۱٫۵ GB |
| خروجی ساخت (`.next/standalone`) | ~۲۰۰–۴۰۰ MB |
| پایگاه‌داده اولیه (با seed نمونه) | ~۲ MB |
| رشد پایگاه‌داده | ≈ اندازه هر فایل رسانه × ۱٫۳۳ (base64) + متن مقالات |

> مهم: چون رسانه‌ها داخل پایگاه‌داده ذخیره می‌شوند، اگر رسانه‌های سنگین (ویدئو، فایل‌های چند صد مگابایتی) آپلود می‌کنید، دیسک را بر همین اساس و بزرگ‌تر در نظر بگیرید و حتماً سهم دو برابرِ اندازه‌ی پایگاه‌داده را برای نسخه‌های پشتیبان در نظر بگیرید.

### نکات دیگر

- **ساخت (build) روی سرورهای ۱ گیگابایتی ممکن است به دلیل کمبود حافظه شکست بخورد**؛ یا RAM را به ۲ GB برسانید، یا ۲ GB فایل swap بسازید، یا ساخت را روی ماشین دیگر انجام دهید و فقط خروجی را منتقل کنید (گام‌های فاز ۳).
- شبکه: دامنه اختصاصی با رکوردهای DNS معتبر (A / AAAA) و باز بودن پورت‌های ۸۰ و ۴۴۳.
- کاربران نهایی فقط به مرورگر مدرن نیاز دارند (بخش نرم‌افزارهای سمت کاربر).

---

## نیازمندی‌های نرم‌افزاری

### سرور

| مورد | الزام | توضیح |
|---|---|---|
| سیستم‌عامل | Linux 64-bit (Ubuntu 22.04/24.04 LTS یا Debian 12 پیشنهاد می‌شود) | هر توزیع لینوکسی که Bun و systemd دارد |
| [Bun](https://bun.sh/) | نسخه ۱٫۱ یا بالاتر | زمان اجرا و ابزار نصب و ساخت |
| Git | نسخه جدید (۲٫۳۰+) | دریافت کد از مخزن |
| Caddy یا Nginx | نسخه ۲ یا Caddy ۲+ | پروکسی معکوس و خاتمه TLS |
| systemd | همراه توزیع | مدیریت سرویس و شروع خودکار پس از ریبوت |
| glibc | نسخه ۲٫۲۸+ | سازگاری با Bun و Next.js standalone |
| `sqlite3` (اختیاری اما توصیه‌شده) | CLI | برای پشتیبان‌گیری سرد و مطمئن پایگاه‌داده |
| پایتخت‌گذاری زمان | NTP فعال (مانند `chrony` یا `timedatectl`) | صحت تاریخ‌ها و لاگ‌ها |

### سمت کاربر (بازدیدکنندگان و کاربران پنل)

| مورد | الزام |
|---|---|
| مرورگر | نسخه‌های آخر Chrome، Edge، Firefox یا Safari (میزبان و موبایل) |
| شبکه | HTTPS به سرور؛ نیازی به نصب نرم‌افزار خاص نیست |

### حساب و دسترسی‌ها

- دسترسی SSH به سرور با کاربری دارای مجوز sudo
- توکن یا دسترسی read به مخزن گیت پروژه

---

## متغیرهای محیطی

فایل `.env` در ریشه پروژه (این فایل هرگز نباید در گیت قرار بگیرد):

| متغیر | نمونه مقدار | توضیح |
|---|---|---|
| `DATABASE_URL` | `file:/var/www/persian-cms/db/custom.db` | مسیر **مطلق** فایل پایگاه‌داده (در عملیات مسیر مطلق توصیه می‌شود) |
| `NODE_ENV` | `production` | در حالت عملیاتی (اسکریپت `start` خودش تنظیم می‌کند) |
| `PORT` | `3000` | پورت سرویس standalone (اختیاری؛ پیش‌فرض ۳۰۰۰) |
| `HOSTNAME` | `127.0.0.1` | در عملیات فقط روی localhost گوش دهید تا پروکسی جلوتر باشد |

---

## فاز ۱ — پیاده‌سازی در محیط توسعه

هدف: اجرای کامل پنل روی دستگاه توسعه‌دهنده برای اعمال تغییرات و آزمون.

### گام ۱.۱ — نصب پیش‌نیازها

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (WSL2 توصیه می‌شود)
wsl --install        # سپس داخل WSL دستور بالا را اجرا کنید
```

بررسی: `bun --version` باید ۱٫۱ یا بالاتر را نشان دهد.

### گام ۱.۲ — دریافت کد و نصب وابستگی‌ها

```bash
git clone https://github.com/mahdimayahi/persian-cms-admin-panel.git
cd persian-cms-admin-panel
bun install
```

### گام ۱.۳ — ساخت پایگاه‌داده و داده‌های اولیه

```bash
# ۱. ساخت/همگام‌سازی اسکیما روی فایل پایگاه‌داده
bun run db:push

# ۲. تولید کلاینت Prisma
bun run db:generate

# ۳. درج داده‌های نمونه (۴ حساب کاربری، مقالات، رسانه و…)
bunx tsx prisma/seed.ts
```

### گام ۱.۴ — اجرای سرور توسعه

```bash
bun run dev
```

پنل روی `http://localhost:3000` در دسترس است. ورود با حساب‌های نمونه (در README: حساب‌های پیش‌فرض).

### گام ۱.۵ — بررسی کیفیت کد پیش از هر commit

```bash
bun run lint
```

---

## فاز ۲ — آماده‌سازی سرور

روی سرور تازه‌نصب‌شده Ubuntu/Debian:

### گام ۲.۱ — بروزرسانی و ابزارهای پایه

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates sqlite3 chrony
```

### گام ۲.۲ — همگام‌سازی زمان

```bash
sudo timedatectl set-ntp true
timedatectl status   # «System clock synchronized: yes» باید باشد
```

### گام ۲.۳ — کاربر اجرای سرویس (بدون sudo)

```bash
sudo adduser --disabled-password --gecos "CMS Service" cmsrun
```

### گام ۲.۴ — دیوار آتش (فایروال)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

> پورت ۳۰۰۰ را باز نکنید؛ سرویس فقط از طریق پروکسی معکوس در دسترس خواهد بود.

### گام ۲.۵ — نصب Bun (برای کاربر `cmsrun`)

```bash
sudo -iu cmsrun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
exit
```

### گام ۲.۶ — (فقط اگر RAM سرور ۱ GB است) ساخت swap

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## فاز ۳ — استقرار اولیه

پیش‌فرض‌های ادامه: مسیر نصب `/var/www/persian-cms` و دامنه `cms.example.ir`.

### گام ۳.۱ — دریافت کد

```bash
sudo mkdir -p /var/www/persian-cms
sudo chown cmsrun:cmsrun /var/www/persian-cms
sudo -iu cmsrun
git clone https://github.com/mahdimayahi/persian-cms-admin-panel.git /var/www/persian-cms
cd /var/www/persian-cms
```

### گام ۳.۲ — تنظیم متغیرهای محیطی

```bash
cat > .env <<'EOF'
DATABASE_URL=file:/var/www/persian-cms/db/custom.db
HOSTNAME=127.0.0.1
PORT=3000
EOF
chmod 600 .env
```

### گام ۳.۳ — نصب وابستگی‌ها و ساخت پایگاه‌داده

```bash
bun install
bun run db:push
bun run db:generate
bunx tsx prisma/seed.ts    # فقط بار اول
```

### گام ۳.۴ — ساخت نسخه عملیاتی

```bash
bun run build
```

این دستور خروجی standalone را می‌سازد و `static` و `public` را داخل آن کپی می‌کند.

> اگر ساخت روی سرور ناممکن بود، آن را روی دستگاه توسعه انجام دهید و فقط این مسیرها را با rsync منتقل کنید: `src/`، `prisma/`، `db/`، `public/`، `package.json`، `.next/standalone/`، `.next/static/` و سپس در سرور فقط `bun install --production` اجرا کنید.

### گام ۳.۵ — آزمایش دستی پیش از سرویس‌سازی

```bash
NODE_ENV=production bun .next/standalone/server.js
# در ترمینال دیگر:
curl -I http://127.0.0.1:3000
```

اگر پاسخ `200` گرفتید، سرویس درست کار می‌کند؛ `Ctrl+C` بزنید و به فاز ۴ بروید.

---

## فاز ۴ — اجرای پایدار با systemd

### گام ۴.۱ — ساخت واحد سرویس

```bash
sudo tee /etc/systemd/system/persian-cms.service <<'EOF'
[Unit]
Description=Persian CMS Admin Panel (Next.js standalone)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=cmsrun
Group=cmsrun
WorkingDirectory=/var/www/persian-cms
EnvironmentFile=/var/www/persian-cms/.env
Environment=NODE_ENV=production
ExecStart=/home/cmsrun/.bun/bin/bun /var/www/persian-cms/.next/standalone/server.js
Restart=always
RestartSec=5
# سخت‌گیری‌های امنیتی
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/www/persian-cms/db /var/www/persian-cms/.next
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
```

> مسیر ExecStart را با خروجی `which bun` (به‌عنوان cmsrun) تطبیق دهید. بخش `ReadWritePaths` فقط پوشه پایگاه‌داده و `.next` را برای نوشتن باز می‌گذارد.

### گام ۴.۲ — فعال‌سازی

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now persian-cms
sudo systemctl status persian-cms
journalctl -u persian-cms -f    # مشاهده لاگ زنده
```

اکنون سرویس پس از ریبوت نیز خودکار بالا می‌آید.

---

## فاز ۵ — پروکسی معکوس و HTTPS

دو گزینه؛ یکی را انتخاب کنید.

### گزینه A — Caddy (توصیه‌شده: گواهی HTTPS خودکار)

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile <<'EOF'
cms.example.ir {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

Caddy به‌طور خودکار گواهی Let's Encrypt می‌گیرد و تمدید می‌کند.

### گزینه B — Nginx + Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/persian-cms <<'EOF'
server {
    listen 80;
    server_name cms.example.ir;

    client_max_body_size 100M;   # برای آپلود رسانه‌های بزرگ

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/persian-cms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d cms.example.ir    # فعال‌سازی HTTPS
```

### بررسی نهایی

مرورگر را باز کنید: `https://cms.example.ir` — باید صفحه ورود پنل (فارسی و راست‌چین) ببیند و آدرس قفل HTTPS داشته باشد.

---

## فاز ۶ — اقدامات پس از استقرار

این گام‌ها الزامی هستند:

1. **تغییر همه رمزهای پیش‌فرض** (مدیر کل، سردبیر، نویسنده، بازدیدکننده) از مسیر «حساب من → تغییر رمز». اگر حسابی استفاده نمی‌شود، غیرفعالش کنید.
2. ورود با هر نقش و بررسی ماژول‌های کلیدی: داشبورد، مقالات، بسته‌های انتشار، اهداف و نتایج، آزمایش A/B.
3. بررسی لاگ سرویس: `journalctl -u persian-cms --since "10 min ago"`.
4. فعال‌سازی پایش ساده — حداقل یک پایش‌گر uptime بیرونی روی `https://cms.example.ir` (هر ۱ تا ۵ دقیقه، انتظار کد ۲۰۰).
5. تنظیم اولین پشتیبان‌گیری (فاز ۷) و یک بازیابی آزمایشی برای اطمینان.

---

## فاز ۷ — پشتیبان‌گیری و بازیابی

همه‌چیزِ مهم داخل یک فایل است: `db/custom.db`. پشتیبان‌گیری آن یعنی پشتیبان‌گیری کل سیستم (شامل رسانه‌ها).

### گام ۷.۱ — اسکریپت پشتیبان‌گیری

```bash
sudo tee /usr/local/bin/cms-backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DB="/var/www/persian-cms/db/custom.db"
OUT="/var/backups/persian-cms"
KEEP=14                     # نگهداری ۱۴ نسخه اخیر
mkdir -p "$OUT"
STAMP=$(date +%Y-%m-%d_%H-%M)
# پشتیبان سرد و سازگار حتی در حال کار سرویس
sqlite3 "$DB" ".backup '$OUT/custom_$STAMP.db'"
gzip -f "$OUT/custom_$STAMP.db"
# حذف نسخه‌های قدیمی‌تر از KEEP
ls -1t "$OUT"/custom_*.db.gz | tail -n +$((KEEP+1)) | xargs -r rm -f
EOF
sudo chmod +x /usr/local/bin/cms-backup.sh
sudo /usr/local/bin/cms-backup.sh && ls -lh /var/backups/persian-cms/
```

### گام ۷.۲ — زمان‌بندی روزانه (۳ بامداد)

```bash
sudo crontab -e
# افزودن این خط:
0 3 * * * /usr/local/bin/cms-backup.sh >> /var/log/cms-backup.log 2>&1
```

### گام ۷.۳ — انتقال پشتیبان به بیرون سرور (توصیه‌شده)

قانون طلایی: پشتیبان باید در مکانی جدا ذخیره شود. نمونه با `rsync`:

```bash
# در یک ماشین/سرور دوم:
0 4 * * * rsync -az backupuser@SERVER_IP:/var/backups/persian-cms/ /srv/cms-backups/
```

گزینه‌های دیگر: restic، borg، یا object storage (S3/R2). برای پشتیبان‌گیری پیوسته (RPO ≈ صفر)، ابزار [Litestream](https://litestream.io/) مناسب SQLite است.

### گام ۷.۴ — بازیابی

```bash
sudo systemctl stop persian-cms
gunzip -c /var/backups/persian-cms/custom_YYYY-MM-DD_*.db.gz > /var/www/persian-cms/db/custom.db
sudo chown cmsrun:cmsrun /var/www/persian-cms/db/custom.db
sudo systemctl start persian-cms
journalctl -u persian-cms -n 20        # بررسی سلامت راه‌اندازی
```

> هرگز بازیابی را بدون توقف سرویس و در سرعت بالا تست نکنید؛ هر چند ماه یک‌بار بازیابی آزمایشی را کامل اجرا کنید.

---

## فاز ۸ — بروزرسانی و بازگشت به عقب

### بروزرسانی به نسخه جدید

```bash
sudo -iu cmsrun
cd /var/www/persian-cms
sudo systemctl stop persian-cms
sqlite3 db/custom.db ".backup '/var/backups/persian-cms/pre-update_$(date +%F_%H-%M).db'"
git pull origin main
bun install
bun run db:push          # اعمال تغییرات اسکیما در صورت وجود
bun run db:generate
bun run build
exit
sudo systemctl start persian-cms
journalctl -u persian-cms -n 30
```

### بازگشت به نسخه قبلی (rollback)

```bash
sudo -iu cmsrun
cd /var/www/persian-cms
sudo systemctl stop persian-cms
git log --oneline -5          # پیدا کردن commit سالم قبلی
git checkout <commit-قبلی>
bun install && bun run build
exit
sudo systemctl start persian-cms
# اگر اسکیمای پایگاه‌داده هم تغییر کرده بود، پشتیبانِ پیش از بروزرسانی را بازیابی کنید (گام ۷.۴)
```

---

## چک‌لیست امنیتی

- [ ] همه رمزهای پیش‌فرض تغییر کرده‌اند؛ حساب‌های بی‌استفاده غیرفعال شده‌اند
- [ ] `https` فعال است و http خودکار به https هدایت می‌شود (Caddy/Certbot خودکار انجام می‌دهند)
- [ ] پورت ۳۰۰۰ از بیرون بسته است (`ufw status`) و سرویس فقط روی `127.0.0.1` گوش می‌دهد
- [ ] فایل `.env` با دسترسی `600` و خارج از گیت است
- [ ] سرویس با کاربر غیرممتاز (`cmsrun`) و محدودیت‌های systemd اجرا می‌شود
- [ ] پشتیبان‌گیری روزانه فعال و حداقل یک نسخه بیرون سرور نگهداری می‌شود
- [ ] بروزرسانی خودکار امنیتی سیستم‌عامل فعال است (`unattended-upgrades`)
- [ ] دسترسی SSH با کلید عمومی انجام می‌شود و ورود با رمز بسته است (`PasswordAuthentication no`)
- [ ] لاگ‌ها به‌طور دوره‌ای بازبینی می‌شوند (`journalctl -u persian-cms` و «تاریخچه فعالیت‌ها» داخل پنل)

## رفع اشکال متداول

| نشانه | علت احتمالی | راه‌حل |
|---|---|---|
| `502 Bad Gateway` | سرویس پایین است یا پورت اشتباه | `systemctl status persian-cms`، بررسی `PORT` و `journalctl -u persian-cms` |
| صفحه باز نمی‌شود ولی curl جواب می‌دهد | مشکل DNS یا فایروال | `dig cms.example.ir`، `ufw status` |
| خطای `Error Code: Unable to open database` | مسیر `DATABASE_URL` یا مجوز فایل | مسیر مطلق و مالکیت `cmsrun` را بررسی کنید |
| شکست build با `Killed` | کمبود RAM هنگام ساخت | افزودن swap یا ساخت در ماشین دیگر (گام ۳.۴) |
| کاربران مدام log-out می‌شوند | پاک شدن نشست‌ها با بازسازی کامل پایگاه‌داده | پشتیبان‌گیری منظم نشست‌ها را هم دربر می‌گیرد؛ بازیابی را جایگزین نکنید |
| آپلود رسانه‌های بزرگ شکست می‌خورد | محدودیت حجم بدنه در پروکسی | در Nginx: `client_max_body_size`؛ در Caddy پیش‌فرض کافی است |
| ساعت‌ها یا تاریخ‌ها جابجاست | عدم همگام‌سازی NTP | گام ۲.۲ را اجرا کنید |

## ملاحظات مقیاس و مهاجرت پایگاه‌داده

SQLite برای تیم‌های کوچک و متوسط (ده‌ها کاربر پنل، ده‌ها هزار مقاله) کاملاً کافی و بسیار کم‌هزینه است. زمانی به مهاجرت فکر کنید که:

- هم‌زمانی نوشتن زیاد شود (تأخیر محسوس در ذخیره‌ها)
- اندازه پایگاه‌داده به چند ده گیگابایت برسد (عمدتاً به دلیل رسانه‌ها)
- نیاز به رپلیکیشن خواندن یا قفل‌شکنی هم‌زمانی بالا داشته باشید

مسیر مهاجرت: در `prisma/schema.prisma` مقدار `provider` را به `postgresql` تغییر دهید، `DATABASE_URL` جدید تنظیم کنید و `bun run db:push` را روی سرور پایگاه‌داده جدید اجرا کنید. منطق اپلیکیشن (APIها، احراز هویت، گردش کار) بدون تغییر باقی می‌ماند.

---

خلاصه مسیر: **نصب Bun → دریافت کد → db:push + seed → build → systemd → Caddy/Nginx با HTTPS → تغییر رمزها → پشتیبان‌گیری خودکار**
