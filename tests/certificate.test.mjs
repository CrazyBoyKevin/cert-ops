import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCertificate } from "../lib/certificate.ts";
import { decryptSecret, encryptSecret } from "../lib/crypto-store.ts";
import { createZipArchive } from "../lib/zip.ts";

test("encrypts sensitive values for storage", () => {
  const plaintext = "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
  const encrypted = encryptSecret(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptSecret(encrypted), plaintext);
});

test("parses X.509 metadata and validates the private key", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "certops-test-"));
  const certificatePath = path.join(directory, "certificate.pem");
  const keyPath = path.join(directory, "private.key");
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
      "-keyout", keyPath, "-out", certificatePath,
      "-subj", "/O=CertOps Test/CN=api.certops.test",
      "-addext", "subjectAltName=DNS:api.certops.test,DNS:gateway.certops.test",
    ], { stdio: "ignore" });
    const parsed = parseCertificate(readFileSync(certificatePath), readFileSync(keyPath, "utf8"));
    assert.equal(parsed.primaryDomain, "api.certops.test");
    assert.deepEqual(parsed.domains, ["api.certops.test", "gateway.certops.test"]);
    assert.equal(parsed.issuer, "CertOps Test");
    assert.match(parsed.algorithm, /^RSA 2048$/);
    assert.ok(new Date(parsed.expiresAt) > new Date(parsed.validFrom));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("creates a ZIP containing the public and private key files", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "certops-zip-test-"));
  const archivePath = path.join(directory, "keys.zip");
  try {
    const archive = createZipArchive([
      { name: "example.public-key.pem", data: "PUBLIC KEY CONTENT" },
      { name: "example.private-key.pem", data: "PRIVATE KEY CONTENT" },
    ]);
    writeFileSync(archivePath, archive);
    assert.equal(execFileSync("unzip", ["-p", archivePath, "example.public-key.pem"], { encoding: "utf8" }), "PUBLIC KEY CONTENT");
    assert.equal(execFileSync("unzip", ["-p", archivePath, "example.private-key.pem"], { encoding: "utf8" }), "PRIVATE KEY CONTENT");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
