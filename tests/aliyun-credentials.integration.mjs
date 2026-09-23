// Run after npm run build: node --experimental-strip-types tests/aliyun-credentials.integration.mjs
// Apple Container only. Creates a disposable PostgreSQL instance, never uses the user's database or DNS.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { Pool } from "pg";
import { encryptSecret, decryptSecret } from "../lib/crypto-store.ts";
import { withAcmeDb, readAcmeSettings, readPublicAcmeSettings, queueAcmeOrder, listAcmeOrders, storeIssuedCertificate } from "../lib/acme-store.ts";
import { migrateLegacyCredentials, readAliyunCredential, saveAliyunCredential, removeAliyunCredential } from "../lib/aliyun-credentials.ts";
import { readOrderIssuanceConfig, issueAcmeCertificate } from "../lib/acme-worker.ts";
import { manualDnsCases } from "./manual-dns.integration-cases.mjs";

const exec = promisify(execFile), suffix = randomBytes(5).toString("hex");
const containerId = `certops-multiaccount-${suffix}`;
const env = { ...process.env, POSTGRES_USER: "certops_test", POSTGRES_DB: `certops_test_${suffix}`, POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  CERT_ENCRYPTION_KEY: randomBytes(32).toString("hex"), CERTOPS_ADMIN_USERNAME: "integration-admin", CERTOPS_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
  CERTOPS_SESSION_SECRET: randomBytes(32).toString("hex"), ACME_SCHEDULER_ENABLED: "false", NODE_ENV: "production" };
