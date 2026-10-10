import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);
const suffix = randomBytes(4).toString("hex");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const image = `docker.io/easitwch/cert-ops:${version}`;
const env = { ...process.env, POSTGRES_USER: "certops", POSTGRES_DB: "certops", POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  CERTOPS_ADMIN_USERNAME: "release-admin", CERTOPS_ADMIN_PASSWORD: randomBytes(24).toString("hex"),
  CERTOPS_SESSION_SECRET: randomBytes(32).toString("hex"), CERT_ENCRYPTION_KEY: randomBytes(32).toString("hex"), ACME_SCHEDULER_ENABLED: "false" };
const active = [];
const command = async (...args) => (await exec("container", args, { env, timeout: 90_000, maxBuffer: 2_000_000 })).stdout;
async function ipOf(id) {
  const data = JSON.parse(await command("inspect", id))[0];
  const networks = data.networks || data.status?.networks;
  const addresses = JSON.stringify(networks).match(/192\.168\.\d+\.\d+/g);
  if (!addresses?.length) throw new Error(`Missing network address; inspect keys: ${Object.keys(data).join(",")}`);
  return addresses[0];
}
async function waitUntil(check, description) {
  for (let i = 0; i < 60; i++) { try { if (await check()) return; } catch {} await delay(1000); }
  throw new Error(`Timed out: ${description}`);
}
const scratch = await mkdtemp(path.join(tmpdir(), "certops-release-smoke-"));
let pool;
try {
  const dbId = `certops-release-db-${suffix}`;
  await command("run", "--rm", "--detach", "--name", dbId, "-e", "POSTGRES_USER", "-e", "POSTGRES_DB", "-e", "POSTGRES_PASSWORD", "docker.io/library/postgres:16-alpine");
  active.push(dbId);
  const dbIp = await ipOf(dbId);
  await waitUntil(async () => { await command("exec", dbId, "pg_isready", "-U", "certops", "-d", "certops"); return true; }, "PostgreSQL readiness");
  env.DATABASE_URL = `postgresql://certops:${env.POSTGRES_PASSWORD}@${dbIp}:5432/certops`;
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.CERT_ENCRYPTION_KEY = env.CERT_ENCRYPTION_KEY;
  const { withAcmeDb, storeIssuedCertificate } = await import("../lib/acme-store.ts");
  console.log("Isolated PostgreSQL ready; no user database or real DNS credentials used.");
  for (const arch of ["arm64", "amd64"]) {
    const appId = `certops-release-${arch}-${suffix}`;
    const args = ["run", "--rm", "--detach", "--name", appId, "--arch", arch, "--memory", "1G"];
    for (const key of ["DATABASE_URL", "CERTOPS_ADMIN_USERNAME", "CERTOPS_ADMIN_PASSWORD", "CERTOPS_SESSION_SECRET", "CERT_ENCRYPTION_KEY", "ACME_SCHEDULER_ENABLED"]) args.push("-e", key);
    args.push(image); await command(...args); active.push(appId);
    const base = `http://${await ipOf(appId)}:3000`;
    await waitUntil(async () => (await fetch(base + "/login", { signal: AbortSignal.timeout(2000) })).status === 200, `${arch} app readiness`);
    assert.equal((await fetch(base + "/api/acme/orders")).status, 401);
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: env.CERTOPS_ADMIN_USERNAME, password: env.CERTOPS_ADMIN_PASSWORD }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    async function api(route, body, method = "POST", expected = 200) {
      const response = await fetch(base + route, { headers: { Cookie: cookie, "Content-Type": "application/json" }, ...(body ? { method, body: JSON.stringify(body) } : {}) });
      const json = await response.json();
      assert.equal(response.status, expected, `${arch} ${route}: ${JSON.stringify(json)}`);
      return json;
    }
    const certs = await api("/api/certificates"); assert.equal(certs.storage, "postgresql");
    const groups = (await api("/api/groups")).data;
    const settings = { name: `Account B ${arch}`, accessKeyId: "SMOKE-ONLY-NOT-VALID", accessKeySecret: randomBytes(24).toString("hex") };
    await api("/api/acme/settings", { email: "release-smoke@example.com", termsAgreed: true }, "PUT");
    assert.equal((await fetch(base + "/api/acme/credentials")).status, 401);
    const accountA = (await api("/api/acme/credentials", { name: `Account A ${arch}`, accessKeyId: "SMOKE-A-NOT-VALID", accessKeySecret: randomBytes(24).toString("hex") }, "POST", 201)).data.id;
    const accountB = (await api("/api/acme/credentials", settings, "POST", 201)).data.id;
    const publicConfig = await api("/api/acme/settings");
    assert.equal(publicConfig.data.credentialsConfigured, true);
    assert.ok(!JSON.stringify(publicConfig).includes(settings.accessKeySecret));
    assert.ok(!JSON.stringify(publicConfig).includes(settings.accessKeyId));
    assert.equal(publicConfig.data.credentials.length, 2);
    const request = { name: `Smoke ${arch}`, groupId: groups[0].id, zone: "example.com", domains: ["example.com", "*.example.com"], environment: "staging", autoRenew: false, credentialId: accountB };
    assert.equal((await api("/api/acme/orders", { ...request, credentialId: undefined }, "POST", 400)).error, "CREDENTIAL_REQUIRED");
    const order = (await api("/api/acme/orders", request, "POST", 202)).data;
    assert.equal(order.credentialId, accountB);
    const pending = await api("/api/acme/orders?scope=pending&page=1");
    assert.equal(pending.total, 1); assert.equal(pending.data[0].id, order.id);
    await api("/api/acme/orders?scope=pending&page=-1", undefined, "GET", 400);
    assert.equal((await api("/api/acme/credentials", { id: accountB, confirmed: true }, "DELETE", 400)).error, "CREDENTIAL_IN_USE");
    await api("/api/acme/credentials", { id: accountB, name: "Account B renamed", accessKeyId: "", accessKeySecret: "" }, "PATCH");
    const { readOrderIssuanceConfig } = await import("../lib/acme-worker.ts");
    const { readAcmeSettings } = await import("../lib/acme-store.ts");
    await withAcmeDb(async (db) => {
      const bound = await readOrderIssuanceConfig(db, order, await readAcmeSettings(db));
      assert.equal(bound.accessKeySecret, settings.accessKeySecret);
    });
    assert.equal((await api("/api/acme/orders", request, "POST", 400)).error, "DUPLICATE_ORDER");
    await exec("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-keyout", path.join(scratch, "key.pem"), "-out", path.join(scratch, "cert.pem"), "-subj", "/CN=example.com", "-addext", "subjectAltName=DNS:example.com,DNS:*.example.com"]);
    const pem = await readFile(path.join(scratch, "cert.pem"), "utf8"), key = await readFile(path.join(scratch, "key.pem"), "utf8");
    await withAcmeDb(async (db) => {
      const encrypted = (await db.query("SELECT config_encrypted FROM cert_ops.aliyun_credentials WHERE id=$1", [accountB])).rows[0].config_encrypted;
      assert.ok(!encrypted.includes(settings.accessKeySecret));
      await storeIssuedCertificate(db, order, pem, key);
    });
    const certificate = (await api("/api/certificates")).data.find((cert) => cert.name === request.name);
    assert.ok(certificate?.hasPrivateKey);
    assert.equal((await api("/api/acme/orders?scope=pending")).total, 0);
    assert.equal((await api(`/api/acme/orders?certificateId=${certificate.id}`)).data[0].id, order.id);
    assert.equal((await api(`/api/acme/orders?id=${order.id}`)).data[0].certificateId, certificate.id);
    await api("/api/certificates", { id: certificate.id, name: "Renamed on renewal", groupId: groups[1].id }, "PATCH");
    const managed = (await api("/api/acme/orders")).data.find((item) => item.id === order.id);
    assert.equal(managed.credentialId, accountB);
    assert.equal(managed.credentialName, "Account B renamed");
    await withAcmeDb(async (db) => {
      await storeIssuedCertificate(db, managed, pem, key);
      const result = await db.query("SELECT name, group_id FROM cert_ops.certificates WHERE id=$1", [certificate.id]);
      assert.equal(result.rows[0].name, "Renamed on renewal"); assert.equal(result.rows[0].group_id, groups[1].id);
    });
    const exported = await api("/api/certificates/contents", { id: certificate.id });
    assert.equal(exported.data.privateKey, key);
    assert.equal(exported.data.certificatePem.trim(), pem.trim());
    const zipResponse = await fetch(base + "/api/certificates/contents", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ id: certificate.id, format: "zip" }) });
    assert.equal(zipResponse.status, 200);
    const zip = Buffer.from(await zipResponse.arrayBuffer());
    assert.equal(zipResponse.headers.get("content-type"), "application/zip");
    assert.equal(zipResponse.headers.get("content-disposition"), 'attachment; filename="example.com.keys.zip"');
    assert.match(zipResponse.headers.get("cache-control"), /no-store/);
    const zipPath = path.join(scratch, `${arch}.zip`);
    await writeFile(zipPath, zip);
    assert.deepEqual((await exec("unzip", ["-Z1", zipPath])).stdout.trim().split("\n"), ["example.com.pem", "example.com.key"]);
    assert.equal((await exec("unzip", ["-p", zipPath, "example.com.pem"])).stdout.trim(), pem.trim());
    assert.equal((await exec("unzip", ["-p", zipPath, "example.com.key"])).stdout, key);
    await api("/api/certificates", { id: certificate.id, confirmed: true }, "DELETE");
    assert.equal((await api("/api/acme/orders")).data.length, 0);
    await api("/api/acme/credentials", { id: accountA, confirmed: true }, "DELETE");
    await api("/api/acme/credentials", { id: accountB, confirmed: true }, "DELETE");
    // Manual DNS requires no saved cloud credentials. Simulate reusable CA authorization
    // (zero TXT records), so this exercises the real image API without external DNS/CA.
    const manual = (await api("/api/acme/orders", { ...request, dnsProvider: "manual", credentialId: null }, "POST", 202)).data;
    assert.equal(manual.credentialId, null); assert.equal(manual.dnsProvider, "manual");
    assert.equal((await api("/api/acme/orders", { id: manual.id, action: "autoRenew", autoRenew: true }, "PATCH", 400)).error, "MANUAL_DNS_ONLY");
    await api("/api/acme/orders", { id: manual.id, action: "continue" }, "PATCH", 400);
    const { encryptSecret } = await import("../lib/crypto-store.ts");
    await withAcmeDb((db) => db.query(`UPDATE cert_ops.acme_orders SET status='waiting_dns',stage='waiting_dns',
      manual_prepared=TRUE,manual_state_encrypted=$2,manual_expires_at=NOW()+INTERVAL '1 hour' WHERE id=$1`,
      [manual.id, encryptSecret(JSON.stringify({ order: {}, privateKey: "smoke-only-private-key", csr: "smoke-only-csr" }))]));
    assert.equal((await api("/api/acme/orders", { id: manual.id, action: "checkDns" }, "PATCH")).ready, true);
    const manualPublic = await api("/api/acme/orders");
    assert.ok(!JSON.stringify(manualPublic).includes("smoke-only-private-key"));
    assert.equal(manualPublic.data[0].status, "dns_ready");
    assert.equal((await api("/api/acme/orders", { id: manual.id, action: "continue" }, "PATCH")).queued, true);
    await api("/api/acme/orders", { id: manual.id, action: "continue" }, "PATCH", 400);
    await withAcmeDb((db) => storeIssuedCertificate(db, manual, pem, key));
    const manualIssued = (await api("/api/acme/orders")).data[0];
    assert.equal(manualIssued.status, "issued"); assert.equal(manualIssued.autoRenew, false);
    assert.equal((await api("/api/acme/orders?scope=pending")).total, 0);
    await api("/api/acme/orders", { id: manual.id, action: "renew" }, "PATCH");
    assert.equal((await api("/api/acme/orders?scope=pending")).total, 0);
    const renewal = (await api(`/api/acme/orders?certificateId=${manualIssued.certificateId}`)).data[0];
    assert.equal(renewal.status, "queued"); assert.equal(renewal.id, manual.id);
    await api("/api/certificates", { id: manualIssued.certificateId, confirmed: true }, "DELETE");
    const report = JSON.parse(await command("exec", appId, "node", "-e", 'const fs=require("fs"); console.log(JSON.stringify({version:require("./package.json").version,arch:process.arch,nodeEnv:process.env.NODE_ENV,localEnvIncluded:fs.existsSync(".env.local"),acmeSchema:fs.existsSync("db/acme.sql")}))'));
    assert.equal(report.version, version); assert.equal(report.nodeEnv, "production"); assert.equal(report.localEnvIncluded, false); assert.equal(report.acmeSchema, true);
    assert.equal(report.arch, arch === "amd64" ? "x64" : "arm64");
    console.log(JSON.stringify({ ...report, login: "passed", database: "passed", multiAccount: "passed", manualDns: "passed", acmeQueue: "passed", requestRenewalSeparation: "passed", encryptedStorage: "passed", renewalPersistence: "passed", pemKeyExport: "passed", deletionCascade: "passed" }));
    await command("stop", appId); active.splice(active.indexOf(appId), 1);
  }
  console.log("Release smoke tests passed for both platforms.");
} finally {
  pool = globalThis.certOpsPool; if (pool) await pool.end();
  for (const id of active.reverse()) { try { await command("stop", id); } catch { console.error(`Cleanup needed: ${id}`); } }
  await rm(scratch, { recursive: true, force: true });
}
