import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { withPostgres } from "./repository.ts";
import { decryptSecret, encryptSecret } from "./crypto-store.ts";
import { AcmeError, validateOrder, type OrderQuery } from "./acme-validation.ts";
import type { AcmeSettings, AcmeOrder, PublicAcmeSettings, PublicAliyunCredential } from "./acme-types";
import { migrateLegacyCredentials, listAliyunCredentials, readAliyunCredential } from "./aliyun-credentials.ts";
import { parseCertificate } from "./certificate.ts";

const state = globalThis as typeof globalThis & { certOpsAcmeSchemaV3?: Promise<void> };
export async function withAcmeDb<T>(work: (db: PoolClient) => Promise<T>) {
  return withPostgres(async (db) => {
    state.certOpsAcmeSchemaV3 ??= readFile(path.join(process.cwd(), "db/acme.sql"), "utf8")
      .then(async (sql) => {
        await db.query("BEGIN");
        try {
          await db.query("SELECT pg_advisory_xact_lock(194827,4)");
          await db.query(sql);
          await migrateLegacyCredentials(db);
          await db.query("COMMIT");
        } catch (error) { await db.query("ROLLBACK"); throw error; }
      })
      .catch((error) => { state.certOpsAcmeSchemaV3 = undefined; throw error; });
    await state.certOpsAcmeSchemaV3;
    return work(db);
  });
}

export function requireEncryption() {
  const key = process.env.CERT_ENCRYPTION_KEY || "";
  if (key.length < 32 || key.startsWith("replace-with-") || key === "cert-ops-local-development-key") throw new AcmeError("ENCRYPTION_REQUIRED");
}

export async function readAcmeSettings(db: PoolClient): Promise<AcmeSettings> {
  const result = await db.query("SELECT config_encrypted FROM cert_ops.acme_settings WHERE id=1");
  if (!result.rowCount) return { email: "", termsAgreed: false };
  const plaintext = decryptSecret(result.rows[0].config_encrypted);
  if (!plaintext) throw new AcmeError("ENCRYPTION_REQUIRED");
  const config = JSON.parse(plaintext);
  return { email: config.email, termsAgreed: config.termsAgreed };
}
export function publicSettings(config: AcmeSettings, credentials: PublicAliyunCredential[] = []): PublicAcmeSettings {
  return { email: config.email, termsAgreed: config.termsAgreed,
    credentialsConfigured: credentials.length > 0, credentials };
}
export async function readPublicAcmeSettings(db: PoolClient) {
  return publicSettings(await readAcmeSettings(db), await listAliyunCredentials(db));
}
export function requireConfigured(config: AcmeSettings) {
  requireEncryption();
  if (!config.email || !config.termsAgreed) throw new AcmeError("CONFIG_REQUIRED");
}
export async function saveAcmeSettings(input: Record<string, unknown>) {
  requireEncryption();
  const email = String(input.email || "").trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AcmeError("INVALID_EMAIL");
  if (typeof input.termsAgreed !== "boolean") throw new AcmeError("INVALID_REQUEST");
  const termsAgreed = input.termsAgreed;
  // Credentials now have their own explicit endpoint; never silently overwrite another account.
  if (input.accessKeyId !== undefined || input.accessKeySecret !== undefined) throw new AcmeError("INVALID_REQUEST");
  return withAcmeDb(async (db) => {
    const config = { email, termsAgreed };
    await db.query(`INSERT INTO cert_ops.acme_settings(id, config_encrypted) VALUES(1,$1)
      ON CONFLICT(id) DO UPDATE SET config_encrypted=$1, updated_at=NOW()`, [encryptSecret(JSON.stringify(config))]);
    return publicSettings(config, await listAliyunCredentials(db));
  });
}

