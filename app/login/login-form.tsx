"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { safeReturnHref } from "@/lib/app-route";
import { Brand } from "../brand";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error || "登录失败，请稍后重试");
        return;
      }
      router.replace(safeReturnHref(new URLSearchParams(window.location.search).get("next")));
      router.refresh();
    } catch {
      setError("无法连接到 CertOps，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-label="CertOps 登录">
        <Brand appearance="login" />
        <form className="login-form" onSubmit={submit}>
          <label>
            <span>用户名</span>
            <span className="login-input"><UserRound size={17} /><input autoFocus autoComplete="username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入管理员用户名" required /></span>
          </label>
          <div className="login-field">
            <label htmlFor="login-password">密码</label>
            <div className="login-input">
              <LockKeyhole size={17} aria-hidden="true" />
              <input id="login-password" autoComplete="current-password" name="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入管理员密码" required />
              <button className="login-password-toggle" type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-controls="login-password" title={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(value => !value)}>
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error && <div className="login-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
          <button className="login-submit" type="submit" disabled={submitting || !username || !password}>
            {submitting ? <><LoaderCircle className="spinning" size={17} />正在登录…</> : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
