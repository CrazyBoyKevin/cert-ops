export type AuthConfig = {
  username: string;
  password: string;
  sessionSecret: string;
};

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const username = (env.CERTOPS_ADMIN_USERNAME || "").trim();
  const password = env.CERTOPS_ADMIN_PASSWORD || "";
  const sessionSecret = env.CERTOPS_SESSION_SECRET || "";
  // Explicit local development opt-in; production always requires 12 characters.
  const localPreview = env.NODE_ENV === "development" && env.CERTOPS_LOCAL_PREVIEW === "true";
  const minimumPasswordLength = localPreview ? 6 : 12;
  if (!username || username.length > 128 || password.length < minimumPasswordLength || sessionSecret.length < 32) return null;
  return { username, password, sessionSecret };
}