export function mapOrder(row: Record<string, unknown>): AcmeOrder {
  const date = (key: string) => row[key] ? new Date(String(row[key])).toISOString() : null;
  return { id: String(row.id), name: String(row.certificate_name || row.name), groupId: row.current_group_id ? String(row.current_group_id) : row.group_id ? String(row.group_id) : null,
    dnsProvider: row.dns_provider === "manual" ? "manual" : "aliyun", manualRecords: (row.manual_records || []) as AcmeOrder["manualRecords"],
    manualExpiresAt: date("manual_expires_at"), dnsCheckedAt: date("dns_checked_at"),
    credentialId: row.credential_id ? String(row.credential_id) : null, credentialName: row.credential_name ? String(row.credential_name) : null,
    domains: row.domains as string[], zone: String(row.zone), environment: row.environment as AcmeOrder["environment"],
    autoRenew: Boolean(row.auto_renew), certificateId: row.certificate_id ? String(row.certificate_id) : null,
    status: row.status as AcmeOrder["status"], stage: String(row.stage), lastError: row.last_error ? String(row.last_error) : null,
    nextAttemptAt: date("next_attempt_at")!, expiresAt: date("expires_at"), lastIssuedAt: date("last_issued_at") };
}
export async function listAcmeOrders(query: OrderQuery = {}) {
  return withAcmeDb(async (db) => {
    // A failed renewal still belongs to its certificate, never the new-request inbox.
    const where = query.scope === "pending" ? "o.certificate_id IS NULL" : query.certificateId ? "o.certificate_id=$1" : query.id ? "o.id=$1" : "TRUE";
    const values = query.certificateId ? [query.certificateId] : query.id ? [query.id] : [];
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM cert_ops.acme_orders o WHERE ${where}`, values);
    const total = count.rows[0].total as number;
    const pages = Math.max(1, Math.ceil(total / 10));
    const page = Math.max(1, Math.min(query.page || 1, pages));
    const pagination = query.scope === "pending" ? " LIMIT $1 OFFSET $2" : "";
    const bindings: (string | number)[] = query.scope === "pending" ? [10, (page - 1) * 10] : values;
    const result = await db.query(`SELECT o.*, c.expires_at, c.name AS certificate_name, c.group_id AS current_group_id, a.name AS credential_name
      FROM cert_ops.acme_orders o LEFT JOIN cert_ops.certificates c ON c.id=o.certificate_id
      LEFT JOIN cert_ops.aliyun_credentials a ON a.id=o.credential_id WHERE ${where}
      ORDER BY o.created_at DESC, o.id DESC${pagination}`, bindings);
    // Cleanup can outlive its certificate and blocks the worker globally.
    const cleanup = await db.query("SELECT COUNT(*)::int AS count FROM cert_ops.acme_dns_records");
    return { data: result.rows.map(mapOrder), pendingCleanup: cleanup.rows[0].count, total, page, pages: query.scope === "pending" ? pages : 1 };
  });
}
export async function queueAcmeOrder(input: Record<string, unknown>) {
  const order = validateOrder(input);
  return withAcmeDb(async (db) => {
    requireConfigured(await readAcmeSettings(db));
    // Serialize enqueue checks across tabs/instances without blocking the worker.
    await db.query("BEGIN");
    try {
      await db.query("SELECT pg_advisory_xact_lock(194827, 3)");
      const credential = order.dnsProvider === "manual" ? null : await readAliyunCredential(db, order.credentialId, true);
      const group = await db.query("SELECT id FROM cert_ops.groups WHERE id=$1 FOR KEY SHARE", [order.groupId]);
      if (!group.rowCount) throw new AcmeError("GROUP_REQUIRED");
      const duplicate = await db.query(`SELECT id FROM cert_ops.acme_orders WHERE environment=$1 AND domains @> $2::jsonb AND domains <@ $2::jsonb`, [order.environment, JSON.stringify(order.domains)]);
      if (duplicate.rowCount) throw new AcmeError("DUPLICATE_ORDER");
      const queued = await db.query("SELECT COUNT(*)::int AS count FROM cert_ops.acme_orders WHERE status IN ('queued','running','waiting_dns','dns_ready')");
      if (queued.rows[0].count >= 20) throw new AcmeError("QUEUE_FULL");
      const result = await db.query(`INSERT INTO cert_ops.acme_orders(id,name,group_id,domains,zone,environment,auto_renew,credential_id,dns_provider)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [randomUUID(), order.name, order.groupId, JSON.stringify(order.domains), order.zone, order.environment, order.autoRenew, credential?.id || null, order.dnsProvider]);
      await db.query("COMMIT");
      return mapOrder({ ...result.rows[0], credential_name: credential?.name });
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  });
}
export async function changeAcmeOrder(id: string, action: unknown, autoRenew?: unknown) {
  return withOrderMutation(async (db) => {
    if (action === "autoRenew" && typeof autoRenew === "boolean") {
      const current = await db.query("SELECT dns_provider FROM cert_ops.acme_orders WHERE id=$1", [id]);
      if (current.rows[0]?.dns_provider === "manual" && autoRenew) throw new AcmeError("MANUAL_DNS_ONLY");
      const result = await db.query("UPDATE cert_ops.acme_orders SET auto_renew=$2, updated_at=NOW() WHERE id=$1 RETURNING id", [id, autoRenew]);
      if (!result.rowCount) throw new AcmeError("NOT_FOUND");
      return;
    }
    if (action !== "renew") throw new AcmeError("INVALID_REQUEST");
    requireConfigured(await readAcmeSettings(db));
    const order = await db.query("SELECT credential_id,dns_provider FROM cert_ops.acme_orders WHERE id=$1", [id]);
    if (!order.rowCount) throw new AcmeError("NOT_FOUND");
    if (order.rows[0].dns_provider !== "manual") await readAliyunCredential(db, order.rows[0].credential_id);
    // A one-hour manual cooldown protects CA limits; in-progress requests are idempotent.
    const result = await db.query(`UPDATE cert_ops.acme_orders SET status='queued', stage='queued', last_error=NULL, next_attempt_at=NOW(), updated_at=NOW(),
      manual_state_encrypted=NULL, manual_records='[]', manual_expires_at=NULL, dns_checked_at=NULL, manual_confirmed=FALSE, manual_prepared=FALSE
      WHERE id=$1 AND status IN ('issued','failed') AND (last_attempt_at IS NULL OR last_attempt_at < NOW()-INTERVAL '1 hour') RETURNING id`, [id]);
    if (!result.rowCount) throw new AcmeError("BUSY_OR_COOLDOWN");
  });
}