// Optional loopback-only visual QA, backed exclusively by the disposable test database.
if (process.env.CERTOPS_TEST_PREVIEW === "true") env.CERTOPS_ADMIN_PASSWORD = "manual-dns-preview-only";
const command = (...args) => exec("container", args, { env, timeout: 90_000, maxBuffer: 1_000_000 });
let started = false, pool, server;
const scratch = await mkdtemp(path.join(tmpdir(), "certops-multiaccount-"));
async function waitUntil(check) {
  for (let i = 0; i < 45; i++) { try { if (await check()) return; } catch {} await delay(500); }
  throw new Error("Test service did not become ready");
}
try {
  await command("run", "--rm", "--detach", "--name", containerId, "--memory", "512M", "-e", "POSTGRES_USER", "-e", "POSTGRES_DB", "-e", "POSTGRES_PASSWORD", "docker.io/library/postgres:16-alpine");
  started = true;
  const inspection = JSON.parse((await command("inspect", containerId)).stdout)[0];
  const ip = JSON.stringify(inspection.networks || inspection.status?.networks).match(/192\.168\.\d+\.\d+/)?.[0];
  assert.ok(ip);
  await waitUntil(async () => { await command("exec", containerId, "pg_isready", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB); return true; });
  env.DATABASE_URL = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${ip}:5432/${env.POSTGRES_DB}`;
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.CERT_ENCRYPTION_KEY = env.CERT_ENCRYPTION_KEY;
  pool = new Pool({ connectionString: env.DATABASE_URL });
  assert.equal((await pool.query("SELECT to_regnamespace('cert_ops') AS schema")).rows[0].schema, null);
  await pool.query(await readFile("db/schema.sql", "utf8"));
  const currentSql = await readFile("db/acme.sql", "utf8");
  const legacySql = currentSql.replace(/CREATE TABLE IF NOT EXISTS cert_ops\.aliyun_credentials[\s\S]*?CREATE INDEX IF NOT EXISTS acme_orders_credential_idx ON cert_ops\.acme_orders\(credential_id\);\n/, "");
  assert.ok(!legacySql.includes("aliyun_credentials"));
  await pool.query(legacySql);
  const groupId = randomUUID(), legacyOrderId = randomUUID();
  const legacy = { email: "test@example.com", termsAgreed: true, accessKeyId: "test-account-a", accessKeySecret: randomBytes(24).toString("hex") };
  await pool.query("INSERT INTO cert_ops.groups(id,name) VALUES($1,'Integration group')", [groupId]);
  await pool.query("INSERT INTO cert_ops.acme_settings(id,config_encrypted) VALUES(1,$1)", [encryptSecret(JSON.stringify(legacy))]);
  await pool.query(`INSERT INTO cert_ops.acme_orders(id,name,group_id,domains,zone,environment,auto_renew)
    VALUES($1,'Legacy request',$2,'["legacy.example.com"]','example.com','staging',false)`, [legacyOrderId, groupId]);
  // A failed decryption must roll back DDL, the account, and every order binding together.
  process.env.CERT_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await assert.rejects(withAcmeDb(readPublicAcmeSettings), /ENCRYPTION_REQUIRED/);
  assert.equal((await pool.query("SELECT to_regclass('cert_ops.aliyun_credentials') AS table_name")).rows[0].table_name, null);
  process.env.CERT_ENCRYPTION_KEY = env.CERT_ENCRYPTION_KEY;
  const migrated = await withAcmeDb(readPublicAcmeSettings);
  assert.equal(migrated.credentials.length, 1);
  const accountA = migrated.credentials[0].id;
  assert.equal((await listAcmeOrders()).data[0].credentialId, accountA);
  assert.equal((await withAcmeDb((db) => readAliyunCredential(db, accountA))).accessKeySecret, legacy.accessKeySecret);
  const storedConfig = JSON.parse(decryptSecret((await pool.query("SELECT config_encrypted FROM cert_ops.acme_settings")).rows[0].config_encrypted));
  assert.deepEqual(storedConfig, { email: legacy.email, termsAgreed: true });
  await withAcmeDb(async (db) => { await db.query("BEGIN"); await migrateLegacyCredentials(db); await db.query("COMMIT"); });
  assert.equal((await withAcmeDb(readPublicAcmeSettings)).credentials.length, 1);
  console.log("Legacy migration, rollback, idempotence, and historical account binding passed.");

  const bKeys = { accessKeyId: "test-account-b", accessKeySecret: randomBytes(24).toString("hex") };
  const accountB = (await withAcmeDb((db) => saveAliyunCredential(db, { name: "Account B", ...bKeys }))).id;
  const input = { name: "Account B certificate", groupId, zone: "example.net", domains: ["example.net"], environment: "staging", autoRenew: true };
  await assert.rejects(queueAcmeOrder(input), /CREDENTIAL_REQUIRED/);
  await assert.rejects(queueAcmeOrder({ ...input, credentialId: randomUUID() }), /CREDENTIAL_NOT_FOUND/);
  const orderB = await queueAcmeOrder({ ...input, credentialId: accountB });
  assert.equal(orderB.credentialId, accountB);
  const resolve = (order) => withAcmeDb(async (db) => readOrderIssuanceConfig(db, order, await readAcmeSettings(db)));
  assert.equal((await resolve(orderB)).accessKeySecret, bKeys.accessKeySecret);
  assert.equal((await resolve({ credentialId: accountA })).accessKeySecret, legacy.accessKeySecret);
  await withAcmeDb((db) => saveAliyunCredential(db, { name: "B renamed" }, accountB));
  assert.equal((await resolve(orderB)).accessKeySecret, bKeys.accessKeySecret);
  await assert.rejects(withAcmeDb((db) => removeAliyunCredential(db, accountA)), /CREDENTIAL_IN_USE/);
  await assert.rejects(withAcmeDb((db) => removeAliyunCredential(db, accountB)), /CREDENTIAL_IN_USE/);
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(194827,2)");
    await assert.rejects(withAcmeDb((db) => saveAliyunCredential(db, { name: "B", ...bKeys }, accountB)), /CREDENTIAL_BUSY/);
  } finally { await lock.query("SELECT pg_advisory_unlock(194827,2)"); lock.release(); }
  // Exercise issuance's actual snapshot and cleanup path without contacting a CA or Aliyun.
  await withAcmeDb(async (db) => {
    const config = await readOrderIssuanceConfig(db, orderB, await readAcmeSettings(db));
    await assert.rejects(issueAcmeCertificate(db, orderB, config, {
      client: { auto: async (options) => {
        const authz = { identifier: { value: "example.net" } }, challenge = { type: "dns-01" };
        await options.challengeCreateFn(authz, challenge, "mock-txt-token");
        const snapshot = (await db.query("SELECT credentials_encrypted FROM cert_ops.acme_dns_records WHERE order_id=$1", [orderB.id])).rows[0];
        assert.deepEqual(JSON.parse(decryptSecret(snapshot.credentials_encrypted)), bKeys);
        await assert.rejects(withAcmeDb((other) => saveAliyunCredential(other, { name: "B", ...bKeys }, accountB)), /CREDENTIAL_BUSY/);
        await options.challengeRemoveFn(authz, challenge, "mock-txt-token");
        throw new Error("MOCK_CA_STOP");
      } },
      dns: async (action) => action === "AddDomainRecord" ? { RecordId: "mock-record" } : action === "DescribeDomainRecords" ? { TotalCount: 1, DomainRecords: { Record: [{ RecordId: "mock-record", RR: "_acme-challenge", Type: "TXT", Value: "mock-txt-token" }] } } : {},
      wait: async () => {},
    }), /MOCK_CA_STOP/);
  });
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM cert_ops.acme_dns_records")).rows[0].count, 0);
  const rotatedKeys = { accessKeyId: "test-account-b-rotated", accessKeySecret: randomBytes(24).toString("hex") };
  await withAcmeDb((db) => saveAliyunCredential(db, { name: "B rotated", ...rotatedKeys }, accountB));
  assert.equal((await resolve(orderB)).accessKeySecret, rotatedKeys.accessKeySecret);
  assert.equal((await resolve({ credentialId: accountA })).accessKeySecret, legacy.accessKeySecret);
  await exec("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-keyout", path.join(scratch, "key.pem"), "-out", path.join(scratch, "cert.pem"), "-subj", "/CN=example.net"]);
  const pem = await readFile(path.join(scratch, "cert.pem"), "utf8"), key = await readFile(path.join(scratch, "key.pem"), "utf8");
  await withAcmeDb((db) => storeIssuedCertificate(db, orderB, pem, key));
  const issued = (await listAcmeOrders()).data.find((order) => order.id === orderB.id);
  await withAcmeDb((db) => storeIssuedCertificate(db, issued, pem, key));
  assert.equal((await listAcmeOrders()).data.find((order) => order.id === orderB.id).credentialId, accountB);
  console.log("Account isolation, encrypted snapshots, guarded rotation/deletion, and renewal binding passed.");
  await manualDnsCases({ pool, groupId, scratch, exec });

  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  await waitUntil(async () => (await fetch(base + "/login", { signal: AbortSignal.timeout(1000) })).status === 200);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.equal((await fetch(base + "/api/acme/credentials", { method })).status, 401);
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: env.CERTOPS_ADMIN_USERNAME, password: env.CERTOPS_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  async function api(route, method = "GET", body, status = 200) {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  }
  const settings = await api("/api/acme/settings");
  assert.equal(settings.data.credentials.length, 2);
  for (const secret of [legacy.accessKeyId, legacy.accessKeySecret, rotatedKeys.accessKeyId, rotatedKeys.accessKeySecret]) assert.ok(!JSON.stringify(settings).includes(secret));
  await api("/api/acme/settings", "PUT", { email: "updated@example.com", termsAgreed: true });
  await api("/api/acme/settings", "PUT", { email: "updated@example.com", termsAgreed: true, ...bKeys }, 400);
  await api("/api/acme/credentials", "POST", { name: "Incomplete", accessKeyId: "test-only" }, 400);
  const created = (await api("/api/acme/credentials", "POST", { name: "Temporary C", accessKeyId: "test-account-c", accessKeySecret: "test-secret-c" }, 201)).data;
  await api("/api/acme/credentials", "PATCH", { id: created.id, name: "C renamed", accessKeyId: "", accessKeySecret: "" });
  await api("/api/acme/credentials", "DELETE", { id: accountB, confirmed: true }, 400);
  await api("/api/acme/credentials", "DELETE", { id: created.id }, 400);
  await api("/api/acme/credentials", "DELETE", { id: created.id, confirmed: true });
  await api("/api/acme/orders", "POST", input, 400);
  await api("/api/acme/dns-test", "POST", { zone: "example.net" }, 400);
  const queued = await api("/api/acme/orders", "POST", { ...input, zone: "example.org", domains: ["example.org"], credentialId: accountA }, 202);
  assert.equal(queued.data.credentialId, accountA);
  const orders = await api("/api/acme/orders");
  assert.equal(orders.data.find((order) => order.id === orderB.id).credentialName, "B rotated");
  assert.equal((await api("/api/acme/credentials")).data.length, 2);
  const manual = (await api("/api/acme/orders", "POST", { ...input, dnsProvider: "manual", autoRenew: false, zone: "api-manual.example.com", domains: ["api-manual.example.com"] }, 202)).data;
  assert.equal(manual.credentialId, null); assert.equal(manual.dnsProvider, "manual");
  await api("/api/acme/orders", "PATCH", { id: manual.id, action: "autoRenew", autoRenew: true }, 400);
  await api("/api/acme/orders", "PATCH", { id: manual.id, action: "continue" }, 400);
  await api("/api/acme/orders", "PATCH", { id: queued.data.id, action: "checkDns" }, 400);
  for (const action of ["checkDns", "continue"]) assert.equal((await fetch(base + "/api/acme/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: manual.id, action }) })).status, 401);
  await pool.query(`UPDATE cert_ops.acme_orders SET status='waiting_dns',manual_prepared=TRUE,manual_expires_at=NOW()+INTERVAL '1 hour',manual_state_encrypted=$2 WHERE id=$1`,
    [manual.id, encryptSecret(JSON.stringify({ order: {}, privateKey: "test-only-key", csr: "test-only-csr" }))]);
  assert.equal((await api("/api/acme/orders", "PATCH", { id: manual.id, action: "checkDns" })).ready, true);
  assert.equal((await api("/api/acme/orders", "PATCH", { id: manual.id, action: "continue" })).queued, true);
  await api("/api/acme/orders", "PATCH", { id: manual.id, action: "continue" }, 400);
  console.log("Authenticated API CRUD, required selection, masked responses, and runtime integration passed. No real DNS or CA calls.");
  if (process.env.CERTOPS_TEST_PREVIEW === "true") {
    await pool.query(`UPDATE cert_ops.acme_orders SET status='waiting_dns',stage='waiting_dns',manual_expires_at=NOW()+INTERVAL '1 hour',manual_records=$2 WHERE id=$1`,
      [manual.id, JSON.stringify(["sample-root-value", "sample-wildcard-value"].map((value, index) => ({ name: "_acme-challenge.api-manual.example.com", rr: "_acme-challenge", type: "TXT", value, domain: `${index ? "*." : ""}api-manual.example.com`, verified: false })))]);
    console.log(`Isolated visual QA ready: ${base} (integration-admin; test-only password in runner).`);
    await new Promise((resolve) => { const timer = setTimeout(resolve, 10 * 60_000); process.once("SIGTERM", () => { clearTimeout(timer); resolve(); }); });
  }
} finally {
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill("SIGTERM"); await exited; }
  if (globalThis.certOpsPool) await globalThis.certOpsPool.end();
  if (pool) await pool.end();
  if (started) await command("stop", containerId);
  await rm(scratch, { recursive: true, force: true });
}
