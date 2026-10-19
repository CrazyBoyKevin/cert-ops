import { randomUUID, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { withPostgres } from "./repository.ts";
import { encryptSecret, decryptSecret } from "./crypto-store.ts";
import { parseCertificate } from "./certificate.ts";
import { createPrivateRoot, issuePrivateCertificate, readImportedRoot, readImportedService, PkiError, pkiId, pkiName, pkiIps, pkiDays, pkiSubject } from "./private-pki.ts";

let schemaReady: Promise<void> | undefined;
export async function withPkiDb<T>(work: (db: PoolClient) => Promise<T>, mutation = false) {
  const key = process.env.CERT_ENCRYPTION_KEY || "";
  if (key.length < 32 || key.startsWith("replace-with-")) throw new PkiError("ENCRYPTION_REQUIRED");
  return withPostgres(async db => {
    schemaReady ??= readFile(path.join(process.cwd(), "db/private-pki.sql"), "utf8").then(async sql => {
      await db.query("BEGIN");
      try {
        await db.query("SELECT pg_advisory_xact_lock(194827,51)");
        await db.query(sql);
        await db.query("COMMIT");
      } catch (error) { await db.query("ROLLBACK"); throw error; }
    }).catch(error => { schemaReady = undefined; throw error; });
    await schemaReady;
    if (!mutation) return work(db);
    await db.query("BEGIN");
    try {
      // Keep signing bounded across workers; a second mutation can be retried, not queued indefinitely.
      const lock = await db.query("SELECT pg_try_advisory_xact_lock(194827,50) AS locked");
      if (!lock.rows[0].locked) throw new PkiError("BUSY");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  });
}
function required<T>(value: T | undefined): T {
  if (!value) throw new PkiError("NOT_FOUND");
  return value;
}
export async function listPrivateAuthorities() {
  return withPkiDb(async db => (await db.query(`SELECT a.id, a.subject, a.expires_at AS "expiresAt", a.fingerprint, a.created_at AS "createdAt", (a.private_key_encrypted <> '') AS "hasPrivateKey", (SELECT COUNT(*)::int FROM cert_ops.private_services s WHERE s.authority_id=a.id) AS "serviceCount" FROM cert_ops.private_authorities a ORDER BY a.created_at DESC`)).rows);
}
export async function deletePrivateAuthority(input: Record<string, unknown>) {
  if (input.confirmed !== true) throw new PkiError("CONFIRM_REQUIRED");
  const id = pkiId(input.id);
  return withPkiDb(async db => {
    // Serialize against issuance/import, and lock the root against concurrent FK inserts.
    required((await db.query("SELECT id FROM cert_ops.private_authorities WHERE id=$1 FOR UPDATE", [id])).rows[0]);
    if ((await db.query("SELECT 1 FROM cert_ops.private_services WHERE authority_id=$1 LIMIT 1", [id])).rowCount) throw new PkiError("CA_IN_USE");
    try {
      await db.query("DELETE FROM cert_ops.private_authorities WHERE id=$1", [id]);
    } catch (error) {
      // Keep the restrictive FK as the final guard, even for writers outside this API.
      if (error && typeof error === "object" && "code" in error && error.code === "23503") throw new PkiError("CA_IN_USE");
      throw error;
    }
    return { deleted: true, id };
  }, true);
}
export async function importPrivateAuthority(input: Record<string, unknown>) {
  const root = readImportedRoot(input);
  return withPkiDb(async db => {
    const result = await db.query(`INSERT INTO cert_ops.private_authorities(id,subject,certificate_pem,private_key_encrypted,expires_at,fingerprint) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(fingerprint) DO UPDATE SET private_key_encrypted=CASE WHEN EXCLUDED.private_key_encrypted <> '' THEN EXCLUDED.private_key_encrypted ELSE cert_ops.private_authorities.private_key_encrypted END RETURNING id`,
      [randomUUID(), JSON.stringify(root.subject), root.certificatePem, encryptSecret(root.privateKey), root.expiresAt, root.fingerprint]);
    return { id: result.rows[0].id };
  }, true);
}
export async function importPrivateService(input: Record<string, unknown>) {
  const authorityId = pkiId(input.authorityId), groupId = pkiId(input.groupId), name = pkiName(input.name);
  return withPkiDb(async db => {
    const root = required((await db.query("SELECT certificate_pem FROM cert_ops.private_authorities WHERE id=$1", [authorityId])).rows[0]);
    required((await db.query("SELECT id FROM cert_ops.groups WHERE id=$1", [groupId])).rows[0]);
    const pair = await readImportedService(input, root.certificate_pem), cert = parseCertificate(pair.certificatePem, pair.privateKey);
    if ((await db.query("SELECT id FROM cert_ops.certificates WHERE fingerprint=$1", [cert.fingerprint])).rowCount || (await db.query("SELECT id FROM cert_ops.private_versions WHERE metadata->>'fingerprint'=$1", [cert.fingerprint])).rowCount) throw new PkiError("CERTIFICATE_EXISTS");
    const id = randomUUID();
    await db.query(`INSERT INTO cert_ops.certificates(id,name,primary_domain,domains,issuer,valid_from,expires_at,serial_number,fingerprint,algorithm,group_id,certificate_pem,private_key_encrypted,private_ca,private_authority_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14)`,
      [id, name, cert.primaryDomain, JSON.stringify(cert.domains), cert.issuer, cert.validFrom, cert.expiresAt, cert.serialNumber, cert.fingerprint, cert.algorithm, groupId, pair.certificatePem, encryptSecret(pair.privateKey) || null, authorityId]);
    await db.query("INSERT INTO cert_ops.private_services(certificate_id,authority_id) VALUES($1,$2)", [id, authorityId]);
    await db.query("INSERT INTO cert_ops.private_versions(id,certificate_id,certificate_pem,private_key_encrypted,metadata) VALUES($1,$2,$3,$4,$5::jsonb)", [randomUUID(), id, pair.certificatePem, encryptSecret(pair.privateKey), JSON.stringify(cert)]);
    return { certificateId: id };
  }, true);
}
export async function savePrivateAuthority(input: Record<string, unknown>) {
  const subject = pkiSubject(input.subject), days = pkiDays(input.days, true);
  return withPkiDb(async db => {
    const pair = await createPrivateRoot(subject, days), certificate = new X509Certificate(pair.certificatePem), id = randomUUID();
    await db.query(`INSERT INTO cert_ops.private_authorities(id,subject,certificate_pem,private_key_encrypted,expires_at,fingerprint) VALUES($1,$2,$3,$4,$5,$6)`,
      [id, JSON.stringify(subject), pair.certificatePem, encryptSecret(pair.privateKey), new Date(certificate.validTo), certificate.fingerprint256]);
    return { id };
  }, true);
}
type Material = { certificatePem: string; privateKey: string };
async function updateCurrent(db: PoolClient, id: string, pair: Material) {
  const cert = parseCertificate(pair.certificatePem, pair.privateKey);
  await db.query(`UPDATE cert_ops.certificates SET primary_domain=$2,domains=$3::jsonb,issuer=$4,valid_from=$5,expires_at=$6,serial_number=$7,fingerprint=$8,algorithm=$9,certificate_pem=$10,private_key_encrypted=$11 WHERE id=$1`,
    [id, cert.primaryDomain, JSON.stringify(cert.domains), cert.issuer, cert.validFrom, cert.expiresAt, cert.serialNumber, cert.fingerprint, cert.algorithm, pair.certificatePem, encryptSecret(pair.privateKey) || null]);
  await db.query("DELETE FROM cert_ops.notification_logs WHERE certificate_id=$1", [id]);
}
export async function issuePrivateService(input: Record<string, unknown>, renew = false) {
  const ips = pkiIps(input.ips), days = pkiDays(input.days);
  const id = renew ? pkiId(input.certificateId) : randomUUID();
  const authorityId = renew ? null : pkiId(input.authorityId);
  const groupId = renew ? null : pkiId(input.groupId);
  const name = renew ? null : pkiName(input.name);
  return withPkiDb(async db => {
    let caId = authorityId;
    if (renew) {
      // Lock the parent before its children, matching ordinary certificate deletion.
      required((await db.query("SELECT id FROM cert_ops.certificates WHERE id=$1 FOR UPDATE", [id])).rows[0]);
      caId = required((await db.query("SELECT authority_id FROM cert_ops.private_services WHERE certificate_id=$1", [id])).rows[0]).authority_id;
    } else {
      required((await db.query("SELECT id FROM cert_ops.groups WHERE id=$1", [groupId])).rows[0]);
    }
    const ca = required((await db.query("SELECT certificate_pem,private_key_encrypted FROM cert_ops.private_authorities WHERE id=$1", [caId])).rows[0]);
    if (!ca.private_key_encrypted) throw new PkiError("CA_KEY_REQUIRED");
    const pair = await issuePrivateCertificate({ certificatePem: ca.certificate_pem, privateKey: decryptSecret(ca.private_key_encrypted) }, ips, days);
    const cert = parseCertificate(pair.certificatePem, pair.privateKey);
    if (renew) await updateCurrent(db, id, pair);
    else {
      await db.query(`INSERT INTO cert_ops.certificates (id,name,primary_domain,domains,issuer,valid_from,expires_at,serial_number,fingerprint,algorithm,group_id,certificate_pem,private_key_encrypted,private_ca)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)`,
      [id, name, cert.primaryDomain, JSON.stringify(cert.domains), cert.issuer, cert.validFrom, cert.expiresAt, cert.serialNumber, cert.fingerprint, cert.algorithm, groupId, pair.certificatePem, encryptSecret(pair.privateKey)]);
      await db.query("INSERT INTO cert_ops.private_services(certificate_id,authority_id) VALUES($1,$2)", [id, caId]);
      await db.query("UPDATE cert_ops.certificates SET private_authority_id=$2 WHERE id=$1", [id, caId]);
    }
    await db.query("INSERT INTO cert_ops.private_versions(id,certificate_id,certificate_pem,private_key_encrypted,metadata) VALUES($1,$2,$3,$4,$5::jsonb)",
      [randomUUID(), id, pair.certificatePem, encryptSecret(pair.privateKey), JSON.stringify(cert)]);
    return { certificateId: id };
  }, true);
}
export async function privateServiceDetails(certificateId: string) {
  return withPkiDb(async db => {
    const service = required((await db.query(`SELECT s.authority_id AS "authorityId", a.subject, c.fingerprint, c.domains, (a.private_key_encrypted <> '') AS "hasSigningKey" FROM cert_ops.private_services s JOIN cert_ops.private_authorities a ON a.id=s.authority_id JOIN cert_ops.certificates c ON c.id=s.certificate_id WHERE s.certificate_id=$1`, [pkiId(certificateId)])).rows[0]);
    const versions = (await db.query(`SELECT id,metadata,created_at AS "createdAt", (private_key_encrypted <> '') AS "hasPrivateKey" FROM cert_ops.private_versions WHERE certificate_id=$1 ORDER BY created_at DESC,id DESC`, [certificateId])).rows;
    return { ...service, ipOnly: service.domains.length > 0 && service.domains.every((address: string) => isIP(address)), versions };
  });
}
export async function privateRootContents(id: string) {
  return withPkiDb(async db => required((await db.query("SELECT certificate_pem FROM cert_ops.private_authorities WHERE id=$1", [pkiId(id)])).rows[0]).certificate_pem as string);
}
export async function privateVersionContents(id: string) {
  return withPkiDb(async db => {
    const row = required((await db.query("SELECT certificate_pem,private_key_encrypted FROM cert_ops.private_versions WHERE id=$1", [pkiId(id)])).rows[0]);
    const privateKey = decryptSecret(row.private_key_encrypted);
    if (row.private_key_encrypted && !privateKey) throw new PkiError("ENCRYPTION_REQUIRED");
    return { certificatePem: row.certificate_pem as string, privateKey };
  });
}
export async function deletePrivateVersion(input: Record<string, unknown>) {
  if (input.confirmed !== true) throw new PkiError("CONFIRM_REQUIRED");
  const id = pkiId(input.id), certificateId = pkiId(input.certificateId);
  return withPkiDb(async db => {
    const cert = required((await db.query("SELECT fingerprint FROM cert_ops.certificates WHERE id=$1 FOR UPDATE", [certificateId])).rows[0]);
    const version = required((await db.query("DELETE FROM cert_ops.private_versions WHERE id=$1 AND certificate_id=$2 RETURNING metadata", [id, certificateId])).rows[0]);
    const latest = (await db.query("SELECT certificate_pem,private_key_encrypted FROM cert_ops.private_versions WHERE certificate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [certificateId])).rows[0];
    if (!latest) await db.query("DELETE FROM cert_ops.certificates WHERE id=$1", [certificateId]);
    else if (cert.fingerprint === version.metadata.fingerprint) {
      const privateKey = decryptSecret(latest.private_key_encrypted);
      if (latest.private_key_encrypted && !privateKey) throw new PkiError("ENCRYPTION_REQUIRED");
      await updateCurrent(db, certificateId, { certificatePem: latest.certificate_pem, privateKey });
    }
    return { deleted: true, serviceDeleted: !latest };
  }, true);
}
