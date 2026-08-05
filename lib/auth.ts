import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "certops_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

type SessionPayload = {
  version: 1;
  username: string;
  credentialVersion: string;
  expiresAt: number;
};

type AuthConfig = {
  username: string;
  password: string;
  sessionSecret: string;
};

function readAuthConfig(): AuthConfig | null {
  const username = (process.env.CERTOPS_ADMIN_USERNAME || "").trim();
  const password = process.env.CERTOPS_ADMIN_PASSWORD || "";
  const sessionSecret = process.env.CERTOPS_SESSION_SECRET || "";
  if (!username || username.length > 128 || password.length < 12 || sessionSecret.length < 32) return null;
  return { username, password, sessionSecret };
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function credentialVersion(config: AuthConfig) {
  return createHmac("sha256", config.sessionSecret)
    .update(`${config.username}\0${config.password}`)
    .digest("base64url")
    .slice(0, 24);
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function requestCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

export function isAuthConfigured() {
  return readAuthConfig() !== null;
}

export function verifyCredentials(username: string, password: string) {
  const config = readAuthConfig();
  if (!config) return false;
  return safeEqual(username.trim(), config.username) && safeEqual(password, config.password);
}

export function createSessionToken() {
  const config = readAuthConfig();
  if (!config) throw new Error("Authentication is not configured");
  const payload: SessionPayload = {
    version: 1,
    username: config.username,
    credentialVersion: credentialVersion(config),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, config.sessionSecret)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  const config = readAuthConfig();
  if (!config || !token) return null;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra || !safeEqual(suppliedSignature, signature(encoded, config.sessionSecret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (payload.version !== 1 || typeof payload.expiresAt !== "number" || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    if (payload.username !== config.username || payload.credentialVersion !== credentialVersion(config)) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function getRequestSession(request: Request) {
  return verifySessionToken(requestCookie(request, SESSION_COOKIE_NAME));
}

export function requireApiSession(request: Request) {
  if (getRequestSession(request)) return null;
  return NextResponse.json(
    { error: "登录已失效，请重新登录" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export function shouldUseSecureCookie(request: Request) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}
