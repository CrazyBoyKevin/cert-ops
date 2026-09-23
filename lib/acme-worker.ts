import * as acme from "acme-client";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withAcmeDb, readAcmeSettings, requireConfigured, mapOrder, storeIssuedCertificate } from "./acme-store.ts";
import { decryptSecret, encryptSecret } from "./crypto-store.ts";
import { AcmeError, challengeRecord, publicAcmeError } from "./acme-validation.ts";
import { aliyunRequest, findChallengeRecords, waitForTxt, type DnsRequest } from "./aliyun-dns.ts";
import { readAliyunCredential } from "./aliyun-credentials.ts";
import { acmeClient, configureAcmeAccount } from "./acme-client.ts";
import { processManualOrder } from "./acme-manual.ts";
import type { AcmeOrder, AcmeSettings, AcmeIssuanceConfig } from "./acme-types";

type CleanupRow = { id: string; zone: string; rr: string; value: string; record_id: string | null; credentials_encrypted: string; created_at: Date };

export async function readOrderIssuanceConfig(db: PoolClient, order: Pick<AcmeOrder, "credentialId">, config: AcmeSettings): Promise<AcmeIssuanceConfig> {
  requireConfigured(config);
  const credential = await readAliyunCredential(db, order.credentialId);
  return { email: config.email, termsAgreed: config.termsAgreed, accessKeyId: credential.accessKeyId, accessKeySecret: credential.accessKeySecret };
}

export async function cleanupRecord(db: PoolClient, row: CleanupRow, requestOverride?: DnsRequest) {
  const credentials = decryptSecret(row.credentials_encrypted);
  if (!credentials) throw new AcmeError("ENCRYPTION_REQUIRED");
  const request = requestOverride || aliyunRequest(JSON.parse(credentials));
  const matches = await findChallengeRecords(request, row.zone, row.rr, row.value);
  // A timed-out AddDomainRecord may still be completing on Alibaba's side.
  if (!row.record_id && !matches.length && Date.now() - new Date(row.created_at).getTime() < 5 * 60_000) throw new AcmeError("CLEANUP_PENDING");
  for (const match of matches) {
    if (!row.record_id || match.RecordId === row.record_id) await request("DeleteDomainRecord", { RecordId: match.RecordId });
  }
  await db.query("DELETE FROM cert_ops.acme_dns_records WHERE id=$1", [row.id]);
}

async function cleanup(db: PoolClient, orderId?: string) {
  const result = await db.query<CleanupRow>(`SELECT * FROM cert_ops.acme_dns_records ${orderId ? "WHERE order_id=$1" : ""}`, orderId ? [orderId] : []);
  let pending = 0;
  for (const row of result.rows) {
    try { await cleanupRecord(db, row); } catch { pending++; }
  }
  return pending;
}

export async function issueAcmeCertificate(db: PoolClient, order: AcmeOrder, config: AcmeIssuanceConfig, overrides: {
  client?: Pick<acme.Client, "auto">; dns?: DnsRequest; wait?: typeof waitForTxt;
} = {}) {
  const setStage = async (stage: string) => { await db.query("UPDATE cert_ops.acme_orders SET stage=$2, updated_at=NOW() WHERE id=$1", [order.id, stage]); };
  const realClient = await acmeClient(db, order.environment);
  const client = overrides.client || realClient;
  const [privateKey, csr] = await acme.crypto.createCsr({ commonName: order.domains[0], altNames: order.domains, keySize: 2048 });
  const request = overrides.dns || aliyunRequest(config);
  await setStage("ordering");
  if (!overrides.client) {
    await configureAcmeAccount(realClient, config);
  }
  const pem = await client.auto({ csr, email: config.email, termsOfServiceAgreed: config.termsAgreed,
    challengePriority: ["dns-01"], skipChallengeVerification: true,
    challengeCreateFn: async (authz, challenge, value) => {
      if (challenge.type !== "dns-01") throw new AcmeError("DNS_VALIDATION_FAILED");
      const rr = challengeRecord(authz.identifier.value, order.zone);
      const id = randomUUID();
      await setStage("dns");
      // Persist the intent first; recovery can find this exact, random TXT value even
      // if the process exits between Aliyun accepting the request and saving its ID.
      await db.query(`INSERT INTO cert_ops.acme_dns_records(id,order_id,zone,rr,value,credentials_encrypted) VALUES($1,$2,$3,$4,$5,$6)`,
        [id, order.id, order.zone, rr, value, encryptSecret(JSON.stringify({ accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret }))]);
      const record = await request<{ RecordId: string }>("AddDomainRecord", { DomainName: order.zone, RR: rr, Type: "TXT", Value: value, TTL: 600 });
      if (!record.RecordId) throw new AcmeError("DNS_API_FAILED");
      await db.query("UPDATE cert_ops.acme_dns_records SET record_id=$2 WHERE id=$1", [id, record.RecordId]);
      await setStage("propagation");
      // Both public recursive resolvers must see the expected value before the CA is asked.
      await (overrides.wait || waitForTxt)(`${rr}.${order.zone}`, value);
      await setStage("validating");
    },
    challengeRemoveFn: async (_authz, _challenge, value) => {
      const records = await db.query<CleanupRow>("SELECT * FROM cert_ops.acme_dns_records WHERE order_id=$1 AND value=$2", [order.id, value]);
      for (const row of records.rows) await cleanupRecord(db, row, overrides.dns);
    },
  });
  await setStage("saving");
  await storeIssuedCertificate(db, order, pem, privateKey.toString());
}

