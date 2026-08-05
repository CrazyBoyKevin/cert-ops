import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CertOps · SSL 证书管理平台",
  description: "集中管理、监控和提醒 SSL 证书，守护每一次安全连接。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