export async function removeAcmeOrder(id: string) {
  return withOrderMutation(async (db) => {
    const result = await db.query("DELETE FROM cert_ops.acme_orders WHERE id=$1 AND certificate_id IS NULL AND status IN ('queued','failed','waiting_dns','dns_ready') RETURNING id", [id]);
    if (!result.rowCount) throw new AcmeError("BUSY_OR_COOLDOWN");
  });
}

async function withOrderMutation<T>(work: (db: PoolClient) => Promise<T>) {
  return withAcmeDb(async (db) => {
    await db.query("BEGIN");
    try {
      const lock = await db.query("SELECT pg_try_advisory_xact_lock(194827,2) AS locked");
      if (!lock.rows[0].locked) throw new AcmeError("MANUAL_BUSY");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  });
}

export async function storeIssuedCertificate(db: PoolClient, order: AcmeOrder, pem: string, key: string) {
  const parsed = parseCertificate(pem, key);
  if (Date.parse(parsed.expiresAt) <= Date.now() || order.domains.some((domain) => !parsed.domains.includes(domain))) throw new AcmeError("INVALID_CERTIFICATE");
  const id = order.certificateId || randomUUID();
  await db.query("BEGIN");
  try {
    const current = await db.query("SELECT id, group_id FROM cert_ops.acme_orders WHERE id=$1 FOR UPDATE", [order.id]);
    if (!current.rowCount) throw new AcmeError("NOT_FOUND");
    const fields = [id, parsed.primaryDomain, JSON.stringify(parsed.domains), parsed.issuer, parsed.validFrom, parsed.expiresAt, parsed.serialNumber, parsed.fingerprint, parsed.algorithm, pem, encryptSecret(key)];
    if (order.certificateId) {
      const updated = await db.query(`UPDATE cert_ops.certificates SET primary_domain=$2, domains=$3, issuer=$4, valid_from=$5, expires_at=$6,
        serial_number=$7, fingerprint=$8, algorithm=$9, certificate_pem=$10, private_key_encrypted=$11 WHERE id=$1 RETURNING id`, fields);
      if (!updated.rowCount) throw new AcmeError("NOT_FOUND");
      await db.query("DELETE FROM cert_ops.notification_logs WHERE certificate_id=$1", [id]);
    } else {
      if (!current.rows[0].group_id) throw new AcmeError("GROUP_REQUIRED");
      await db.query(`INSERT INTO cert_ops.certificates(id, primary_domain, domains, issuer, valid_from, expires_at, serial_number,
        fingerprint, algorithm, certificate_pem, private_key_encrypted, name, group_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [...fields, order.name, current.rows[0].group_id]);
    }
    await db.query(`UPDATE cert_ops.acme_orders SET certificate_id=$2, status='issued', stage='issued', last_error=NULL,
      last_issued_at=NOW(), updated_at=NOW(), next_attempt_at=NOW()+INTERVAL '1 hour', manual_state_encrypted=NULL, manual_confirmed=FALSE WHERE id=$1`, [order.id, id]);
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}
