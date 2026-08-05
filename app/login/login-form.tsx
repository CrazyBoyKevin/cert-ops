"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      router.replace("/");
      router.refresh();
    } catch {
      setError("无法连接到 CertOps，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="login-brand-mark"><ShieldCheck size={25} /></span>
          <span>CertOps</span>
        </div>
        <div className="login-heading">
          <span className="login-lock"><LockKeyhole size={20} /></span>
          <h1 id="login-title">登录管理平台</h1>
          <p>使用容器环境变量中配置的管理员账号登录</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label>
            <span>用户名</span>
            <span className="login-input"><UserRound size={17} /><input autoFocus autoComplete="username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入管理员用户名" required /></span>
          </label>
          <label>
            <span>密码</span>
            <span className="login-input"><LockKeyhole size={17} /><input autoComplete="current-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入管理员密码" required /></span>
          </label>
          {error && <div className="login-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
          <button className="login-submit" type="submit" disabled={submitting || !username || !password}>
            {submitting ? <><LoaderCircle className="spinning" size={17} />正在登录…</> : "登录"}
          </button>
        </form>
        <p className="login-footnote">账号由系统管理员在部署时配置，本系统不提供在线注册。</p>
      </section>
    </main>
  );
}
