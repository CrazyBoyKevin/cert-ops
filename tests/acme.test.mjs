import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AcmeError, normalizeDomain, validateOrder, challengeRecord, renewalWindow, publicAcmeError } from "../lib/acme-validation.ts";
import { waitForTxt, findChallengeRecords } from "../lib/aliyun-dns.ts";
import { publicSettings, requireConfigured, storeIssuedCertificate } from "../lib/acme-store.ts";
import { publicCredential } from "../lib/aliyun-credentials.ts";
import { cleanupRecord, issueAcmeCertificate } from "../lib/acme-worker.ts";
import { encryptSecret, decryptSecret } from "../lib/crypto-store.ts";
import { acmeMessages } from "../lib/acme-i18n.ts";

const groupId = "7fa0358d-8b8a-4c3d-bf85-5c9436e95e01";
const baseOrder = { id: groupId, credentialId: groupId, name: "Test certificate", groupId, zone: "example.com", domains: ["example.com", "*.example.com"], environment: "staging", autoRenew: true, certificateId: null };
const config = { email: "admin@example.com", accessKeyId: "id-only-for-tests", accessKeySecret: "secret-only-for-tests", termsAgreed: true };

test("validates zone boundaries, wildcard rules, Unicode and domains without accepting URLs", () => {
  assert.equal(normalizeDomain("  EXAMPLE.COM.  "), "example.com");
  assert.equal(normalizeDomain("*.例子.com"), "*.xn--fsqu00a.com");
  for (const value of ["https://example.com", "example.com/path", "example.com?x=1", "example.com:443", "example.com#x", "127.0.0.1", "localhost", "*.*.example.com", "-bad.example.com", "foo_bar.com", "user@example.com", "%65xample.com"]) {
    assert.throws(() => normalizeDomain(value), /INVALID_DOMAIN/, value);
  }
  const order = validateOrder({ ...baseOrder, domains: "example.com\n*.example.com\nEXAMPLE.com" });
  assert.deepEqual(order.domains, ["example.com", "*.example.com"]);
  assert.throws(() => validateOrder({ ...baseOrder, domains: ["otherexample.com"] }), /DOMAIN_OUTSIDE_ZONE/);
  assert.throws(() => validateOrder({ ...baseOrder, environment: "https://evil.test" }), /INVALID_ENVIRONMENT/);
  assert.throws(() => validateOrder({ ...baseOrder, domains: [] }), /INVALID_DOMAINS/);
  assert.equal(challengeRecord("*.example.com", "example.com"), "_acme-challenge");
  assert.equal(challengeRecord("api.example.com", "example.com"), "_acme-challenge.api");
  assert.throws(() => challengeRecord("evil.com", "example.com"), /DOMAIN_OUTSIDE_ZONE/);
});

test("renewal threshold adapts to certificate lifetime, capped at 30 days", () => {
  const start = "2026-01-01T00:00:00Z", day = 86400_000;
  for (const days of [6, 45, 64, 90, 365]) {
    assert.equal(renewalWindow(start, new Date(Date.parse(start) + days * day).toISOString()), Math.min(30, days / 3) * day);
  }
});

test("credentials never appear in settings responses or raw SDK errors", () => {
  const output = publicSettings(config, [publicCredential({ ...config, id: groupId, name: "Test account" })]);
  assert.equal(output.credentialsConfigured, true);
  assert.ok(!JSON.stringify(output).includes(config.accessKeySecret));
  assert.ok(!JSON.stringify(output).includes(config.accessKeyId));
  assert.equal(publicAcmeError(new Error("request https://secret?AccessKeySecret=abc")), "ISSUANCE_FAILED");
  assert.equal(publicAcmeError(new Error("rateLimited: too many requests")), "RATE_LIMITED");
  assert.equal(publicAcmeError(new AcmeError("DNS_ACCESS_DENIED")), "DNS_ACCESS_DENIED");
  const previous = process.env.CERT_ENCRYPTION_KEY;
  try {
    process.env.CERT_ENCRYPTION_KEY = "replace-with-at-least-32-random-characters";
    assert.throws(() => requireConfigured(config), /ENCRYPTION_REQUIRED/);
    process.env.CERT_ENCRYPTION_KEY = "random-test-key-with-more-than-thirty-two-characters";
    assert.throws(() => requireConfigured({ ...config, termsAgreed: false }), /CONFIG_REQUIRED/);
    requireConfigured(config);
  } finally { if (previous === undefined) delete process.env.CERT_ENCRYPTION_KEY; else process.env.CERT_ENCRYPTION_KEY = previous; }
});

test("propagation joins split TXT strings and requires both resolvers", async () => {
  const servers = [];
  await waitForTxt("_acme-challenge.example.com", "abc123", { timeoutMs: 50, intervalMs: 1, lookup: async (server) => { servers.push(server); return [["abc", "123"]]; } });
  assert.equal(new Set(servers).size, 2);
  await assert.rejects(waitForTxt("_acme-challenge.example.com", "abc123", { timeoutMs: 5, intervalMs: 1,
    lookup: async (server) => server === "223.5.5.5" ? [["abc123"]] : [["unrelated-record"]] }), /DNS_PROPAGATION_TIMEOUT/);
});

test("DNS cleanup only selects exact challenge name/type/value, even if API returns extra records", async () => {
  const records = await findChallengeRecords(async () => ({ TotalCount: 4, DomainRecords: { Record: [
    { RecordId: "mine", RR: "_acme-challenge", Type: "TXT", Value: "token" },
    { RecordId: "other-owner", RR: "_acme-challenge", Type: "TXT", Value: "other" },
    { RecordId: "wrong-name", RR: "_acme-challenge.foo", Type: "TXT", Value: "token" },
    { RecordId: "cname", RR: "_acme-challenge", Type: "CNAME", Value: "token" },
  ] } }), "example.com", "_acme-challenge", "token");
  assert.deepEqual(records.map((r) => r.RecordId), ["mine"]);
});

