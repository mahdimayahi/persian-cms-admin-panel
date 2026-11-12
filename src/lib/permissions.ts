/**
 * کاتالوگ مجوزها و ماتریس نقش‌ها
 * این فایل بین سرور (اعمال مجوز) و کلاینت (نمایش رابط) مشترک است.
 * اصل: دسترسی پیش‌فرض محدود؛ مجوز همیشه سمت سرور نیز بررسی می‌شود.
 */

export const ROLES = ['ADMIN', 'EDITOR', 'AUTHOR', 'VIEWER'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'مدیر کل',
  EDITOR: 'ویراستار',
  AUTHOR: 'نویسنده',
  VIEWER: 'بیننده',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'دسترسی کامل به همه بخش‌ها و تنظیمات سامانه',
  EDITOR: 'مدیریت کامل محتوا، انتشار، بازبینی دیدگاه‌ها و رسانه',
  AUTHOR: 'ایجاد و ویرایش محتوای خود، بدون مجوز انتشار',
  VIEWER: 'مشاهده‌ی فقط‌خواندنی محتوا و گزارش‌ها',
}

export type Permission =
  | 'articles.view'
  | 'articles.create'
  | 'articles.edit.own'
  | 'articles.edit.any'
  | 'articles.delete.own'
  | 'articles.delete.any'
  | 'articles.publish'
  | 'articles.review'
  | 'comments.view'
  | 'comments.moderate'
  | 'categories.manage'
  | 'tags.manage'
  | 'media.view'
  | 'media.upload'
  | 'media.delete.own'
  | 'media.delete.any'
  | 'pages.view'
  | 'pages.manage'
  | 'menus.manage'
  | 'forms.view'
  | 'forms.manage'
  | 'users.view'
  | 'users.manage'
  | 'roles.view'
  | 'settings.view'
  | 'settings.manage'
  | 'reports.view'
  | 'activity.view'
  | 'analytics.view'
  | 'analytics.manage'

export const PERMISSION_LABELS: Record<Permission, string> = {
  'articles.view': 'مشاهده مقالات',
  'articles.create': 'ایجاد مقاله',
  'articles.edit.own': 'ویرایش مقاله خود',
  'articles.edit.any': 'ویرایش مقاله دیگران',
  'articles.delete.own': 'حذف مقاله خود',
  'articles.delete.any': 'حذف مقاله دیگران',
  'articles.publish': 'انتشار مقاله',
  'articles.review': 'بازبینی و تأیید محتوا',
  'comments.view': 'مشاهده دیدگاه‌ها',
  'comments.moderate': 'تأیید یا رد دیدگاه',
  'categories.manage': 'مدیریت دسته‌بندی‌ها',
  'tags.manage': 'مدیریت برچسب‌ها',
  'media.view': 'مشاهده رسانه',
  'media.upload': 'بارگذاری رسانه',
  'media.delete.own': 'حذف رسانه خود',
  'media.delete.any': 'حذف رسانه دیگران',
  'pages.view': 'مشاهده صفحات',
  'pages.manage': 'مدیریت صفحات',
  'menus.manage': 'مدیریت منوها',
  'forms.view': 'مشاهده پاسخ فرم‌ها',
  'forms.manage': 'مدیریت پاسخ فرم‌ها',
  'users.view': 'مشاهده کاربران',
  'users.manage': 'مدیریت کاربران',
  'roles.view': 'مشاهده نقش‌ها و مجوزها',
  'settings.view': 'مشاهده تنظیمات',
  'settings.manage': 'ویرایش تنظیمات',
  'reports.view': 'مشاهده گزارش‌ها',
  'activity.view': 'مشاهده تاریخچه فعالیت',
  'analytics.view': 'مشاهده نتیجهٔ محتوا و آزمایش‌ها',
  'analytics.manage': 'تعریف هدف و مدیریت آزمایش A/B',
}

const AUTHOR_PERMISSIONS: Permission[] = [
  'articles.view',
  'articles.create',
  'articles.edit.own',
  'articles.delete.own',
  'comments.view',
  'media.view',
  'media.upload',
  'media.delete.own',
]

const EDITOR_PERMISSIONS: Permission[] = [
  'articles.view',
  'articles.create',
  'articles.edit.own',
  'articles.edit.any',
  'articles.delete.own',
  'articles.delete.any',
  'articles.publish',
  'articles.review',
  'comments.view',
  'comments.moderate',
  'categories.manage',
  'tags.manage',
  'media.view',
  'media.upload',
  'media.delete.own',
  'media.delete.any',
  'pages.view',
  'pages.manage',
  'menus.manage',
  'forms.view',
  'forms.manage',
  'reports.view',
  'activity.view',
  'roles.view',
  'analytics.view',
  'analytics.manage',
]

const ADMIN_PERMISSIONS: Permission[] = [...EDITOR_PERMISSIONS, 'users.view', 'users.manage', 'settings.view', 'settings.manage']

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  EDITOR: EDITOR_PERMISSIONS,
  AUTHOR: AUTHOR_PERMISSIONS,
  VIEWER: ['articles.view', 'comments.view', 'media.view', 'pages.view', 'forms.view', 'reports.view', 'roles.view', 'settings.view', 'analytics.view'],
}

export function roleHasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role]
  if (!perms) return false
  return perms.includes(permission)
}

/** گروه‌بندی مجوزها برای نمایش ماتریس */
export const PERMISSION_GROUPS: { group: string; permissions: Permission[] }[] = [
  { group: 'مقالات', permissions: ['articles.view', 'articles.create', 'articles.edit.own', 'articles.edit.any', 'articles.delete.own', 'articles.delete.any', 'articles.publish', 'articles.review'] },
  { group: 'دیدگاه‌ها', permissions: ['comments.view', 'comments.moderate'] },
  { group: 'دسته‌بندی و برچسب', permissions: ['categories.manage', 'tags.manage'] },
  { group: 'رسانه', permissions: ['media.view', 'media.upload', 'media.delete.own', 'media.delete.any'] },
  { group: 'ساختار سایت', permissions: ['pages.view', 'pages.manage', 'menus.manage'] },
  { group: 'فرم‌ها', permissions: ['forms.view', 'forms.manage'] },
  { group: 'کاربران', permissions: ['users.view', 'users.manage', 'roles.view'] },
  { group: 'سامانه', permissions: ['settings.view', 'settings.manage', 'reports.view', 'activity.view'] },
  { group: 'سنجش و آزمایش', permissions: ['analytics.view', 'analytics.manage'] },
]
