import assert from "node:assert/strict";
import { randomUUID, X509Certificate } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptSecret } from "../lib/crypto-store.ts";
import { createPrivateRoot, issuePrivateCertificate } from "../lib/private-pki.ts";

export async function privatePkiCases({ api, base, cookie, pool, groupId, scratch, exec }) {
  const route = "/api/private-pki";
  for (const method of ["GET", "POST"]) assert.equal((await fetch(base + route, { method })).status, 401);
  for (const body of [{ action: "createCA", subject: { CN: "bad\nCA:TRUE" }, days: 3650 }, { action: "issue", ips: "not-ip", days: 30 }]) await api(route, "POST", body, 400);
  const root = (await api(route, "POST", { action: "createCA", subject: { CN: "Integration Root", O: "测试组织", C: "CN" }, days: 3650 }, 201)).data;
  const otherRoot = (await api(route, "POST", { action: "createCA", subject: { CN: "Other Root" }, days: 3650 }, 201)).data;
  const roots = (await api(route)).data;
  assert.equal(roots.length, 2);
  assert.ok(!JSON.stringify(roots).includes("PRIVATE KEY"));
  assert.ok(!JSON.stringify(roots).includes("private_key"));
  const ca = (await pool.query("SELECT * FROM cert_ops.private_authorities WHERE id=$1", [root.id])).rows[0];
  assert.ok(!ca.private_key_encrypted.includes("PRIVATE KEY"));
  assert.match(decryptSecret(ca.private_key_encrypted), /PRIVATE KEY/);
  const leafInput = { action: "issue", authorityId: root.id, groupId, name: "Test LAN service", ips: "192.168.88.10, fd00::10", days: 30 };
  const certificateId = (await api(route, "POST", leafInput, 201)).data.certificateId;
  const details = async () => (await api(`${route}?certificateId=${certificateId}`)).data;
  let data = await details();
  assert.equal(data.authorityId, root.id); assert.equal(data.versions.length, 1);
  assert.ok(!JSON.stringify(data).includes("PRIVATE KEY"));
  const original = data.versions[0], originalKey = (await pool.query("SELECT private_key_encrypted FROM cert_ops.certificates WHERE id=$1", [certificateId])).rows[0].private_key_encrypted;
  const listed = (await api("/api/certificates")).data.find(c => c.id === certificateId);
  assert.equal(listed.privateCa, true); assert.equal(listed.domains.length, 2);
  const signed = (await pool.query("SELECT certificate_pem FROM cert_ops.certificates WHERE id=$1", [certificateId])).rows[0].certificate_pem;
  assert.ok(new X509Certificate(signed).verify(new X509Certificate(ca.certificate_pem).publicKey));
  const otherCa = (await pool.query("SELECT certificate_pem FROM cert_ops.private_authorities WHERE id=$1", [otherRoot.id])).rows[0].certificate_pem;
  assert.equal(new X509Certificate(signed).verify(new X509Certificate(otherCa).publicKey), false);
  // A client-supplied CA on renewal cannot change the service's bound authority.
  await api(route, "POST", { action: "renew", certificateId, authorityId: otherRoot.id, ips: "192.168.88.11,fd00::11", days: 90 });
  data = await details(); assert.equal(data.authorityId, root.id); assert.equal(data.versions.length, 2);
  const current = data.versions[0];
  const renewedKey = (await pool.query("SELECT private_key_encrypted FROM cert_ops.certificates WHERE id=$1", [certificateId])).rows[0].private_key_encrypted;
  assert.notEqual(decryptSecret(originalKey), decryptSecret(renewedKey));
  // Tampered encrypted keys abort renewal without changing the current certificate/history.
  await pool.query("UPDATE cert_ops.private_authorities SET private_key_encrypted='invalid' WHERE id=$1", [root.id]);
  await api(route, "POST", { action: "renew", certificateId, ips: "127.0.0.1", days: 30 }, 400);
  assert.equal((await details()).versions.length, 2);
  await pool.query("UPDATE cert_ops.private_authorities SET private_key_encrypted=$2 WHERE id=$1", [root.id, ca.private_key_encrypted]);
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(194827,50)");
    assert.equal((await api(route, "POST", { action: "renew", certificateId, ips: "127.0.0.1", days: 30 }, 400)).error, "BUSY");
  } finally { await lock.query("SELECT pg_advisory_unlock(194827,50)"); lock.release(); }
  async function download(body) {
    const response = await fetch(base + route, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
    return Buffer.from(await response.arrayBuffer());
  }
  const rootDownload = await download({ action: "downloadRoot", id: root.id });
  assert.equal(rootDownload.toString(), ca.certificate_pem); assert.ok(!rootDownload.toString().includes("PRIVATE KEY"));
  assert.equal(new X509Certificate(await download({ action: "downloadRoot", id: root.id, format: "der" })).fingerprint256, ca.fingerprint);
  const zip = path.join(scratch, "private-version.zip");
  await writeFile(zip, await download({ action: "downloadVersion", id: original.id }));
  assert.deepEqual((await exec("unzip", ["-Z1", zip])).stdout.trim().split("\n"), ["server.pem", "server.key"]);
  assert.equal(new X509Certificate((await exec("unzip", ["-p", zip, "server.pem"])).stdout).fingerprint256, original.metadata.fingerprint);
  await api(route, "POST", { action: "deleteVersion", certificateId, id: current.id }, 400);
  await api(route, "POST", { action: "deleteVersion", certificateId: randomUUID(), id: current.id, confirmed: true }, 400);
  await api(route, "POST", { action: "deleteVersion", certificateId, id: current.id, confirmed: true });
  assert.equal((await details()).fingerprint, original.metadata.fingerprint);
  assert.equal((await details()).versions.length, 1);
  await api(route, "POST", { action: "deleteVersion", certificateId, id: original.id, confirmed: true });
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM cert_ops.certificates WHERE id=$1", [certificateId])).rows[0].n, 0);
  assert.equal((await api(route)).data.length, 2);
  const deletion = (await api(route, "POST", leafInput, 201)).data.certificateId;
  await api("/api/certificates", "DELETE", { id: deletion, confirmed: true });
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM cert_ops.private_versions WHERE certificate_id=$1", [deletion])).rows[0].n, 0);
  const csrf = await fetch(base + route, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(leafInput) });
  assert.equal(csrf.status, 400);
  // Leave a useful test-only fixture for optional browser QA.
  await api(route, "POST", { ...leafInput, name: "NAS · IP certificate preview" }, 201);
  // Import a real, independent local fixture, never any user CA/key.
  const importedRoot = await createPrivateRoot({ CN: "Imported read-only root" }, 3650);
  const importedLeaf = await issuePrivateCertificate(importedRoot, ["192.168.100.3"], 30);
  const importRootBody = { action: "importCA", certificate: importedRoot.certificatePem };
  const importedId = (await api(route, "POST", importRootBody, 201)).data.id;
  assert.equal((await api(route, "POST", importRootBody, 201)).data.id, importedId);
  assert.equal((await api(route)).data.find(root => root.id === importedId).hasPrivateKey, false);
  await api(route, "POST", { ...leafInput, authorityId: importedId }, 400);
  await api(route, "POST", { ...importRootBody, privateKey: decryptSecret(ca.private_key_encrypted) }, 400);
  const importLeafBody = { action: "importService", name: "Imported keyless service", groupId, authorityId: importedId, certificate: importedLeaf.certificatePem };
  await api(route, "POST", { ...importLeafBody, authorityId: root.id }, 400);
  const importedCertificateId = (await api(route, "POST", importLeafBody, 201)).data.certificateId;
  await api(route, "POST", importLeafBody, 400);
  const importedRecord = (await api("/api/certificates")).data.find(c => c.id === importedCertificateId);
  assert.equal(importedRecord.privateCa, true); assert.equal(importedRecord.privateAuthorityId, importedId); assert.equal(importedRecord.hasPrivateKey, false);
  let importedDetails = (await api(`${route}?certificateId=${importedCertificateId}`)).data;
  assert.equal(importedDetails.hasSigningKey, false); assert.equal(importedDetails.versions[0].hasPrivateKey, false);
  const importedVersion = importedDetails.versions[0];
  await api(route, "POST", { action: "downloadVersion", id: importedVersion.id }, 400);
  assert.equal(new X509Certificate(await download({ action: "downloadVersion", id: importedVersion.id, format: "pem" })).fingerprint256, importedVersion.metadata.fingerprint);
  assert.equal((await api(route, "POST", { action: "renew", certificateId: importedCertificateId, ips: "192.168.100.3", days: 30 }, 400)).error, "CA_KEY_REQUIRED");
  assert.equal((await api(route, "POST", { ...importRootBody, privateKey: importedRoot.privateKey }, 201)).data.id, importedId);
  assert.equal((await api(route)).data.find(root => root.id === importedId).hasPrivateKey, true);
  await api(route, "POST", importRootBody, 201); // certificate-only reimport must never erase the key.
  assert.equal((await api(route)).data.find(root => root.id === importedId).hasPrivateKey, true);
  await api(route, "POST", { action: "renew", certificateId: importedCertificateId, ips: "192.168.100.3", days: 30 });
  importedDetails = (await api(`${route}?certificateId=${importedCertificateId}`)).data;
  assert.equal(importedDetails.versions.length, 2); assert.equal(importedDetails.hasSigningKey, true);
  await api(route, "POST", { action: "deleteVersion", certificateId: importedCertificateId, id: importedDetails.versions[0].id, confirmed: true });
  assert.equal((await api("/api/certificates")).data.find(c => c.id === importedCertificateId).hasPrivateKey, false);
  assert.equal((await api(route)).data.find(root => root.id === importedId).serviceCount, 1);
  // Root deletion is global, includes expired/keyless services, and never trusts a UI count.
  const removeRoot = id => ({ action: "deleteCA", id, confirmed: true });
  for (const confirmed of [undefined, false, "true", 1]) {
    assert.equal((await api(route, "POST", { ...removeRoot(otherRoot.id), confirmed }, 400)).error, "CONFIRM_REQUIRED");
  }
  assert.equal((await api(route, "POST", removeRoot("invalid"), 400)).error, "INVALID_INPUT");
  assert.equal((await api(route, "POST", removeRoot(randomUUID()), 400)).error, "NOT_FOUND");
  assert.equal((await api(route, "POST", { ...removeRoot(importedId), serviceCount: 0 }, 400)).error, "CA_IN_USE");
  assert.equal((await api(route, "POST", removeRoot(root.id), 400)).error, "CA_IN_USE");
  const deleteCsrf = await fetch(base + route, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(removeRoot(otherRoot.id)) });
  assert.equal(deleteCsrf.status, 400);
  assert.equal((await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(removeRoot(otherRoot.id)) })).status, 401);
  const deleteLock = await pool.connect();
  try {
    await deleteLock.query("SELECT pg_advisory_lock(194827,50)");
    assert.equal((await api(route, "POST", removeRoot(otherRoot.id), 400)).error, "BUSY");
  } finally { await deleteLock.query("SELECT pg_advisory_unlock(194827,50)"); deleteLock.release(); }
  const deletionGroup = (await api("/api/groups", "POST", { name: "Deletion guard project" }, 201)).data;
  const guardedService = (await api(route, "POST", { ...leafInput, authorityId: otherRoot.id, groupId: deletionGroup.id }, 201)).data.certificateId;
  await pool.query("UPDATE cert_ops.certificates SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1", [guardedService]);
  assert.equal((await api(route, "POST", removeRoot(otherRoot.id), 400)).error, "CA_IN_USE");
  // The database also rejects direct deletion with linked services.
  await assert.rejects(pool.query("DELETE FROM cert_ops.private_authorities WHERE id=$1", [otherRoot.id]), { code: "23503" });
  assert.equal((await api(route)).data.find(c => c.id === otherRoot.id).serviceCount, 1);
  await api("/api/certificates", "DELETE", { id: guardedService, confirmed: true });
  assert.equal((await api(route, "POST", removeRoot(otherRoot.id))).data.deleted, true);
  assert.ok(!(await api(route)).data.some(c => c.id === otherRoot.id));
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM cert_ops.private_authorities WHERE id=$1", [otherRoot.id])).rows[0].n, 0);
  assert.equal((await api(route, "POST", removeRoot(otherRoot.id), 400)).error, "NOT_FOUND");
  await api(route, "POST", { ...leafInput, authorityId: otherRoot.id }, 400);
  assert.ok((await api(route)).data.some(c => c.id === root.id));
  assert.equal((await api(`${route}?certificateId=${importedCertificateId}`)).data.versions.length, 1);
  // Leave an unused root for non-destructive browser confirmation/cancellation QA.
  await api(route, "POST", { action: "createCA", subject: { CN: "Unused root · deletion preview" }, days: 3650 }, 201);
  console.log("Root deletion: confirmation, auth/CSRF, cross-project/expired/keyless service guards, mutation lock, restrictive FK, delete-after-unlink and isolation passed.");
  const persistedRoot = (await pool.query("SELECT private_key_encrypted FROM cert_ops.private_authorities WHERE id=$1", [importedId])).rows[0];
  assert.ok(!persistedRoot.private_key_encrypted.includes("PRIVATE KEY"));
  assert.equal(new X509Certificate(importedRoot.certificatePem).checkPrivateKey((await import("node:crypto")).createPrivateKey(decryptSecret(persistedRoot.private_key_encrypted))), true);
  console.log("Root import: certificate-only mode, verified service import, duplicate protection, optional keys, key supplementation, renewal and keyless rollback passed.");
  console.log("Private PKI: multi-CA isolation, IP signing, encrypted storage, renewal history, downloads, deletion rollback, auth and CSRF passed.");
}
