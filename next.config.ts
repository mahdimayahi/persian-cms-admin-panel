import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // خروجی build/dev قابل ایزوله‌سازی با متغیر محیطی است تا هارنس تست و بیلد
  // production بتوانند بدون تداخل با سرور توسعهٔ جاری (پوشهٔ .next) کار کنند.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
