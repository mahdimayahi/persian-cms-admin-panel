/**
 * فیکسچر هارنس — دیتابیس موقت با حداقل دادهٔ معنی‌دار
 * همهٔ سناریوها روی همین دیتابیس ایزوله اجرا می‌شوند؛ پایگاه دادهٔ اصلی دست‌نخورده می‌ماند.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'
import { HARNESS_DB_URL } from './config'

export type Fixture = Awaited<ReturnType<typeof seedFixture>>

/** هش رمز — قالب یکسان با src/lib/auth.ts (salt:hash هگز، scrypt ۶۴ بایت) */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export const HARNESS_PASSWORD = 'Pass1234!'

/** کلاینت مستقل برای دیتابیس موقت (بدون سینگلتون src/lib/db) */
export function createPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: HARNESS_DB_URL })
}

export async function seedFixture(prisma: PrismaClient) {
  const pass = hashPassword(HARNESS_PASSWORD)

  // ── کاربران (پنج نقش) ──
  const mkUser = (email: string, name: string, role: string) =>
    prisma.user.create({
      data: { email, name, role, status: 'ACTIVE', passwordHash: pass },
    })
  const admin = await mkUser('admin@harness.ir', 'مدیر هارنس', 'ADMIN')
  const editorA = await mkUser('editor-a@harness.ir', 'ویراستار الف', 'EDITOR')
  const editorB = await mkUser('editor-b@harness.ir', 'ویراستار ب', 'EDITOR')
  const author = await mkUser('author@harness.ir', 'نویسنده هارنس', 'AUTHOR')
  const viewer = await mkUser('viewer@harness.ir', 'بیننده هارنس', 'VIEWER')

  // ── دسته‌بندی و برچسب ──
  const category = await prisma.category.create({ data: { name: 'دستهٔ هارنس', slug: 'harness-cat' } })

  // ── تنظیمات پایه ──
  await prisma.setting.createMany({
    data: [
      { key: 'siteName', value: 'سایت هارنس' },
      { key: 'postsPerPage', value: '10' },
      { key: 'timezone', value: 'Asia/Tehran' },
    ],
  })

  // ── صفحات ──
  const pagePub = await prisma.page.create({
    data: { title: 'صفحهٔ منتشر هارنس', slug: 'harness-page-pub', content: '<p>محتوای صفحهٔ منتشرشده</p>', status: 'PUBLISHED', showInNav: false },
  })
  const pageDraft = await prisma.page.create({
    data: { title: 'صفحهٔ پیش‌نویس هارنس', slug: 'harness-page-draft', content: '<p>پیش‌نویس</p>', status: 'DRAFT', showInNav: false },
  })

  // ── مقالات ──
  const mkArticle = (title: string, slug: string, status: string, authorId: string, content = 'محتوای اولیه') =>
    prisma.article.create({ data: { title, slug, status, authorId, categoryId: category.id, content } })

  const artDraft = await mkArticle('مقالهٔ پیش‌نویس هارنس', 'harness-draft', 'DRAFT', author.id)
  const artApproved1 = await mkArticle('مقالهٔ تأییدشدهٔ یک', 'harness-approved-1', 'APPROVED', author.id)
  const artApproved2 = await mkArticle('مقالهٔ تأییدشدهٔ دو', 'harness-approved-2', 'APPROVED', author.id)
  const artBulkClean = await mkArticle('مقالهٔ گروهی سالم', 'harness-bulk-clean', 'APPROVED', author.id)
  const artBulkDirty = await mkArticle('مقالهٔ گروهی ویرایش‌شده', 'harness-bulk-dirty', 'APPROVED', author.id)
  const artRetryA = await prisma.article.create({
    data: {
      title: 'مقالهٔ تلاش مجدد الف',
      slug: 'harness-retry-a',
      status: 'PUBLISHED',
      authorId: author.id,
      categoryId: category.id,
      content: 'محتوای اولیه',
      publishedAt: new Date(Date.now() - 7200_000),
    },
  })
  const artRetryB = await mkArticle('مقالهٔ تلاش مجدد ب', 'harness-retry-b', 'APPROVED', author.id)
  const artVersions = await mkArticle('مقالهٔ نسخه‌ها', 'harness-versions', 'DRAFT', author.id)

  // نسخه‌ها — نسخهٔ ۱ برای همهٔ مقالات تأییدشده + دو نسخهٔ مستقل برای مقالهٔ نسخه‌ها
  const mkVersion = (articleId: string, title: string, content: string, note: string, editorName: string) =>
    prisma.articleVersion.create({
      data: { articleId, title, content, excerpt: '', editorId: author.id, editorName, note },
    })

  const av1 = await mkVersion(artApproved1.id, artApproved1.title, 'محتوای اولیه', 'ثبت اولیه', 'نویسنده هارنس')
  const av2 = await mkVersion(artApproved2.id, artApproved2.title, 'محتوای اولیه', 'ثبت اولیه', 'نویسنده هارنس')
  const avBulkClean = await mkVersion(artBulkClean.id, artBulkClean.title, 'محتوای اولیه', 'ثبت اولیه', 'نویسنده هارنس')
  const avBulkDirty = await mkVersion(artBulkDirty.id, artBulkDirty.title, 'محتوای اولیه', 'ثبت اولیه', 'نویسنده هارنس')
  const avRetryB = await mkVersion(artRetryB.id, artRetryB.title, 'محتوای اولیه', 'ثبت اولیه', 'نویسنده هارنس')
  const ver1 = await mkVersion(artVersions.id, artVersions.title, 'محتوای نسخهٔ یک', 'نسخهٔ یک', 'نویسنده هارنس')
  await mkVersion(artVersions.id, 'مقالهٔ نسخه‌ها (ویرایش)', 'محتوای نسخهٔ دو', 'نسخهٔ دو', 'نویسنده هارنس')
  const avRetryA = await mkVersion(artRetryA.id, artRetryA.title, 'محتوای اولیه', 'ثبت اولیه', 'نویسنده هارنس')

  // ── بستهٔ «تلاش مجدد» نیمه‌ناموفق (دستی، برای تست retryOnly) ──
  const bundleRetry = await prisma.publishBundle.create({
    data: {
      title: 'بستهٔ نیمه‌ناموفق هارنس',
      status: 'PARTIAL',
      createdById: admin.id,
      createdByName: admin.name,
      ownerId: admin.id,
      ownerName: admin.name,
      publishedAt: new Date(Date.now() - 3600_000),
    },
  })
  await prisma.bundleItem.createMany({
    data: [
      { bundleId: bundleRetry.id, articleId: artRetryA.id, versionId: avRetryA.id, approvedVersionId: avRetryA.id, result: 'SUCCESS', message: 'منتشر شد.' },
      { bundleId: bundleRetry.id, articleId: artRetryB.id, versionId: avRetryB.id, approvedVersionId: avRetryB.id, result: 'FAILED', message: 'شکست دستی برای سناریو' },
    ],
  })
  // اجرای پیشین بستهٔ نیمه‌ناموفق — مبنای retryOfId در تلاش مجدد
  await prisma.operationLog.create({
    data: {
      type: 'BUNDLE_PUBLISH',
      title: 'انتشار بستهٔ نیمه‌ناموفق هارنس',
      status: 'PARTIAL',
      totalItems: 2,
      doneItems: 1,
      failedItems: 1,
      relatedId: bundleRetry.id,
      startedAt: new Date(Date.now() - 7200_000),
      finishedAt: new Date(Date.now() - 7100_000),
      resultSummary: '1 مورد موفق، 1 مورد ناموفق',
    },
  })

  // ── آزمایش + تخصیص بازدیدکننده (برای تبدیل موازی) ──
  const experiment = await prisma.experiment.create({
    data: {
      title: 'آزمایش هارنس تبدیل موازی',
      hypothesis: 'دو تبدیل موازی هرگز دوباره شمرده نمی‌شوند',
      targetContentId: artApproved1.id,
      primaryMetricEvent: 'SIGNUP',
      attributionHours: 24,
      status: 'RUNNING',
      startedAt: new Date(),
      createdById: admin.id,
      createdByName: admin.name,
    },
  })
  const assignment = await prisma.experimentAssignment.create({
    data: {
      experimentId: experiment.id,
      visitorId: 'visitor-harness-001',
      assignedGroup: 'VARIANT',
      firstExposedAt: new Date(Date.now() - 3600_000),
      exposureCount: 3,
      convertedAt: null,
    },
  })

  return {
    users: { admin, editorA, editorB, author, viewer },
    category,
    pages: { pagePub, pageDraft },
    articles: { artDraft, artApproved1, artApproved2, artBulkClean, artBulkDirty, artRetryA, artRetryB, artVersions },
    versions: { av1, av2, avBulkClean, avBulkDirty, avRetryB, ver1 },
    bundleRetry,
    experiment,
    assignment,
  }
}
