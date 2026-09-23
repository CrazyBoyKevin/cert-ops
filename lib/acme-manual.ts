import * as acme from "acme-client";
import type { PoolClient } from "pg";
import { acmeClient, configureAcmeAccount } from "./acme-client.ts";
import { withAcmeDb, readAcmeSettings, requireConfigured, mapOrder, storeIssuedCertificate } from "./acme-store.ts";
import { decryptSecret, encryptSecret } from "./crypto-store.ts";
import { AcmeError, challengeRecord } from "./acme-validation.ts";
import { waitForTxt } from "./aliyun-dns.ts";
import type { AcmeOrder, AcmeSettings, ManualDnsRecord } from "./acme-types";

type ManualSession = { order: acme.Order; privateKey: string; csr: string };
type ManualClient = Pick<acme.Client, "createOrder" | "getOrder" | "getAuthorizations" | "getChallengeKeyAuthorization" | "completeChallenge" | "waitForValidStatus" | "finalizeOrder" | "getCertificate">;
type Overrides = { client?: ManualClient; wait?: typeof waitForTxt };

function sessionFrom(row: Record<string, unknown>): ManualSession | null {
  if (!row.manual_state_encrypted) return null;
  const text = decryptSecret(String(row.manual_state_encrypted));
  if (!text) throw new AcmeError("ENCRYPTION_REQUIRED");
  return JSON.parse(text);
}

export function manualSessionActive(expiresAt: unknown) {
  if (!expiresAt || new Date(String(expiresAt)).getTime() <= Date.now() || !Number.isFinite(new Date(String(expiresAt)).getTime())) {
    throw new AcmeError("MANUAL_EXPIRED");
  }
}

export async function checkManualRecords(records: ManualDnsRecord[], wait: typeof waitForTxt = waitForTxt) {
  return Promise.all(records.map(async (record) => {
    let verified = false;
    try { await wait(record.name, record.value, { timeoutMs: 0 }); verified = true; } catch { /* DNS not propagated or unreachable. */ }
    return { ...record, verified };
  }));
}

// Persist every boundary; waiting for a human never holds a worker or an HTTP request open.
export async function processManualOrder(db: PoolClient, order: AcmeOrder, config: AcmeSettings, overrides: Overrides = {}) {
  requireConfigured(config);
  const row = (await db.query("SELECT * FROM cert_ops.acme_orders WHERE id=$1", [order.id])).rows[0];
  if (!row || row.dns_provider !== "manual") throw new AcmeError("NOT_FOUND");
  let session = sessionFrom(row);
  const client = overrides.client || await acmeClient(db, order.environment);
  if (!overrides.client) await configureAcmeAccount(client as acme.Client, config);
  if (!session) {
    const [key, csr] = await acme.crypto.createCsr({ commonName: order.domains[0], altNames: order.domains, keySize: 2048 });
    const remote = await client.createOrder({ identifiers: order.domains.map((value) => ({ type: "dns", value })) });
    session = { order: remote, privateKey: key.toString(), csr: csr.toString() };
    // A conservative cap bounds stale pending material even if a CA omits expiry.
    const expires = new Date(Math.min(Date.now() + 24 * 3600_000, remote.expires ? Date.parse(remote.expires) : Infinity)).toISOString();
    await db.query("UPDATE cert_ops.acme_orders SET manual_state_encrypted=$2, manual_expires_at=$3 WHERE id=$1",
      [order.id, encryptSecret(JSON.stringify(session)), expires]);
    row.manual_expires_at = expires;
  }
  manualSessionActive(row.manual_expires_at);
  let remote = await client.getOrder(session.order);
  if (remote.status === "invalid") throw new AcmeError("MANUAL_EXPIRED");
  const authorizations = await client.getAuthorizations(remote);
  if (authorizations.length !== order.domains.length) throw new AcmeError("DNS_VALIDATION_FAILED");
  const expires = new Date(Math.min(new Date(row.manual_expires_at).getTime(),
    ...authorizations.filter((auth) => auth.expires).map((auth) => Date.parse(auth.expires!)))).toISOString();
  manualSessionActive(expires);
  await db.query("UPDATE cert_ops.acme_orders SET manual_expires_at=$2 WHERE id=$1", [order.id, expires]);
  const records: ManualDnsRecord[] = [];
  for (const auth of authorizations) {
    if (auth.expires && Date.parse(auth.expires) <= Date.now()) throw new AcmeError("MANUAL_EXPIRED");
    if (auth.status === "valid") continue;
    if (auth.status !== "pending") throw new AcmeError("DNS_VALIDATION_FAILED");
    const challenge = auth.challenges.find((item) => item.type === "dns-01");
    if (!challenge) throw new AcmeError("DNS_VALIDATION_FAILED");
    const rr = challengeRecord(auth.identifier.value, order.zone);
    records.push({ name: `${rr}.${order.zone}`, rr, type: "TXT", value: await client.getChallengeKeyAuthorization(challenge),
      domain: `${auth.wildcard ? "*." : ""}${auth.identifier.value}`, verified: false });
  }
  if (!row.manual_confirmed) {
    await db.query(`UPDATE cert_ops.acme_orders SET status='waiting_dns',stage='waiting_dns',manual_records=$2,
      dns_checked_at=NULL,manual_prepared=TRUE,last_error=NULL,updated_at=NOW() WHERE id=$1`, [order.id, JSON.stringify(records)]);
    return "waiting_dns";
  }
  // Check again immediately before asking the CA; the earlier browser check is not trusted.
  const checked = await checkManualRecords(records, overrides.wait);
  if (checked.some((item) => !item.verified)) {
    await db.query(`UPDATE cert_ops.acme_orders SET status='waiting_dns',stage='waiting_dns',manual_records=$2,
      dns_checked_at=NULL,manual_confirmed=FALSE,last_error='MANUAL_DNS_PENDING',updated_at=NOW() WHERE id=$1`, [order.id, JSON.stringify(checked)]);
    return "waiting_dns";
  }
  await db.query("UPDATE cert_ops.acme_orders SET stage='validating',updated_at=NOW() WHERE id=$1", [order.id]);
  for (const auth of authorizations) {
    if (auth.status === "valid") continue;
    const challenge = auth.challenges.find((item) => item.type === "dns-01")!;
    if (challenge.status === "pending") await client.completeChallenge(challenge);
    await client.waitForValidStatus(auth);
  }
  remote = await client.getOrder(remote);
  if (remote.status === "ready") remote = await client.finalizeOrder(remote, session.csr);
  if (remote.status !== "processing" && remote.status !== "valid") throw new AcmeError("DNS_VALIDATION_FAILED");
  const pem = await client.getCertificate(remote);
  await storeIssuedCertificate(db, order, pem, session.privateKey);
  // Keep the public TXT list so users can remove exactly these values after issuance.
  return "issued";
}

