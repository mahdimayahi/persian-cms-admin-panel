/**
 * API راه‌اندازی دادهٔ نمایشی سنجش نتیجه
 * POST /api/analytics/demo-setup — ساخت «صفحهٔ معرفی خدمت» منتشرشده و یک هدف واقعی
 * تمام داده‌های تولیدشده با نشانهٔ نمایشی ثبت می‌شوند تا با دادهٔ واقعی اشتباه نشوند
 */
import { handleApiError, ok, requirePermission } from '@/lib/api-utils'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

const SERVICE_SLUG = 'service-consulting-intro'
const SERVICE_TITLE = 'صفحهٔ معرفی خدمت مشاوره'

export async function POST() {
  try {
    const user = await requirePermission('analytics.manage')

    // محتوای هدف: صفحهٔ معرفی خدمت (مقالهٔ نسخه‌بندی‌شدهٔ منتشرشده)
    let article = await db.article.findUnique({ where: { slug: SERVICE_SLUG } })
    if (!article) {
      // نویسندهٔ دمو برای مالکیت محتوا
      let author = await db.user.findUnique({ where: { email: 'author@demo.ir' } })
      if (!author) {
        author = await db.user.create({
          data: { email: 'author@demo.ir', name: 'نویسندهٔ نمایشی', passwordHash: hashPassword('author1234'), role: 'AUTHOR', status: 'ACTIVE' },
        })
      }
      article = await db.article.create({
        data: {
          title: SERVICE_TITLE,
          slug: SERVICE_SLUG,
          excerpt: 'معرفی خدمت مشاورهٔ کسب‌وکار و ثبت درخواست مشاورهٔ رایگان',
          content:
            '## خدمت مشاورهٔ کسب‌وکار\n\nتیم مشاوره ما به سازمان‌ها کمک می‌کند مسیر رشد خود را روشن کنند.\n\n### چه چیزی دریافت می‌کنید؟\n\n- جلسهٔ بررسی وضعیت فعلی\n- نقشهٔ راه اولیه\n- برآورد شفاف هزینه\n\n### اقدام بعدی\n\nفرم درخواست مشاوره را کامل کنید؛ کارشناسان ما در اولین فرصت تماس می‌گیرند.',
          status: 'PUBLISHED',
          authorId: author.id,
          publishedAt: new Date(),
        },
      })
      await db.articleVersion.create({
        data: {
          articleId: article.id,
          title: SERVICE_TITLE,
          content: article.content,
          excerpt: article.excerpt,
          editorId: user.id,
          editorName: user.name,
          note: 'نسخهٔ اولیهٔ صفحهٔ معرفی خدمت (دادهٔ نمایشی)',
        },
      })
    }

    // هدف واقعی: ثبت موفق درخواست مشاوره
    let goal = await db.contentGoal.findFirst({ where: { contentId: article.id } })
    if (!goal) {
      goal = await db.contentGoal.create({
        data: {
          title: 'افزایش درخواست مشاوره از صفحهٔ معرفی خدمت',
          contentId: article.id,
          primaryGoal: 'دریافت درخواست مشاورهٔ معتبر از بازدیدکنندگان واجد شرایط',
          successEvent: 'FORM_SUCCESS',
          metricLabel: 'نرخ ثبت درخواست مشاوره',
          metricNumerator: 'بازدیدکنندگان واجد شرایط (بدون ترافیک داخلی و ربات، دارای رضایت) که «ثبت موفق فرم» را در پنجرهٔ انتساب پس از اولین مشاهده ثبت کرده‌اند',
          metricDenominator: 'بازدیدکنندگان واجد شرایط که در بازهٔ گزارش صفحه را مشاهده کرده‌اند',
          attributionRule: 'AFTER_FIRST_VIEW',
          attributionHours: 24,
          ownerUserId: user.id,
          ownerName: user.name,
          createdById: user.id,
          createdByName: user.name,
        },
      })
    }

    return ok({ articleId: article.id, articleTitle: article.title, goalId: goal.id, goalTitle: goal.title })
  } catch (err) {
    return handleApiError(err)
  }
}
