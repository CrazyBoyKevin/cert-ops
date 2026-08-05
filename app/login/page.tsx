import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "登录 · CertOps",
  description: "登录 CertOps 证书管理平台",
};

export default function LoginPage() {
  return <LoginForm />;
}
