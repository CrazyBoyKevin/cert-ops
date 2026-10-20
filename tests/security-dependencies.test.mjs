import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as acme from "acme-client";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const json = file => JSON.parse(readFileSync(new URL(file, root), "utf8"));

test("production dependency graph excludes Forge and uses patched Nodemailer", () => {
  const lock = json("package-lock.json");
  assert.equal(json("package.json").dependencies["acme-client"], "file:vendor/acme-client");
  assert.equal(lock.packages["node_modules/acme-client"].link, true);
  assert.equal(lock.packages["node_modules/nodemailer"].version, "10.1.7");
  for (const [path, entry] of Object.entries(lock.packages)) {
    assert.ok(!path.endsWith("/node-forge"), path);
    assert.equal(entry.dependencies?.["node-forge"], undefined, path);
  }
  assert.throws(() => require.resolve("node-forge"), { code: "MODULE_NOT_FOUND" });
  assert.equal(acme.forge, undefined);
  assert.equal(existsSync(new URL("vendor/acme-client/src/crypto/forge.js", root)), false);
});

test("vendored protocol and native crypto files retain reviewed provenance", () => {
  const provenance = json("vendor/acme-client/UPSTREAM.json");
  assert.equal(provenance.version, "5.4.0");
  const changed = ["src/index.js", "types/index.d.ts"];
  for (const [file, hashes] of Object.entries(provenance.files)) {
    const bytes = readFileSync(new URL(`vendor/acme-client/${file}`, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hashes.vendored, file);
    if (!changed.includes(file)) assert.equal(hashes.vendored, hashes.upstream, file);
  }
  assert.match(readFileSync(new URL("vendor/acme-client/LICENSE", root), "utf8"), /Labrador CMS AS/);
});

for (const algorithm of ["rsa", "ec"]) {
  test(`native ACME ${algorithm} keys and CSRs work without Forge`, async () => {
    const key = algorithm === "rsa" ? await acme.crypto.createPrivateKey() : await acme.crypto.createPrivateEcdsaKey();
    assert.equal(createPrivateKey(key).asymmetricKeyType, algorithm);
    const [returnedKey, csr] = await acme.crypto.createCsr({ commonName: "example.test", altNames: ["example.test", "*.example.test"] }, key);
    assert.deepEqual(returnedKey, key);
    assert.deepEqual(new Set([acme.crypto.readCsrDomains(csr).commonName, ...acme.crypto.readCsrDomains(csr).altNames]), new Set(["example.test", "*.example.test"]));
    const publicKey = createPublicKey({ key: acme.crypto.getJwk(key), format: "jwk" });
    const payload = Buffer.from("ACME account key compatibility");
    const signature = sign("sha256", payload, key);
    assert.equal(verify("sha256", payload, publicKey, signature), true);
    assert.equal(verify("sha256", Buffer.from("tampered"), publicKey, signature), false);
  });
}
