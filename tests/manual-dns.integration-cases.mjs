import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { decryptSecret } from "../lib/crypto-store.ts";
import { withAcmeDb, queueAcmeOrder, listAcmeOrders, changeAcmeOrder, removeAcmeOrder, readAcmeSettings } from "../lib/acme-store.ts";
import { changeManualOrder, processManualOrder } from "../lib/acme-manual.ts";

// Invoked by the isolated PostgreSQL integration runner. All CA/DNS calls are mocks.
export async function manualDnsCases({ pool, groupId, scratch, exec }) {
  const input = { name: "Manual DNS", groupId, zone: "manual.example.com", domains: ["manual.example.com", "*.manual.example.com"],
    dnsProvider: "manual", environment: "staging", autoRenew: false };
  const order = await queueAcmeOrder(input);
  assert.equal(order.credentialId, null); assert.equal(order.autoRenew, false);
  await assert.rejects(changeAcmeOrder(order.id, "autoRenew", true), /MANUAL_DNS_ONLY/);
  let created = 0, completed = 0, finalized = 0, remoteStatus = "pending";
  let pem, downloads = 0;
  const auths = [false, true].map((wildcard, index) => ({ identifier: { type: "dns", value: "manual.example.com" }, wildcard,
    url: `https://mock.invalid/auth/${index}`, status: "pending", challenges: [{ type: "dns-01", url: `https://mock.invalid/challenge/${index}`, token: `txt-${index}`, status: "pending" }] }));
  const client = {
    createOrder: async () => { created++; return { url: "https://mock.invalid/order", status: remoteStatus, authorizations: auths.map((a) => a.url), identifiers: [], finalize: "https://mock.invalid/finalize", expires: new Date(Date.now() + 3600_000).toISOString() }; },
    getOrder: async (remote) => ({ ...remote, status: remoteStatus }),
    getAuthorizations: async () => structuredClone(auths),
    getChallengeKeyAuthorization: async (challenge) => `value-${challenge.token}`,
    completeChallenge: async () => { completed++; },
    waitForValidStatus: async (auth) => { auths.find((a) => a.url === auth.url).status = "valid"; if (auths.every((a) => a.status === "valid")) remoteStatus = "ready"; },
    finalizeOrder: async (remote, csr) => {
      finalized++;
      const session = JSON.parse(decryptSecret((await pool.query("SELECT manual_state_encrypted FROM cert_ops.acme_orders WHERE id=$1", [order.id])).rows[0].manual_state_encrypted));
      assert.equal(csr, session.csr);
      await writeFile(path.join(scratch, "manual.key"), session.privateKey, { mode: 0o600 });
      await writeFile(path.join(scratch, "manual.csr"), csr);
      await exec("openssl", ["x509", "-req", "-in", path.join(scratch, "manual.csr"), "-signkey", path.join(scratch, "manual.key"), "-days", "30", "-copy_extensions", "copy", "-out", path.join(scratch, "manual.pem")]);
      pem = await readFile(path.join(scratch, "manual.pem"), "utf8");
      remoteStatus = "valid"; return { ...remote, status: remoteStatus };
    },
    getCertificate: async () => { if (++downloads === 1) throw new Error("MOCK_DOWNLOAD_TIMEOUT"); return pem; },
  };
  const process = (wait = async () => {}) => withAcmeDb(async (db) => {
    await db.query("SELECT pg_advisory_lock(194827,2)");
    try { return await processManualOrder(db, order, await readAcmeSettings(db), { client, wait }); }
    finally { await db.query("SELECT pg_advisory_unlock(194827,2)"); }
  });
  const action = (kind, wait) => withAcmeDb((db) => changeManualOrder(db, order.id, kind, wait));
  const get = async () => (await listAcmeOrders()).data.find((o) => o.id === order.id);
  assert.equal(await process(), "waiting_dns");
  const original = (await pool.query("SELECT manual_state_encrypted FROM cert_ops.acme_orders WHERE id=$1", [order.id])).rows[0].manual_state_encrypted;
  assert.ok(!original.includes("PRIVATE KEY"));
  assert.equal((await get()).manualRecords.length, 2);
  assert.equal((await get()).manualRecords[0].name, (await get()).manualRecords[1].name);
  assert.notEqual((await get()).manualRecords[0].value, (await get()).manualRecords[1].value);
  assert.equal(completed, 0); assert.equal(finalized, 0);
  assert.equal(await process(), "waiting_dns"); // Recreated client/worker resumes the stored order/key.
  assert.equal(created, 1);
  assert.equal((await pool.query("SELECT manual_state_encrypted FROM cert_ops.acme_orders WHERE id=$1", [order.id])).rows[0].manual_state_encrypted, original);
  await assert.rejects(action("continue"), /MANUAL_CHECK_REQUIRED/);
  assert.equal((await action("checkDns", async (_name, value) => { if (value.endsWith("1")) throw new Error("not propagated"); })).ready, false);
  assert.deepEqual((await get()).manualRecords.map((r) => r.verified), [true, false]);
  await assert.rejects(action("continue"), /MANUAL_CHECK_REQUIRED/);
  assert.equal((await action("checkDns", async () => {})).ready, true);
  await pool.query("UPDATE cert_ops.acme_orders SET dns_checked_at=NOW()-INTERVAL '11 minutes' WHERE id=$1", [order.id]);
  await assert.rejects(action("continue"), /MANUAL_CHECK_REQUIRED/);
  await action("checkDns", async () => {});
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(194827,2)");
    await assert.rejects(action("continue"), /MANUAL_BUSY/);
    await assert.rejects(removeAcmeOrder(order.id), /MANUAL_BUSY/);
  } finally { await lock.query("SELECT pg_advisory_unlock(194827,2)"); lock.release(); }
  await action("continue");
  await assert.rejects(action("continue"), /MANUAL_BUSY/);
  assert.equal(await process(async () => { throw new Error("TXT removed after check"); }), "waiting_dns");
  assert.equal(completed, 0); assert.equal(finalized, 0);
  await action("checkDns", async () => {}); await action("continue");
  await assert.rejects(process(), /MOCK_DOWNLOAD_TIMEOUT/);
  assert.ok((await pool.query("SELECT manual_state_encrypted FROM cert_ops.acme_orders WHERE id=$1", [order.id])).rows[0].manual_state_encrypted);
  assert.equal(await process(), "issued"); // Recover the already-finalized remote order without a new CSR or order.
  assert.equal(created, 1); assert.equal(completed, 2); assert.equal(finalized, 1);
  const issued = await get(); assert.ok(issued.certificateId); assert.equal(issued.status, "issued");
  assert.equal(issued.manualRecords.length, 2); // Retained for manual cleanup.
  assert.equal((await pool.query("SELECT manual_state_encrypted FROM cert_ops.acme_orders WHERE id=$1", [order.id])).rows[0].manual_state_encrypted, null);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM cert_ops.acme_dns_records WHERE order_id=$1", [order.id])).rows[0].count, 0);
  await changeAcmeOrder(order.id, "renew");
  assert.equal((await get()).certificateId, issued.certificateId); assert.equal((await get()).autoRenew, false);
  assert.deepEqual((await get()).manualRecords, []);
  const reused = await queueAcmeOrder({ ...input, environment: "production" });
  await withAcmeDb(async (db) => {
    assert.equal(await processManualOrder(db, reused, await readAcmeSettings(db), { client }), "waiting_dns");
    const publicOrder = (await listAcmeOrders()).data.find((o) => o.id === reused.id);
    assert.deepEqual(publicOrder.manualRecords, []);
    await assert.rejects(changeManualOrder(db, reused.id, "continue"), /MANUAL_CHECK_REQUIRED/);
    assert.equal((await changeManualOrder(db, reused.id, "checkDns", async () => { throw new Error("No TXT lookup expected"); })).ready, true);
  });
  await removeAcmeOrder(reused.id);
  const expiring = await queueAcmeOrder({ ...input, domains: ["expired.manual.example.com"] });
  await pool.query(`UPDATE cert_ops.acme_orders SET status='waiting_dns',manual_state_encrypted=$2,manual_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1`, [expiring.id, original]);
  await assert.rejects(withAcmeDb((db) => changeManualOrder(db, expiring.id, "checkDns", async () => {})), /MANUAL_EXPIRED/);
  await removeAcmeOrder(expiring.id);
  assert.ok(!(await listAcmeOrders()).data.some((o) => o.id === expiring.id));
  console.log("Manual DNS: persistence, same-name TXT, explicit check/confirmation, lock guards, expiry, issuance, encrypted keys and renewal passed.");
}
