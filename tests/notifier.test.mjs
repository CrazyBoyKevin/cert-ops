import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { signedFeishuPayload } from "../lib/notifier.ts";

test("keeps Feishu payload unchanged when signing is disabled", () => {
  const payload = { msg_type: "text", content: { text: "hello" } };
  assert.equal(signedFeishuPayload(payload, ""), payload);
});

test("adds Feishu timestamp and signature when a secret is configured", () => {
  const now = 1_599_360_473_000;
  const secret = "test-secret";
  const timestamp = "1599360473";
  const expected = createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
  const signed = signedFeishuPayload({ msg_type: "text" }, secret, now);
  assert.equal(signed.timestamp, timestamp);
  assert.equal(signed.sign, expected);
});
