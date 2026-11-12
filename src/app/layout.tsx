import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "پنل مدیریت محتوا | سامانه یکپارچه تولید و انتشار محتوا",
  description:
    "سامانه عملیاتی مدیریت محتوا با گردش کار بازبینی، نقش‌ها و مجوزها، کتابخانه رسانه، تاریخچه فعالیت و گزارش‌ها",
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
