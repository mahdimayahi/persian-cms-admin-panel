/**
 * داده اولیه سامانه مدیریت محتوا
 * اجرا: bunx tsx prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'crypto'

const db = new PrismaClient()

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

async function makeGradientPng(colors: [string, string]): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/><stop offset="100%" stop-color="${colors[1]}"/>
    </linearGradient></defs>
    <rect width="960" height="600" fill="url(#g)"/>
    <circle cx="720" cy="140" r="90" fill="rgba(255,255,255,0.15)"/>
    <circle cx="200" cy="460" r="130" fill="rgba(255,255,255,0.10)"/>
  </svg>`
  const sharp = (await import('sharp')).default
  const buf = await sharp(Buffer.from(svg)).png().toBuffer()
  return buf.toString('base64')
}

async function main() {
  console.log('پاک‌سازی داده‌های قبلی...')
  await db.activityLog.deleteMany()
  await db.notification.deleteMany()
  await db.session.deleteMany()
  await db.articleVersion.deleteMany()
  await db.articleTag.deleteMany()
  await db.comment.deleteMany()
  await db.article.deleteMany()
  await db.tag.deleteMany()
  await db.category.deleteMany()
  await db.media.deleteMany()
  await db.menuItem.deleteMany()
  await db.page.deleteMany()
  await db.formSubmission.deleteMany()
  await db.setting.deleteMany()
  await db.user.deleteMany()

  console.log('ایجاد کاربران...')
  const admin = await db.user.create({
    data: { email: 'admin@demo.ir', name: 'سارا محمدی', passwordHash: hashPassword('admin1234'), role: 'ADMIN', status: 'ACTIVE', lastLoginAt: new Date() },
  })
  const editor = await db.user.create({
    data: { email: 'editor@demo.ir', name: 'علی رضایی', passwordHash: hashPassword('editor1234'), role: 'EDITOR', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 3600_000) },
  })
  const author = await db.user.create({
    data: { email: 'author@demo.ir', name: 'نگار کریمی', passwordHash: hashPassword('author1234'), role: 'AUTHOR', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 7200_000) },
  })
  await db.user.create({
    data: { email: 'viewer@demo.ir', name: 'حسین اکبری', passwordHash: hashPassword('viewer1234'), role: 'VIEWER', status: 'ACTIVE' },
  })
  await db.user.create({
    data: { email: 'newwriter@demo.ir', name: 'مریم احمدی', passwordHash: hashPassword('writer1234'), role: 'AUTHOR', status: 'INVITED' },
  })

  console.log('ایجاد رسانه نمونه...')
  const mediaDefs: { name: string; colors: [string, string]; alt: string }[] = [
    { name: 'cover-technology.png', colors: ['#7c3aed', '#db2777'], alt: 'تصویر شاخص مقاله فناوری' },
    { name: 'cover-education.png', colors: ['#0f766e', '#22c55e'], alt: 'تصویر شاخص مقاله آموزشی' },
    { name: 'cover-design.png', colors: ['#f59e0b', '#ef4444'], alt: 'تصویر شاخص مقاله طراحی' },
    { name: 'cover-product.png', colors: ['#334155', '#0891b2'], alt: 'تصویر شاخص معرفی محصول' },
    { name: 'cover-news.png', colors: ['#1d4ed8', '#7c3aed'], alt: 'تصویر شاخص اخبار' },
  ]
  const mediaIds: string[] = []
  for (const m of mediaDefs) {
    const data = await makeGradientPng(m.colors)
    const media = await db.media.create({
      data: {
        filename: m.name,
        originalName: m.name,
        mimeType: 'image/png',
        size: Buffer.from(data, 'base64').length,
        width: 960,
        height: 600,
        altText: m.alt,
        data,
        uploadedById: editor.id,
      },
    })
    mediaIds.push(media.id)
  }

  console.log('ایجاد دسته‌بندی‌ها و برچسب‌ها...')
  const catTech = await db.category.create({ data: { name: 'فناوری', slug: 'technology', description: 'مقالات مرتبط با فناوری و توسعه نرم‌افزار', color: '#7c3aed' } })
  const catEdu = await db.category.create({ data: { name: 'آموزش', slug: 'education', description: 'راهنماها و آموزش‌های گام‌به‌گام', color: '#0f766e' } })
  const catDesign = await db.category.create({ data: { name: 'طراحی', slug: 'design', description: 'طراحی رابط کاربری و تجربه کاربری', color: '#f59e0b' } })
  const catNews = await db.category.create({ data: { name: 'اخبار محصول', slug: 'product-news', description: 'اخبار و به‌روزرسانی‌های محصول', color: '#0891b2' } })

  const tagNames = ['nextjs', 'پنل مدیریت', 'ux', 'امنیت', 'کارایی', 'seo', 'تیم اسکرام', 'مستندسازی']
  const tags: { id: string; name: string }[] = []
  for (const name of tagNames) {
    const t = await db.tag.create({ data: { name, slug: name.replace(/\s+/g, '-') } })
    tags.push({ id: t.id, name })
  }

  console.log('ایجاد مقالات نمونه...')
  const now = Date.now()
  const day = 86400000

  const articlesData = [
    {
      title: 'معماری پنل مدیریت: از مجوزها تا تاریخچه تغییرات',
      slug: 'admin-panel-architecture',
      excerpt: 'یک سامانه عملیاتی چیست و چه تفاوتی با مجموعه‌ای از فرم‌ها و جدول‌ها دارد؟ در این مقاله زنجیره هویت، مجوز، داده، عملیات و پایش را بررسی می‌کنیم.',
      content: `# معماری پنل مدیریت\n\nیک CMS حرفه‌ای یک **سامانه عملیاتی** است، نه صرفاً مجموعه‌ای از فرم‌ها و جدول‌ها.\n\n## زنجیره اصلی\n\nهر سامانه مدیریتی باید این زنجیره را کامل پوشش دهد:\n\n- هویت\n- مجوز\n- داده\n- عملیات\n- تأیید و انتشار\n- ثبت تغییرات\n- پایش\n- بازیابی\n\n## ماتریس مجوز\n\n| عملیات | نویسنده | ویراستار | مدیر |\n|---|---|---|---|\n| ایجاد مقاله | بله | بله | بله |\n| انتشار | خیر | بله | بله |\n| مدیریت کاربران | خیر | خیر | بله |\n\n> معیار حرفه‌ای‌بودن پنل، تعداد منوها یا زیبایی داشبورد نیست؛ این است که کاربران کار درست را راحت انجام دهند.\n\n## جمع‌بندی\n\nدسترسی پیش‌فرض باید محدود باشد و هر عملیات حساس در تاریخچه ثبت شود.`,
      status: 'PUBLISHED',
      authorId: author.id,
      categoryId: catTech.id,
      tagIds: [tags[0].id, tags[1].id, tags[3].id],
      mediaIdx: 0,
      views: 1240,
      publishedAt: new Date(now - 12 * day),
    },
    {
      title: 'راهنمای کامل طراحی جداول استاندارد در پنل‌های مدیریتی',
      slug: 'standard-data-tables-guide',
      excerpt: 'جست‌وجو، فیلتر، مرتب‌سازی، صفحه‌بندی و عملیات گروهی؛ استانداردی که تقریباً هر صفحه فهرست باید رعایت کند.',
      content: `# طراحی جداول استاندارد\n\nتقریباً هر موجودیت یک صفحه فهرست دارد. این صفحه باید استاندارد و یکپارچه باشد.\n\n## قابلیت‌های پایه\n\n1. جست‌وجو\n2. فیلتر\n3. مرتب‌سازی\n4. صفحه‌بندی\n5. عملیات گروهی\n\n## نکات عملیات گروهی\n\n- مشخص باشد «همین صفحه» انتخاب شده یا «تمام نتایج»\n- تعداد موارد تحت تأثیر نمایش داده شود\n- نتیجه موفق و ناموفق هر بخش گزارش شود\n\nوضعیت باید با متن و رنگ نمایش داده شود، نه فقط رنگ.`,
      status: 'PUBLISHED',
      authorId: author.id,
      categoryId: catDesign.id,
      tagIds: [tags[2].id, tags[1].id],
      mediaIdx: 2,
      views: 890,
      publishedAt: new Date(now - 8 * day),
    },
    {
      title: 'امنیت کاربردی در CMS: از هش رمز عبور تا محافظت نشست',
      slug: 'cms-security-basics',
      excerpt: 'هش رمز با Argon2id یا scrypt، کوکی‌های HttpOnly، مقابله با تلاش ورود انبوه و ابطال نشست در رویدادهای حساس.',
      content: `# امنیت کاربردی\n\n## حفاظت از حساب\n\n- هش رمز عبور با الگوریتم مناسب\n- کوکی‌های HttpOnly و SameSite\n- مقابله با تلاش ورود انبوه\n\n## عملیات حساس\n\nبرای مواردی مانند حذف سازمان یا تعویض تنظیمات ورود، احراز هویت مجدد لازم است.\n\n\`\`\`ts\n// کوئری پارامتری با Prisma\nconst user = await db.user.findUnique({ where: { email } })\n\`\`\``,
      status: 'PUBLISHED',
      authorId: editor.id,
      categoryId: catTech.id,
      tagIds: [tags[3].id, tags[0].id],
      mediaIdx: 0,
      views: 2110,
      publishedAt: new Date(now - 5 * day),
    },
    {
      title: 'چرخه عمر محتوا: گردش کار بررسی و انتشار زمان‌بندی‌شده',
      slug: 'content-lifecycle-workflow',
      excerpt: 'از پیش‌نویس تا بایگانی؛ برای هر انتقال وضعیت باید مشخص باشد چه کسی مجاز است و چه فیلدهایی باید کامل باشند.',
      content: `# چرخه عمر محتوا\n\n\`\`\`\nپیش‌نویس → در انتظار بررسی → تأییدشده → منتشرشده → بایگانی‌شده\n\`\`\`\n\n## نکته کلیدی\n\nویرایش یک مطلب منتشرشده نباید الزاماً همان لحظه سایت عمومی را تغییر دهد؛ نسخه عمومی و نسخه در حال بررسی را جدا نگه دارید.`,
      status: 'IN_REVIEW',
      authorId: author.id,
      categoryId: catNews.id,
      tagIds: [tags[6].id],
      mediaIdx: 3,
      views: 0,
    },
    {
      title: 'دسترس‌پذیری در پنل‌های مدیریتی؛ رعایت WCAG در سطح AA',
      slug: 'accessibility-wcag-aa',
      excerpt: 'استفاده کامل با صفحه‌کلید، فوکوس قابل مشاهده، کنتراست مناسب و عدم اتکا به رنگ.',
      content: `# دسترس‌پذیری\n\nهدف مناسب برای بسیاری از پروژه‌ها، رعایت WCAG 2.2 در سطح AA است.\n\n- ترتیب منطقی فوکوس\n- برچسب صحیح فیلدها\n- اهداف لمسی مناسب\n- احترام به ترجیح کاهش حرکت\n\nآزمون خودکار کافی نیست؛ بخش‌هایی باید دستی آزمایش شوند.`,
      status: 'NEEDS_REVISION',
      authorId: author.id,
      categoryId: catDesign.id,
      tagIds: [tags[2].id],
      mediaIdx: 2,
      views: 0,
      reviewNote: 'لطفاً بخش اهداف لمسی را با مثال عددی کامل کنید و تصویر شاخص مناسب انتخاب شود.',
    },
    {
      title: 'مدیریت رسانه: آپلود امن، پردازش تصویر و کنترل فضا',
      slug: 'media-management',
      excerpt: 'اعتبارسنجی نوع واقعی فایل، نام‌گذاری امن، جلوگیری از اجرای فایل آپلودشده و نمایش محل‌های استفاده.',
      content: `# مدیریت رسانه\n\n## ایمنی و کنترل\n\n- محدودیت حجم و تعداد\n- اعتبارسنجی نوع واقعی فایل\n- جداسازی فایل عمومی و خصوصی\n- نمایش محل‌های استفاده فایل`,
      status: 'DRAFT',
      authorId: author.id,
      categoryId: catTech.id,
      tagIds: [tags[3].id],
      mediaIdx: null,
      views: 0,
    },
    {
      title: 'به‌روزرسانی نسخه ۲٫۴ سامانه منتشر شد',
      slug: 'release-2-4',
      excerpt: 'در این نسخه، تقویم انتشار، ورود دومرحله‌ای برای نقش‌های حساس و گزارش‌های جدید اضافه شده است.',
      content: `# نسخه ۲٫۴ منتشر شد\n\n## امکانات جدید\n\n- تقویم انتشار\n- گزارش‌های عملیاتی جدید\n- بهبود کارایی جست‌وجو`,
      status: 'PUBLISHED',
      authorId: editor.id,
      categoryId: catNews.id,
      tagIds: [tags[7].id],
      mediaIdx: 3,
      views: 540,
      publishedAt: new Date(now - 2 * day),
    },
    {
      title: 'جست‌وجوی فارسی: نیم‌فاصله، ی/ي و ک/ك',
      slug: 'persian-search-normalization',
      excerpt: 'مدیریت تفاوت‌های نگارشی فارسی در جست‌وجو و ایندکس‌گذاری.',
      content: `# جست‌وجوی فارسی\n\nبرای جست‌وجوی صحیح فارسی باید نرمال‌سازی انجام شود:\n\n- تبدیل «ي» عربی به «ی»\n- تبدیل «ك» عربی به «ک»\n- مدیریت نیم‌فاصله`,
      status: 'APPROVED',
      authorId: author.id,
      categoryId: catEdu.id,
      tagIds: [tags[7].id, tags[4].id],
      mediaIdx: 1,
      views: 0,
    },
    {
      title: 'سئوی فنی برای سایت‌های محتوایی',
      slug: 'technical-seo',
      excerpt: 'Sitemap، ریدایرکت‌ها، داده ساختاریافته و جلوگیری از ایندکس محیط آزمایشی.',
      content: `# سئوی فنی\n\n- Sitemap به‌روز\n- کنترل ریدایرکت‌ها و جلوگیری از حلقه\n- robots.txt ابزار حفاظت از محتوای خصوصی نیست`,
      status: 'ARCHIVED',
      authorId: editor.id,
      categoryId: catEdu.id,
      tagIds: [tags[5].id],
      mediaIdx: 4,
      views: 320,
      publishedAt: new Date(now - 60 * day),
    },
    {
      title: 'الگوهای طراحی فرم‌های طولانی',
      slug: 'long-forms-patterns',
      excerpt: 'اعتبارسنجی دوطرفه، حفظ داده پس از خطا و جلوگیری از ارسال تکراری.',
      content: `# فرم‌های طولانی\n\n- برچسب دائمی برای فیلدها\n- پیام خطا کنار فیلد\n- هشدار تغییرات ذخیره‌نشده`,
      status: 'DRAFT',
      authorId: author.id,
      categoryId: catDesign.id,
      tagIds: [],
      mediaIdx: null,
      views: 0,
    },
  ]

  const createdArticles: { id: string; title: string; slug: string; status: string; authorId: string }[] = []
  for (const a of articlesData) {
    const { tagIds, mediaIdx, ...rest } = a
    const article = await db.article.create({
      data: {
        ...rest,
        coverImageId: mediaIdx !== null ? mediaIds[mediaIdx] : null,
        tags: { create: tagIds.map((tid) => ({ tagId: tid })) },
      },
    })
    createdArticles.push(article)
    // نسخه اولیه برای مقالات منتشرشده
    if (a.status === 'PUBLISHED') {
      await db.articleVersion.create({
        data: {
          articleId: article.id,
          title: a.title,
          content: a.content,
          excerpt: a.excerpt,
          editorId: a.authorId,
          editorName: a.authorId === author.id ? 'نگار کریمی' : 'علی رضایی',
          note: 'نسخه اولیه منتشرشده',
        },
      })
    }
  }

  console.log('ایجاد دیدگاه‌ها...')
  const published = createdArticles.filter((a) => a.status === 'PUBLISHED')
  await db.comment.createMany({
    data: [
      { articleId: published[0].id, authorName: 'رضا نادری', authorEmail: 'reza@example.com', content: 'مقاله خیلی کاملی بود، ممنون از تیم محتوایی.', status: 'APPROVED' },
      { articleId: published[0].id, authorName: 'شیرین مقدم', authorEmail: 'shirin@example.com', content: 'لطفاً درباره پیاده‌سازی ماتریس مجوز در سطح فیلد هم بنویسید.', status: 'PENDING' },
      { articleId: published[1].id, authorName: 'کاربر مهمان', authorEmail: 'guest@example.com', content: 'تبلیغ: سایت ما را ببینید ...', status: 'REJECTED' },
      { articleId: published[2].id, authorName: 'امیر جعفری', authorEmail: 'amir@example.com', content: 'آیا کد اسکریپت هم برای محدود کردن نشست‌ها دارید؟', status: 'PENDING' },
      { articleId: published[3]?.id ?? published[0].id, authorName: 'لیلا صادقی', authorEmail: 'leila@example.com', content: 'نسخه جدید را آپدیت کردم، عالی بود.', status: 'APPROVED' },
    ],
  })

  console.log('ایجاد صفحات و منوها...')
  await db.page.create({ data: { title: 'درباره ما', slug: 'about', content: 'ما تیمی از توسعه‌دهندگان هستیم که ابزارهای مدیریتی می‌سازیم.', status: 'PUBLISHED', showInNav: true, order: 1 } })
  await db.page.create({ data: { title: 'تماس با ما', slug: 'contact', content: 'برای ارتباط با ما از فرم تماس استفاده کنید.', status: 'PUBLISHED', showInNav: true, order: 2 } })
  await db.page.create({ data: { title: 'قوانین استفاده', slug: 'terms', content: 'قوانین استفاده از سامانه.', status: 'DRAFT', showInNav: false, order: 3 } })
  await db.menuItem.createMany({
    data: [
      { label: 'خانه', url: '/', order: 1 },
      { label: 'درباره ما', url: '/about', order: 2 },
      { label: 'تماس با ما', url: '/contact', order: 3 },
    ],
  })

  console.log('ایجاد پاسخ‌های فرم...')
  await db.formSubmission.createMany({
    data: [
      { formName: 'تماس با ما', name: 'کیوان مرادی', email: 'keyvan@example.com', subject: 'درخواست دمو', message: 'سلام، لطفاً یک دموی اختصاصی برای تیم ما هماهنگ کنید.', status: 'NEW' },
      { formName: 'تماس با ما', name: 'هما یوسفی', email: 'homa@example.com', subject: 'سؤال درباره قیمت‌گذاری', message: 'پلن سازمانی چه محدودیت‌هایی دارد؟', status: 'NEW' },
      { formName: 'تماس با ما', name: 'بهرام کاویانی', email: 'bahram@example.com', subject: 'گزارش اشکال', message: 'در مرورگر Safari هنگام آپلود فایل خطای ۴۱۳ می‌بینم.', status: 'READ' },
      { formName: 'خبرنامه', name: 'سمیرا خانجانی', email: 'samira@example.com', subject: 'عضویت در خبرنامه', message: 'مایل به دریافت خبرنامه ماهانه هستم.', status: 'ARCHIVED' },
    ],
  })

  console.log('ایجاد تنظیمات...')
  await db.setting.createMany({
    data: [
      { key: 'siteName', value: 'پنل مدیریت محتوا' },
      { key: 'siteDescription', value: 'سامانه یکپارچه تولید، بازبینی و انتشار محتوا' },
      { key: 'contactEmail', value: 'info@demo.ir' },
      { key: 'defaultLanguage', value: 'fa' },
      { key: 'timezone', value: 'Asia/Tehran' },
      { key: 'postsPerPage', value: '10' },
      { key: 'allowComments', value: 'true' },
      { key: 'maintenanceMode', value: 'false' },
    ],
  })

  console.log('ایجاد تاریخچه فعالیت و اعلان‌ها...')
  await db.activityLog.createMany({
    data: [
      { userId: author.id, userName: 'نگار کریمی', action: 'CREATE', entityType: 'ARTICLE', entityTitle: 'مدیریت رسانه: آپلود امن، پردازش تصویر و کنترل فضا', details: 'مقاله جدید ایجاد شد' },
      { userId: author.id, userName: 'نگار کریمی', action: 'SUBMIT_REVIEW', entityType: 'ARTICLE', entityTitle: 'چرخه عمر محتوا: گردش کار بررسی و انتشار زمان‌بندی‌شده', details: 'ارسال برای بازبینی' },
      { userId: editor.id, userName: 'علی رضایی', action: 'PUBLISH', entityType: 'ARTICLE', entityTitle: 'به‌روزرسانی نسخه ۲٫۴ سامانه منتشر شد', details: 'انتشار عمومی' },
      { userId: editor.id, userName: 'علی رضایی', action: 'UPDATE', entityType: 'ARTICLE', entityTitle: 'امنیت کاربردی در CMS', details: 'ویرایش متن مقاله منتشرشده (نسخه جدید ثبت شد)' },
      { userId: admin.id, userName: 'سارا محمدی', action: 'CREATE', entityType: 'USER', entityTitle: 'مریم احمدی', details: 'دعوت نویسنده جدید به سامانه' },
      { userId: admin.id, userName: 'سارا محمدی', action: 'UPDATE', entityType: 'SETTINGS', entityTitle: 'تنظیمات عمومی', details: 'تغییر نام سامانه' },
    ],
  })
  await db.notification.createMany({
    data: [
      { userId: editor.id, type: 'REVIEW_REQUEST', title: 'محتوای جدید برای بررسی', body: 'نگار کریمی مقاله «چرخه عمر محتوا» را برای بازبینی ارسال کرد.', link: `#/articles/${createdArticles[3].id}/edit` },
      { userId: editor.id, type: 'COMMENT', title: 'دیدگاه در انتظار تأیید', body: '۲ دیدگاه جدید منتظر بررسی هستند.', link: '#/comments' },
      { userId: author.id, type: 'REJECTED', title: 'مقاله نیازمند اصلاح', body: 'علی رضایی مقاله «دسترس‌پذیری» را با یادداشت بازگرداند.', link: `#/articles/${createdArticles[4].id}/edit` },
      { userId: admin.id, type: 'FORM', title: 'پاسخ جدید در فرم تماس', body: 'کیوان مرادی: درخواست دمو', link: '#/forms' },
    ],
  })

  console.log('داده اولیه با موفقیت ایجاد شد.')
  console.log('نقش‌ها و حساب‌های آزمایشی:')
  console.log('  مدیر کل  → admin@demo.ir / admin1234')
  console.log('  ویراستار → editor@demo.ir / editor1234')
  console.log('  نویسنده  → author@demo.ir / author1234')
  console.log('  بیننده   → viewer@demo.ir / viewer1234')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
