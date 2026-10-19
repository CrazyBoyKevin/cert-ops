import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import test from "node:test";
import { createPrivateRoot, issuePrivateCertificate, pkiSubject, pkiIps, pkiDays, pkiName, pkiId } from "../lib/private-pki.ts";
import { parseCertificate } from "../lib/certificate.ts";
import { pkiMessages } from "../lib/private-pki-i18n.ts";

test("private PKI validates subjects, IDs, names, IPs and lifetimes before invoking OpenSSL", () => {
  assert.deepEqual(pkiSubject({ CN: "测试根证书", C: "cn" }), { CN: "测试根证书", C: "CN" });
  for (const value of [{}, { CN: "test\nCN=evil" }, { CN: "test", C: "CHN" }, { CN: "test", email: "x" }, { CN: "字".repeat(64) }]) assert.throws(() => pkiSubject(value));
  for (const value of ["https://192.168.1.1", "192.168.1.1:443", "192.168.1.0/24", "fe80::1%en0", "example.com", "", Array(65).fill("127.0.0.1")]) assert.throws(() => pkiIps(value));
  assert.deepEqual(pkiIps("192.168.1.1,fd00::1\n192.168.1.1"), ["192.168.1.1", "fd00::1"]);
  assert.deepEqual(pkiIps("FD00:0:0:0:0:0:0:1,fd00::1"), ["fd00::1"]);
  for (const value of [0, -1, 366, 1.5, "30", Infinity]) assert.throws(() => pkiDays(value));
  assert.equal(pkiDays(7300, true), 7300);
  assert.throws(() => pkiId("../../private.key"));
  assert.throws(() => pkiName("\n"));
  assert.equal(pkiName(" 测试 NAS "), "测试 NAS");
});
test("private CA signs IPv4/IPv6 server-only certificates with independent keys and bounded validity", async () => {
  const root = await createPrivateRoot({ CN: "Test / Root + CA", O: "测试组织", C: "CN" }, 365);
  const ca = new X509Certificate(root.certificatePem);
  assert.equal(ca.ca, true); assert.ok(ca.verify(ca.publicKey));
  const first = await issuePrivateCertificate(root, ["192.168.1.10", "fd00::10"], 30);
  const leaf = new X509Certificate(first.certificatePem);
  assert.equal(leaf.ca, false); assert.ok(leaf.verify(ca.publicKey));
  assert.ok(leaf.checkIP("192.168.1.10")); assert.ok(leaf.checkIP("fd00::10"));
  assert.equal(leaf.checkIP("192.168.1.11"), undefined);
  assert.deepEqual(leaf.keyUsage, ["1.3.6.1.5.5.7.3.1"]);
  assert.equal(parseCertificate(first.certificatePem, first.privateKey).domains.length, 2);
  assert.deepEqual(parseCertificate(first.certificatePem).domains, ["192.168.1.10", "fd00::10"]);
  const renewed = await issuePrivateCertificate(root, ["fd00::10"], 30);
  assert.notEqual(first.privateKey, renewed.privateKey);
  assert.equal(parseCertificate(renewed.certificatePem, renewed.privateKey).domains.length, 1);
  assert.throws(() => parseCertificate(first.certificatePem, renewed.privateKey));
  await assert.rejects(issuePrivateCertificate(root, ["127.0.0.1"], 365), /CA_EXPIRES_SOON/);
  await assert.rejects(issuePrivateCertificate({ ...root, privateKey: "" }, ["127.0.0.1"], 30), /ENCRYPTION_REQUIRED/);
});
test("private PKI messages cover all five languages", () => {
  const keys = Object.keys(pkiMessages("zh-CN")).sort();
  for (const language of ["zh-CN", "zh-TW", "en", "ja", "ko"]) {
    assert.deepEqual(Object.keys(pkiMessages(language)).sort(), keys);
    for (const value of Object.values(pkiMessages(language))) assert.ok(value.trim());
  }
});
