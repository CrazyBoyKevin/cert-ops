import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCertificate } from "../lib/certificate.ts";
import { decryptSecret, encryptSecret } from "../lib/crypto-store.ts";
import { createZipArchive } from "../lib/zip.ts";
import { certificateExportFiles, certificateExportNames } from "../lib/certificate-export.ts";

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

test("creates a ZIP containing exactly a PEM certificate chain and a KEY private key", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "certops-zip-test-"));
  const archivePath = path.join(directory, "keys.zip");
  try {
    const certificatePem = "-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nINTERMEDIATE\n-----END CERTIFICATE-----\n";
    const privateKey = "-----BEGIN PRIVATE KEY-----\nPRIVATE KEY CONTENT\n-----END PRIVATE KEY-----\n";
    const archive = createZipArchive(certificateExportFiles("example.com", { certificatePem, privateKey }));
    writeFileSync(archivePath, archive);
    assert.deepEqual(execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" }).trim().split("\n"), ["example.com.pem", "example.com.key"]);
    assert.equal(execFileSync("unzip", ["-p", archivePath, "example.com.pem"], { encoding: "utf8" }), certificatePem);
    assert.equal(execFileSync("unzip", ["-p", archivePath, "example.com.key"], { encoding: "utf8" }), privateKey);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uses consistent safe filenames for individual and wildcard certificate exports", () => {
  assert.deepEqual(certificateExportNames("*.example.com"), {
    certificatePem: "wildcard.example.com.pem",
    privateKey: "wildcard.example.com.key",
    archive: "wildcard.example.com.keys.zip",
  });
  const names = certificateExportNames('example.com/\\\r\n"');
  for (const name of Object.values(names)) assert.match(name, /^[a-zA-Z0-9._-]+$/);
  assert.equal(certificateExportNames("").certificatePem, "certificate.pem");
});
