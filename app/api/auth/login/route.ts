import { NextResponse } from "next/server";
import {
  createSessionToken,
  isAuthConfigured,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  shouldUseSecureCookie,
  verifyCredentials,
} from "@/lib/auth";

export const runtime = "nodejs";

const attempts = new Map<string, { failures: number; resetAt: number }>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_TRACKED_CLIENTS = 1_000;

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function pruneAttempts(now: number) {
  for (const [key, value] of attempts) {
    if (value.resetAt <= now) attempts.delete(key);
  }
  while (attempts.size >= MAX_TRACKED_CLIENTS) {
    const oldest = attempts.keys().next().value;
    if (typeof oldest !== "string") break;
    attempts.delete(oldest);
  }
}

async function login(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "管理员登录尚未配置，请检查容器环境变量" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = Date.now();
  pruneAttempts(now);
  const address = clientAddress(request);
  const current = attempts.get(address);
  if (current && current.resetAt > now && current.failures >= MAX_FAILURES) {
    return NextResponse.json(
      { error: "登录失败次数过多，请 15 分钟后再试" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } },
    );
  }
  if (current && current.resetAt <= now) attempts.delete(address);

  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!verifyCredentials(username, password)) {
    const state = attempts.get(address);
    attempts.set(address, {
      failures: (state?.failures || 0) + 1,
      resetAt: state?.resetAt && state.resetAt > now ? state.resetAt : now + ATTEMPT_WINDOW_MS,
    });
    return NextResponse.json(
      { error: "用户名或密码错误" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  attempts.delete(address);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export { login as POST };
