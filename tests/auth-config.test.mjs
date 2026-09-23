import assert from "node:assert/strict";
import test from "node:test";
import { readAuthConfig } from "../lib/auth-config.ts";

const preview = {
  NODE_ENV: "development",
  CERTOPS_LOCAL_PREVIEW: "true",
  CERTOPS_ADMIN_USERNAME: "admin",
  CERTOPS_ADMIN_PASSWORD: "admin123",
  CERTOPS_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
};

test("short preview password requires explicit development opt-in", () => {
  assert.equal(readAuthConfig(preview)?.username, "admin");
  assert.equal(readAuthConfig({ ...preview, CERTOPS_LOCAL_PREVIEW: "false" }), null);
  assert.equal(readAuthConfig({ ...preview, CERTOPS_LOCAL_PREVIEW: undefined }), null);
  assert.equal(readAuthConfig({ ...preview, NODE_ENV: "production" }), null);
  assert.equal(readAuthConfig({ ...preview, NODE_ENV: undefined }), null);
});

test("preview still requires a username, session signing secret, and minimum password", () => {
  assert.equal(readAuthConfig({ ...preview, CERTOPS_ADMIN_USERNAME: "" }), null);
  assert.equal(readAuthConfig({ ...preview, CERTOPS_SESSION_SECRET: "short" }), null);
  assert.equal(readAuthConfig({ ...preview, CERTOPS_ADMIN_PASSWORD: "12345" }), null);
  assert.ok(readAuthConfig({ ...preview, NODE_ENV: "production", CERTOPS_ADMIN_PASSWORD: "production-password-long-enough" }));
});