export async function runAcmeCheck() {
  acme.axios.defaults.timeout = 30_000;
  return withAcmeDb(async (db) => {
    const lock = await db.query("SELECT pg_try_advisory_lock(194827,2) AS locked");
    if (!lock.rows[0].locked) return { skipped: "busy" };
    try {
      // Holding the session lock proves that any previously running worker has exited.
      await db.query(`UPDATE cert_ops.acme_orders SET status='failed', stage='failed', last_error='INTERRUPTED',
        next_attempt_at=NOW()+INTERVAL '1 hour', updated_at=NOW() WHERE status='running' AND dns_provider='aliyun'`);
      await db.query(`UPDATE cert_ops.acme_orders SET status='queued',stage='queued',next_attempt_at=NOW(),updated_at=NOW()
        WHERE status='running' AND dns_provider='manual'`);
      await db.query(`UPDATE cert_ops.acme_orders SET status='failed',stage='failed',last_error='MANUAL_EXPIRED',updated_at=NOW()
        WHERE dns_provider='manual' AND status IN ('waiting_dns','dns_ready') AND manual_expires_at<=NOW()`);
      const pendingCleanup = await cleanup(db);
      const config = await readAcmeSettings(db);
      if (!config.email || !config.termsAgreed) return { skipped: "not-configured" };
      requireConfigured(config);
      await db.query(`UPDATE cert_ops.acme_orders o SET status='queued', stage='queued' FROM cert_ops.certificates c
        WHERE o.certificate_id=c.id AND o.dns_provider='aliyun' AND o.auto_renew=TRUE AND o.status IN ('issued','failed') AND o.next_attempt_at<=NOW()
        AND c.expires_at <= NOW() + LEAST(INTERVAL '30 days', (c.expires_at-c.valid_from)/3)`);
      const result = await db.query(`UPDATE cert_ops.acme_orders SET status='running', stage='ordering', attempts=attempts+1, last_attempt_at=NOW(), updated_at=NOW()
        WHERE id=(SELECT id FROM cert_ops.acme_orders WHERE status='queued' AND next_attempt_at<=NOW()
          AND ($1::boolean=FALSE OR dns_provider='manual') ORDER BY created_at LIMIT 1) RETURNING *`, [pendingCleanup > 0]);
      if (!result.rowCount) return { skipped: "no-due-orders" };
      const order = mapOrder(result.rows[0]);
      try {
        if (!order.certificateId && !order.groupId) throw new AcmeError("GROUP_REQUIRED");
        if (order.dnsProvider === "manual") return { processed: order.id, status: await processManualOrder(db, order, config) };
        await issueAcmeCertificate(db, order, await readOrderIssuanceConfig(db, order, config));
        return { processed: order.id, status: "issued" };
      } catch (error) {
        const code = publicAcmeError(error);
        await db.query(`UPDATE cert_ops.acme_orders SET status='failed', stage='failed', last_error=$2,
          next_attempt_at=NOW()+INTERVAL '6 hours', updated_at=NOW() WHERE id=$1`, [order.id, code]);
        return { processed: order.id, status: "failed", error: code };
      } finally { await cleanup(db, order.id); }
    } finally { await db.query("SELECT pg_advisory_unlock(194827,2)"); }
  });
}

const scheduler = globalThis as typeof globalThis & { certOpsAcmeStarted?: boolean; certOpsAcmeTimer?: ReturnType<typeof setTimeout> };
export function startAcmeScheduler() {
  if (scheduler.certOpsAcmeStarted || process.env.ACME_SCHEDULER_ENABLED === "false") return;
  scheduler.certOpsAcmeStarted = true;
  // ACME requests contain signing material: never enable verbose SDK/ACME logging.
  acme.axios.defaults.timeout = 30_000;
  const tick = async () => {
    try { await runAcmeCheck(); }
    catch { console.warn("[CertOps ACME] Check unavailable; verify database and encryption configuration."); }
    finally { scheduler.certOpsAcmeTimer = setTimeout(tick, 60_000); scheduler.certOpsAcmeTimer.unref(); }
  };
  scheduler.certOpsAcmeTimer = setTimeout(tick, 5000);
  scheduler.certOpsAcmeTimer.unref();
}