export async function changeManualOrder(db: PoolClient, id: string, action: "checkDns" | "continue", wait?: typeof waitForTxt) {
  const lock = await db.query("SELECT pg_try_advisory_lock(194827,2) AS locked");
  if (!lock.rows[0].locked) throw new AcmeError("MANUAL_BUSY");
  try {
    requireConfigured(await readAcmeSettings(db));
    const row = (await db.query("SELECT * FROM cert_ops.acme_orders WHERE id=$1", [id])).rows[0];
    if (!row || row.dns_provider !== "manual") throw new AcmeError("NOT_FOUND");
    if (!["waiting_dns", "dns_ready", "failed"].includes(row.status)) throw new AcmeError("MANUAL_BUSY");
    if (!sessionFrom(row)) throw new AcmeError("MANUAL_EXPIRED");
    manualSessionActive(row.manual_expires_at);
    if (!row.manual_prepared) throw new AcmeError("MANUAL_NOT_PREPARED");
    if (action === "checkDns") {
      const records = await checkManualRecords(mapOrder(row).manualRecords, wait);
      const ready = records.every((item) => item.verified);
      await db.query(`UPDATE cert_ops.acme_orders SET status=$2,stage=$2,manual_records=$3,dns_checked_at=$4,
        manual_confirmed=FALSE,last_error=$5,updated_at=NOW() WHERE id=$1`,
      [id, ready ? "dns_ready" : "waiting_dns", JSON.stringify(records), ready ? new Date() : null, ready ? null : "MANUAL_DNS_PENDING"]);
      return { ready };
    }
    if (row.status !== "dns_ready" || !row.dns_checked_at || Date.now() - new Date(row.dns_checked_at).getTime() > 10 * 60_000) throw new AcmeError("MANUAL_CHECK_REQUIRED");
    await db.query(`UPDATE cert_ops.acme_orders SET status='queued',stage='queued',manual_confirmed=TRUE,
      next_attempt_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1`, [id]);
    return { queued: true };
  } finally { await db.query("SELECT pg_advisory_unlock(194827,2)"); }
}

export async function runManualAction(id: string, action: "checkDns" | "continue") {
  return withAcmeDb((db) => changeManualOrder(db, id, action));
}
