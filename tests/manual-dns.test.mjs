import test from "node:test";
import assert from "node:assert/strict";
import { validateOrder } from "../lib/acme-validation.ts";
import { mapOrder } from "../lib/acme-store.ts";
import { checkManualRecords, manualSessionActive } from "../lib/acme-manual.ts";

const input = { groupId: "7fa0358d-8b8a-4c3d-bf85-5c9436e95e01", zone: "example.com", domains: ["example.com", "*.example.com"],
  environment: "staging", dnsProvider: "manual", autoRenew: false };

test("manual DNS accepts no credential but rejects automatic renewal and ambiguous credentials", () => {
  const result = validateOrder(input);
  assert.equal(result.dnsProvider, "manual"); assert.equal(result.credentialId, null);
  assert.equal(result.autoRenew, false);
  assert.throws(() => validateOrder({ ...input, autoRenew: true }), /MANUAL_DNS_ONLY/);
  assert.throws(() => validateOrder({ ...input, credentialId: input.groupId }), /MANUAL_DNS_ONLY/);
  assert.throws(() => validateOrder({ ...input, dnsProvider: "other" }), /INVALID_REQUEST/);
  assert.throws(() => validateOrder({ ...input, dnsProvider: "aliyun" }), /CREDENTIAL_REQUIRED/);
});

test("manual DNS checks every TXT value, preserving same-name wildcard records and per-record failures", async () => {
  const records = ["root-token", "wildcard-token"].map((value) => ({ name: "_acme-challenge.example.com", rr: "_acme-challenge", type: "TXT", value, domain: "example.com", verified: false }));
  const checked = await checkManualRecords(records, async (_name, value, options) => {
    assert.equal(options.timeoutMs, 0);
    if (value === "wildcard-token") throw new Error("DNS timeout");
  });
  assert.deepEqual(checked.map((record) => record.verified), [true, false]);
  assert.deepEqual(records.map((record) => record.verified), [false, false]);
  assert.equal(checked.length, 2);
});

test("expired, missing and invalid manual sessions cannot be continued", () => {
  for (const expires of [null, "bad", new Date(Date.now() - 1).toISOString()]) assert.throws(() => manualSessionActive(expires), /MANUAL_EXPIRED/);
  manualSessionActive(new Date(Date.now() + 60000).toISOString());
});

test("order responses expose only public manual DNS fields, never persisted signing state", () => {
  const mapped = mapOrder({ id: input.groupId, dns_provider: "manual", domains: input.domains, zone: input.zone,
    next_attempt_at: new Date(), manual_state_encrypted: "PRIVATE-MATERIAL", manual_confirmed: true, manual_records: [] });
  assert.equal(mapped.dnsProvider, "manual"); assert.equal(mapped.credentialId, null);
  assert.ok(!JSON.stringify(mapped).includes("PRIVATE-MATERIAL"));
  assert.ok(!("manual_confirmed" in mapped));
});
