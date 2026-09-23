import assert from "node:assert/strict";
import test from "node:test";
import { validateOrder } from "../lib/acme-validation.ts";
import { publicCredential, readAliyunCredential, validateCredentialInput, saveAliyunCredential, removeAliyunCredential } from "../lib/aliyun-credentials.ts";
import { encryptSecret, decryptSecret } from "../lib/crypto-store.ts";

const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const keys = { accessKeyId: "test-access-key-b", accessKeySecret: "test-secret-b" };

test("new certificate requests require an explicit credential ID", () => {
  const input = { groupId: a, zone: "example.com", domains: ["example.com"], environment: "staging", autoRenew: true };
  assert.throws(() => validateOrder(input), /CREDENTIAL_REQUIRED/);
  assert.throws(() => validateOrder({ ...input, credentialId: "bad" }), /INVALID_ID/);
  assert.equal(validateOrder({ ...input, credentialId: b }).credentialId, b);
});

test("credential validation requires a named pair, with blank preservation only for editing", () => {
  assert.throws(() => validateCredentialInput({ name: " " }, true), /CREDENTIAL_NAME_REQUIRED/);
  assert.throws(() => validateCredentialInput({ name: "Account" }, true), /CREDENTIAL_PAIR_REQUIRED/);
  assert.throws(() => validateCredentialInput({ name: "Account", accessKeyId: "only-id" }, false), /CREDENTIAL_PAIR_REQUIRED/);
  assert.throws(() => validateCredentialInput({ name: "Account", accessKeyId: {} }, true), /INVALID_REQUEST/);
  assert.deepEqual(validateCredentialInput({ name: " Account " }, false), { name: "Account", accessKeyId: "", accessKeySecret: "" });
});

test("credential resolution uses the bound account and never falls back when missing", async () => {
  const calls = [];
  const db = { query: async (sql, args) => {
    calls.push(args[0]);
    return args[0] === b ? { rowCount: 1, rows: [{ id: b, name: "Account B", config_encrypted: encryptSecret(JSON.stringify(keys)) }] } : { rowCount: 0, rows: [] };
  } };
  assert.deepEqual(await readAliyunCredential(db, b), { id: b, name: "Account B", ...keys });
  // Automatic renewal resolves the same bound ID again, not the first available account.
  assert.equal((await readAliyunCredential(db, b)).accessKeySecret, keys.accessKeySecret);
  await assert.rejects(readAliyunCredential(db, a), /CREDENTIAL_NOT_FOUND/);
  await assert.rejects(readAliyunCredential(db, null), /CREDENTIAL_REQUIRED/);
  assert.deepEqual(calls, [b, b, a]);
  const publicData = publicCredential({ id: b, name: "Account B", ...keys }, 2);
  assert.equal(publicData.orderCount, 2);
  assert.ok(!JSON.stringify(publicData).includes(keys.accessKeyId));
  assert.ok(!JSON.stringify(publicData).includes(keys.accessKeySecret));
});

test("credential creation encrypts both keys and editing blank keys preserves stored secrets", async () => {
  const queries = [];
  const db = { query: async (sql, args) => { queries.push([sql, args]); return { rowCount: 1, rows: [{ id: b }] }; } };
  await saveAliyunCredential(db, { name: "Account B", ...keys });
  const inserted = queries.find(([sql]) => sql.startsWith("INSERT"));
  assert.ok(!inserted[1][2].includes(keys.accessKeySecret));
  assert.deepEqual(JSON.parse(decryptSecret(inserted[1][2])), keys);
  queries.length = 0;
  await saveAliyunCredential(db, { name: "Renamed" }, b);
  assert.ok(queries.some(([sql]) => sql.startsWith("UPDATE cert_ops.aliyun_credentials SET name=$2, updated_at")));
  assert.ok(!queries.some(([sql]) => sql.includes("config_encrypted=")));
});

test("in-use credentials cannot be deleted, even when auto-renew is off", async () => {
  const queries = [];
  const db = { query: async (sql) => { queries.push(sql); return { rowCount: 1, rows: [{ id: b }] }; } };
  await assert.rejects(removeAliyunCredential(db, b), /CREDENTIAL_IN_USE/);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.some((sql) => sql.startsWith("DELETE")));
});

test("key rotation refuses an active worker or pending DNS cleanup", async () => {
  for (const locked of [false, true]) {
    const queries = [];
    const db = { query: async (sql) => { queries.push(sql); return { rowCount: 1, rows: [{ locked }] }; } };
    await assert.rejects(saveAliyunCredential(db, { name: "Account B", ...keys }, b), /CREDENTIAL_BUSY/);
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.ok(!queries.some((sql) => sql.startsWith("UPDATE")));
  }
});