test("cleanup recovers an unrecorded Aliyun ID from its durable intent and preserves unrelated records", async () => {
  const actions = [];
  const db = { query: async (sql) => { actions.push(sql); return { rows: [] }; } };
  const row = { id: "intent", zone: "example.com", rr: "_acme-challenge", value: "random-token", record_id: null,
    credentials_encrypted: encryptSecret(JSON.stringify(config)), created_at: new Date(Date.now() - 600_000) };
  await cleanupRecord(db, row, async (action, params) => {
    actions.push(action);
    if (action === "DescribeDomainRecords") return { TotalCount: 2, DomainRecords: { Record: [
      { RecordId: "mine", RR: row.rr, Type: "TXT", Value: row.value },
      { RecordId: "keep", RR: row.rr, Type: "TXT", Value: "other-user" },
    ] } };
    assert.deepEqual(params, { RecordId: "mine" }); return {};
  });
  assert.equal(actions.filter((a) => a === "DeleteDomainRecord").length, 1);
  assert.match(actions.at(-1), /DELETE FROM cert_ops.acme_dns_records/);
  await assert.rejects(cleanupRecord(db, { ...row, created_at: new Date() }, async () => ({ TotalCount: 0, DomainRecords: { Record: [] } })), /CLEANUP_PENDING/);
});

test("issuance persists DNS intent before creation, waits for propagation, then cleans only its record", async () => {
  const actions = [], records = [];
  const db = { query: async (sql, args = []) => {
    if (sql.startsWith("INSERT INTO cert_ops.acme_dns_records")) {
      actions.push("intent"); records.push({ id: args[0], order_id: args[1], zone: args[2], rr: args[3], value: args[4], credentials_encrypted: args[5], created_at: new Date() });
    }
    if (sql.startsWith("UPDATE cert_ops.acme_dns_records")) records[0].record_id = args[1];
    if (sql.startsWith("SELECT * FROM cert_ops.acme_dns_records")) return { rows: records };
    return { rows: [], rowCount: 1 };
  } };
  await assert.rejects(issueAcmeCertificate(db, baseOrder, config, {
    client: { auto: async (opts) => {
      assert.deepEqual(opts.challengePriority, ["dns-01"]);
      const authz = { identifier: { value: "example.com" } }, challenge = { type: "dns-01" };
      await opts.challengeCreateFn(authz, challenge, "challenge-token");
      await opts.challengeRemoveFn(authz, challenge, "challenge-token");
      throw new AcmeError("MOCK_CA_STOP");
    } },
    dns: async (action) => {
      actions.push(action);
      if (action === "AddDomainRecord") { assert.ok(actions.includes("intent")); return { RecordId: "created-id" }; }
      if (action === "DescribeDomainRecords") return { TotalCount: 1, DomainRecords: { Record: [{ RecordId: "created-id", RR: "_acme-challenge", Value: "challenge-token", Type: "TXT" }] } };
      return {};
    },
    wait: async (name, value) => { assert.equal(name, "_acme-challenge.example.com"); assert.equal(value, "challenge-token"); actions.push("propagated"); },
  }), /MOCK_CA_STOP/);
  assert.deepEqual(actions, ["intent", "AddDomainRecord", "propagated", "DescribeDomainRecords", "DeleteDomainRecord"]);
});

test("renewal atomically replaces certificate/key, preserves name/group, resets reminder deduplication, and rolls back failure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "certops-acme-test-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-subj", "/CN=example.com", "-addext", "subjectAltName=DNS:example.com,DNS:*.example.com"], { stdio: "ignore" });
    const pem = readFileSync(path.join(dir, "cert.pem"), "utf8"), key = readFileSync(path.join(dir, "key.pem"), "utf8");
    const queries = [];
    const db = { query: async (sql, args) => { queries.push([sql, args]); return { rows: [{ id: groupId, group_id: groupId }], rowCount: 1 }; } };
    await storeIssuedCertificate(db, { ...baseOrder, certificateId: groupId }, pem, key);
    const update = queries.find(([sql]) => sql.startsWith("UPDATE cert_ops.certificates"));
    assert.ok(update); assert.ok(!update[0].includes("name=")); assert.ok(!update[0].includes("group_id="));
    assert.equal(update[1][9], pem); assert.notEqual(update[1][10], key); assert.equal(decryptSecret(update[1][10]), key);
    assert.ok(queries.some(([sql]) => sql.startsWith("DELETE FROM cert_ops.notification_logs")));
    assert.equal(queries.at(-1)[0], "COMMIT");
    queries.length = 0;
    await assert.rejects(storeIssuedCertificate({ query: async (sql) => { queries.push([sql]); if (sql.startsWith("UPDATE cert_ops.certificates")) throw new Error("storage-down"); return { rows: [{ id: groupId }], rowCount: 1 }; } }, { ...baseOrder, certificateId: groupId }, pem, key), /storage-down/);
    assert.equal(queries.at(-1)[0], "ROLLBACK");
    await assert.rejects(storeIssuedCertificate(db, { ...baseOrder, domains: ["wrong.example.com"] }, pem, key), /INVALID_CERTIFICATE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("all ACME UI messages exist for all five interface languages", () => {
  for (const language of ["zh-CN", "zh-TW", "en", "ja", "ko"]) {
    for (const [key, value] of Object.entries(acmeMessages(language))) assert.ok(typeof value === "string" && value.length, `${language}.${key}`);
  }
});
