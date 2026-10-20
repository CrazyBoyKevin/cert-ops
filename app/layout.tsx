import type { Metadata } from "next";
import "./globals.css";
import { BRAND_ICON_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "CertOps · SSL 证书管理平台",
  description: "集中管理、监控和提醒 SSL 证书，守护每一次安全连接。",
  icons: {
    icon: BRAND_ICON_URL,
    shortcut: BRAND_ICON_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
