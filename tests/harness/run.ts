/**
 * اجرای هارنس تست — از ریشهٔ مخزن:
 *   bun run test:harness
 *
 * جریان:
 *  ۱) ساخت دیتابیس موقت تازه (db/harness/harness.db) با schema مخزن + فیکسچر
 *  ۲) اجرای سرور dev مجزا (پورت ۳۲۱۱، distDir=.next-harness، DATABASE_URL دیتابیس موقت)
 *  ۳) اجرای سویت‌ها به‌ترتیب (واحد، کتابخانه‌ای روی DB موقت، و HTTP روی سرور مجزا)
 *  ۴) توقف سرور، چاپ خلاصه، کد خروج مناسب CI
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import {
  BASE_URL,
  HARNESS_DB_URL,
  HARNESS_DIST_DIR,
  HARNESS_PORT,
  REPO_ROOT,
  SERVER_LOG,
} from './config'
import { setupTempDatabase, teardown } from './setup'
import { Api } from './http'
import { getResults, summarize } from './checks'

// ── مهم: پیش از ایمپورت هر ماژول src، DATABASE_URL باید دیتابیس موقت باشد ──
Object.assign(process.env, {
  DATABASE_URL: HARNESS_DB_URL,
  NEXT_DIST_DIR: HARNESS_DIST_DIR,
  NODE_ENV: 'development',
})

const READY_TIMEOUT_MS = 180_000

async function waitForServer(): Promise<void> {
  const t0 = Date.now()
  let lastErr = ''
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/`, { redirect: 'manual' })
      if (res.status < 500) return // صفحهٔ پنل یا هر پاسخ سالم = سرور بالاست
      lastErr = `status ${res.status}`
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 120) : String(e)
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`سرور هارنس در ${READY_TIMEOUT_MS / 1000} ثانیه آماده نشد (آخرین خطا: ${lastErr})`)
}

function startServer(): ChildProcess {
  const logFd = fs.openSync(SERVER_LOG, 'w')
  const child = spawn('bunx', ['next', 'dev', '-p', String(HARNESS_PORT)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: HARNESS_DB_URL,
      NEXT_DIST_DIR: HARNESS_DIST_DIR,
      NODE_ENV: 'development',
      // سهمیهٔ نرخ ورود در محیط تست بالاتر می‌رود (پیش‌فرض production: ۱۰ تلاش در ۱۰ دقیقه)
      LOGIN_RATE_LIMIT_MAX: '100',
    },
    stdio: ['ignore', logFd, logFd],
    detached: true,
  })
  child.on('error', (e) => console.error('[harness] spawn error:', e))
  return child
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        /* از قبل مرده */
      }
      resolve()
    }, 5000)
    child.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })
    try {
      process.kill(-child.pid!, 'SIGTERM') // گروه کامل (turbopack فرزند ممکن است بماند)
    } catch {
      clearTimeout(killTimer)
      resolve()
    }
  })
}

async function main() {
  const startedAt = Date.now()
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  هارنس تست پنل مدیریت — دیتابیس موقت ایزوله              ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`  ریشهٔ مخزن: ${REPO_ROOT}`)
  console.log(`  دیتابیس موقت: ${HARNESS_DB_URL}`)
  console.log(`  سرور تست: ${BASE_URL} (distDir=${HARNESS_DIST_DIR})`)

  let server: ChildProcess | null = null
  let prisma: import('@prisma/client').PrismaClient | null = null
  let fatal = false

  try {
    console.log('\n[۱/۳] آماده‌سازی دیتابیس موقت و فیکسچر…')
    const setup = await setupTempDatabase()
    prisma = setup.prisma
    const fixture = setup.fixture
    console.log(`  ✔ فیکسچر ساخته شد — ${Object.keys(fixture.articles).length} مقاله، ۵ کاربر، آزمایش + تخصیص`)

    console.log('\n[۲/۳] اجرای سرور dev مجزا…')
    server = startServer()
    await waitForServer()
    console.log('  ✔ سرور پاسخ‌گو شد')

    console.log('\n[۳/۳] ورود کاربران هارنس (سهمیهٔ نرخ ورود: ۸ از ۱۰)…')
    const admin = new Api('admin')
    const editorA = new Api('editorA')
    const editorB = new Api('editorB')
    const author = new Api('author')
    const viewer = new Api('viewer')
    const pass = (await import('./fixture')).HARNESS_PASSWORD
    for (const [api, email] of [
      [admin, fixture.users.admin.email],
      [editorA, fixture.users.editorA.email],
      [editorB, fixture.users.editorB.email],
      [author, fixture.users.author.email],
      [viewer, fixture.users.viewer.email],
    ] as const) {
      const r = await api.login(email, pass)
      if (r.status !== 200) {
        throw new Error(`ورود ${email} شکست خورد (وضعیت ${r.status}) — فیکسچر/سرور را بررسی کنید`)
      }
    }
    console.log('  ✔ پنج نشست فعال شد')

    // سویت‌ها — ترتیب اهمیت دارد (وضعیت‌گذاری مشترک بین سویت‌ها)
    const ctx = { prisma, fixture, admin, editorA, editorB, author, viewer }
    const { runDbErrorsSuite } = await import('./suites/db-errors')
    const { runAnalyticsSuite } = await import('./suites/analytics-concurrency')
    const { runVersionContractSuite } = await import('./suites/version-contract')
    const { runWorkerOwnershipSuite } = await import('./suites/worker-ownership')
    const { runSettingsRbacSuite } = await import('./suites/settings-rbac')
    const { runCookieSecureSuite } = await import('./suites/cookie-secure')
    const { runMediaValidationSuite } = await import('./suites/media-validation')

    await runDbErrorsSuite()
    await runAnalyticsSuite({ prisma, fixture })
    await runVersionContractSuite(ctx)
    await runWorkerOwnershipSuite({ prisma, fixture, admin })
    await runSettingsRbacSuite(ctx)
    await runCookieSecureSuite({ fixture })
    await runMediaValidationSuite({ prisma, fixture, admin })
  } catch (e) {
    fatal = true
    console.error('\n✘ خطای کلی هارنس:', e instanceof Error ? e.message : e)
    if (e instanceof Error && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'))
  } finally {
    if (server) {
      console.log('\n— توقف سرور هارنس…')
      await stopServer(server)
      console.log('  ✔ متوقف شد')
    }
    if (prisma) teardown(prisma)
  }

  const { pass, fail, total } = summarize()
  const durSec = Math.round((Date.now() - startedAt) / 1000)
  console.log('\n════════════ خلاصهٔ نتایج ════════════')
  console.log(`  موفق: ${pass}   ناموفق: ${fail}   کل: ${total}   مدت: ${durSec}s`)
  if (fatal) {
    console.log(`\n  اجرای هارنس با خطای کلی متوقف شد — لاگ سرور: ${SERVER_LOG}`)
    process.exit(1)
  }
  const failed = getResults().filter((r) => !r.ok)
  if (failed.length > 0) {
    console.log('\n  چک‌های ناموفق:')
    for (const f of failed) console.log(`   ✘ ${f.name}\n     └─ ${f.error}`)
    console.log(`\n  لاگ سرور هارنس: ${SERVER_LOG}`)
    process.exit(1)
  }
  if (total === 0) {
    console.log('\n  هیچ چکی اجرا نشد — این وضعیت باید بررسی شود.')
    process.exit(1)
  }
  console.log('\n  همهٔ چک‌ها سبز است. ✔')
  process.exit(0)
}

void main()
