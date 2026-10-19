import assert from "node:assert/strict";
import test from "node:test";
import { X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPrivateRoot, issuePrivateCertificate, readImportedRoot, readImportedService } from "../lib/private-pki.ts";
import { certificatesInScope } from "../lib/certificate-scope.ts";
import { pkiManagementMessages } from "../lib/pki-management-i18n.ts";

test("public/private scopes and CA filters do not mix certificates", () => {
  const records = [{ id: "public" }, { id: "legacy", privateCa: false }, { id: "a", privateCa: true, privateAuthorityId: "ca-a" }, { id: "b", privateCa: true, privateAuthorityId: "ca-b" }];
  assert.deepEqual(certificatesInScope(records, "public").map(c => c.id), ["public", "legacy"]);
  assert.deepEqual(certificatesInScope(records, "private").map(c => c.id), ["a", "b"]);
  assert.deepEqual(certificatesInScope(records, "private", "ca-a").map(c => c.id), ["a"]);
  assert.equal(certificatesInScope(records, "private", "missing").length, 0);
});
test("root and service import verify actual signatures, keys and formats", async () => {
  const root = await createPrivateRoot({ CN: "Imported CA", O: "导入测试" }, 3650);
  const other = await createPrivateRoot({ CN: "Imported CA", O: "导入测试" }, 3650);
  const leaf = await issuePrivateCertificate(root, ["192.168.123.4"], 30);
  assert.equal(readImportedRoot({ certificate: root.certificatePem }).privateKey, "");
  assert.ok(readImportedRoot({ certificate: root.certificatePem, privateKey: root.privateKey }).privateKey);
  const der = new X509Certificate(root.certificatePem).raw.toString("base64");
  assert.equal(readImportedRoot({ certificate: der, encoding: "base64" }).fingerprint, new X509Certificate(root.certificatePem).fingerprint256);
  assert.throws(() => readImportedRoot({ certificate: leaf.certificatePem }), /INVALID_ROOT/);
  assert.throws(() => readImportedRoot({ certificate: root.certificatePem, privateKey: other.privateKey }), /INVALID_PRIVATE_KEY/);
  assert.throws(() => readImportedRoot({ certificate: root.certificatePem + other.certificatePem }), /INVALID_ROOT/);
  assert.throws(() => readImportedRoot({ certificate: "invalid" }), /INVALID_CERTIFICATE/);
  assert.throws(() => readImportedRoot({ certificate: root.certificatePem + root.privateKey }), /INVALID_CERTIFICATE/);
  const imported = await readImportedService({ certificate: leaf.certificatePem + root.certificatePem, privateKey: leaf.privateKey }, root.certificatePem);
  assert.equal(imported.certificatePem, leaf.certificatePem);
  assert.ok(imported.privateKey);
  assert.equal((await readImportedService({ certificate: leaf.certificatePem }, root.certificatePem)).privateKey, "");
  await assert.rejects(readImportedService({ certificate: leaf.certificatePem }, other.certificatePem), /CA_MISMATCH/);
  await assert.rejects(readImportedService({ certificate: leaf.certificatePem, privateKey: root.privateKey }, root.certificatePem), /INVALID_PRIVATE_KEY/);
  await assert.rejects(readImportedService({ certificate: leaf.certificatePem + other.certificatePem }, root.certificatePem), /CA_MISMATCH/);
  await assert.rejects(readImportedService({ certificate: root.certificatePem }, root.certificatePem), /INVALID_SERVICE/);
});
test("import and workspace labels cover five languages", () => {
  const keys = Object.keys(pkiManagementMessages("zh-CN")).sort();
  for (const language of ["zh-CN", "zh-TW", "en", "ja", "ko"]) {
    assert.deepEqual(Object.keys(pkiManagementMessages(language)).sort(), keys);
    for (const value of Object.values(pkiManagementMessages(language))) assert.ok(value.trim());
  }
});
test("import validates intermediate constraints and permits expired archival, without trusting another root", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "certops-import-chain-"));
  const openssl = (...args) => execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
  const read = name => readFileSync(path.join(directory, name), "utf8");
  try {
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365", "-keyout", "root.key", "-out", "root.pem", "-subj", "/CN=Chain Root", "-addext", "basicConstraints=critical,CA:TRUE,pathlen:1", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
    openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "intermediate.key", "-out", "intermediate.csr", "-subj", "/CN=Intermediate");
    writeFileSync(path.join(directory, "intermediate.cnf"), "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n");
    openssl("x509", "-req", "-in", "intermediate.csr", "-CA", "root.pem", "-CAkey", "root.key", "-set_serial", "2", "-days", "180", "-extfile", "intermediate.cnf", "-out", "intermediate.pem");
    openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=nas.internal");
    writeFileSync(path.join(directory, "leaf.cnf"), "basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:nas.internal\nauthorityKeyIdentifier=keyid,issuer\n");
    writeFileSync(path.join(directory, "index"), "");
    writeFileSync(path.join(directory, "serial"), "01\n");
    writeFileSync(path.join(directory, "ca.cnf"), "[ca]\ndefault_ca=local\n[local]\ndatabase=index\nserial=serial\nnew_certs_dir=.\ncertificate=intermediate.pem\nprivate_key=intermediate.key\ndefault_md=sha256\npolicy=policy\nx509_extensions=extensions\n[policy]\ncommonName=supplied\n[extensions]\n" + read("leaf.cnf"));
    openssl("ca", "-batch", "-notext", "-config", "ca.cnf", "-in", "leaf.csr", "-startdate", "20200101000000Z", "-enddate", "20200102000000Z", "-out", "leaf.pem");
    const root = read("root.pem"), intermediate = read("intermediate.pem"), leaf = read("leaf.pem");
    assert.ok(Date.parse(new X509Certificate(leaf).validTo) < Date.now());
    const result = await readImportedService({ certificate: leaf + intermediate + root }, root);
    assert.equal(result.certificatePem, leaf + intermediate);
    assert.throws(() => readImportedRoot({ certificate: intermediate }), /INVALID_ROOT/);
    await assert.rejects(readImportedService({ certificate: leaf }, root), /CA_MISMATCH/);
    // A valid signature alone is insufficient: intermediate CA basicConstraints are enforced.
    writeFileSync(path.join(directory, "bad.cnf"), "basicConstraints=critical,CA:FALSE\nsubjectKeyIdentifier=hash\n");
    openssl("x509", "-req", "-in", "intermediate.csr", "-CA", "root.pem", "-CAkey", "root.key", "-set_serial", "4", "-days", "180", "-extfile", "bad.cnf", "-out", "bad.pem");
    await assert.rejects(readImportedService({ certificate: leaf + read("bad.pem") }, root), /CA_MISMATCH/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
