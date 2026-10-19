import { execFile } from "node:child_process";
import { createPrivateKey, randomBytes, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalAddress } from "./ip-address.ts";

const exec = promisify(execFile);
export class PkiError extends Error {}
export function readImportedCertificates(value: unknown, encoding: unknown = "pem") {
  try {
    if (typeof value !== "string" || !value.trim() || value.length > 350_000 || !["pem", "base64"].includes(String(encoding))) throw new Error();
    if (encoding === "base64" && !/^[A-Za-z0-9+/=\s]+$/.test(value)) throw new Error();
    const buffer = encoding === "base64" ? Buffer.from(value, "base64") : Buffer.from(value);
    if (buffer.length > 262_144) throw new Error();
    const text = buffer.toString("utf8");
    if (text.includes("-----BEGIN CERTIFICATE-----")) {
      const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
      if (!blocks.length || blocks.length > 10 || text.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim()) throw new Error();
      return blocks.map(block => new X509Certificate(block));
    }
    if (encoding !== "base64") throw new Error();
    return [new X509Certificate(buffer)];
  } catch { throw new PkiError("INVALID_CERTIFICATE"); }
}
function importedKey(value: unknown, certificate: X509Certificate) {
  if (value === undefined || value === "") return "";
  try {
    if (typeof value !== "string" || value.length > 32_768) throw new Error();
    if (!value.trim()) return "";
    const key = createPrivateKey(value);
    if (!certificate.checkPrivateKey(key)) throw new Error();
    return key.export({ format: "pem", type: "pkcs8" }).toString();
  } catch { throw new PkiError("INVALID_PRIVATE_KEY"); }
}
export function readImportedRoot(input: Record<string, unknown>) {
  const certificates = readImportedCertificates(input.certificate, input.encoding);
  const root = certificates[0];
  if (certificates.length !== 1 || !root.ca || !root.checkIssued(root) || !root.verify(root.publicKey)) throw new PkiError("INVALID_ROOT");
  const subject = Object.fromEntries(Object.entries(root.toLegacyObject().subject).map(([key, value]) => [key, String(value)]));
  subject.CN ||= root.fingerprint256.slice(0, 23);
  return { certificatePem: root.toString(), privateKey: importedKey(input.privateKey, root), subject, expiresAt: new Date(root.validTo), fingerprint: root.fingerprint256 };
}
export async function readImportedService(input: Record<string, unknown>, rootPem: string) {
  const certificates = readImportedCertificates(input.certificate, input.encoding), leaf = certificates[0];
  if (leaf.ca) throw new PkiError("INVALID_SERVICE");
  const privateKey = importedKey(input.privateKey, leaf);
  const root = new X509Certificate(rootPem);
  // Require a coherent leaf-first chain; do not persist unrelated appended certificates.
  for (let index = 0; index < certificates.length; index++) {
    const cert = certificates[index], issuer = certificates[index + 1] || root;
    if (cert.fingerprint256 === root.fingerprint256 && index !== certificates.length - 1) throw new PkiError("CA_MISMATCH");
    if (!cert.checkIssued(issuer) || !cert.verify(issuer.publicKey)) throw new PkiError("CA_MISMATCH");
  }
  // Explicit trust anchor only, with no network/AIA fetching. Expired certificates may be archived.
  await workspace(async directory => {
    await writeFile(path.join(directory, "root.pem"), rootPem);
    await writeFile(path.join(directory, "leaf.pem"), leaf.toString());
    const args = ["verify", "-trusted", "root.pem", "-no_check_time", "-purpose", "sslserver"];
    if (certificates.length > 1) {
      await writeFile(path.join(directory, "chain.pem"), certificates.slice(1).map(cert => cert.toString()).join(""));
      args.push("-untrusted", "chain.pem");
    }
    try { await openssl([...args, "leaf.pem"], directory); } catch { throw new PkiError("CA_MISMATCH"); }
  });
  return { certificatePem: certificates.filter(cert => cert.fingerprint256 !== root.fingerprint256).map(cert => cert.toString()).join(""), privateKey };
}
export type RootSubject = { CN: string; O?: string; OU?: string; C?: string; ST?: string; L?: string };
export function pkiId(value: unknown): string {
  if (typeof value !== "string" || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) throw new PkiError("INVALID_INPUT");
  return value;
}
export function pkiDays(value: unknown, root = false): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > (root ? 7300 : 365)) throw new PkiError("INVALID_INPUT");
  return value;
}
export function pkiSubject(value: unknown): RootSubject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PkiError("INVALID_SUBJECT");
  const result: Record<string, string> = {};
  for (const [key, input] of Object.entries(value)) {
    if (!["CN", "O", "OU", "C", "ST", "L"].includes(key) || typeof input !== "string") throw new PkiError("INVALID_SUBJECT");
    const text = input.trim();
    if (/[\x00-\x1f\x7f]/.test(input) || Buffer.byteLength(text) > (["ST", "L"].includes(key) ? 128 : 64)) throw new PkiError("INVALID_SUBJECT");
    if (key === "C" && text && !/^[a-z]{2}$/i.test(text)) throw new PkiError("INVALID_SUBJECT");
    if (text) result[key] = key === "C" ? text.toUpperCase() : text;
  }
  if (!result.CN) throw new PkiError("INVALID_SUBJECT");
  return result as RootSubject;
}
export function pkiIps(value: unknown): string[] {
  const entries = typeof value === "string" ? value.trim().split(/[\s,，]+/) : value;
  if (!Array.isArray(entries) || !entries.length || entries.length > 64 || entries.some(ip => typeof ip !== "string" || ip.includes("%") || !isIP(ip))) throw new PkiError("INVALID_IP");
  return [...new Set((entries as string[]).map(canonicalAddress))];
}
export function pkiName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 180 || /[\x00-\x1f\x7f]/.test(value)) throw new PkiError("INVALID_INPUT");
  return value.trim();
}
async function openssl(args: string[], cwd: string) {
  try { await exec("openssl", args, { cwd, timeout: 60_000, maxBuffer: 256_000 }); }
  catch { throw new PkiError("SIGNING_FAILED"); } // Never expose process stderr or temporary key paths.
}
async function workspace<T>(work: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(path.join(tmpdir(), "certops-pki-"));
  try { return await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const serial = () => `0x${randomBytes(19).toString("hex")}`;
const keygen = async (directory: string, bits: number) => {
  await writeFile(path.join(directory, "server.key"), "", { mode: 0o600 });
  await openssl(["genpkey", "-algorithm", "RSA", "-pkeyopt", `rsa_keygen_bits:${bits}`, "-out", "server.key"], directory);
};
async function material(directory: string) {
  return { certificatePem: await readFile(path.join(directory, "server.pem"), "utf8"), privateKey: await readFile(path.join(directory, "server.key"), "utf8") };
}
export async function createPrivateRoot(input: unknown, validity: unknown) {
  const subject = pkiSubject(input), days = pkiDays(validity, true);
  const dn = Object.entries(subject).map(([k, v]) => `/${k}=${v.replace(/\\/g, "\\\\").replace(/\//g, "\\/").replace(/\+/g, "\\+")}`).join("");
  return workspace(async directory => {
    await keygen(directory, 4096);
    await openssl(["req", "-new", "-x509", "-utf8", "-sha256", "-days", String(days), "-set_serial", serial(), "-key", "server.key", "-subj", dn, "-out", "server.pem",
      "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-addext", "subjectKeyIdentifier=hash"], directory);
    await openssl(["verify", "-check_ss_sig", "-CAfile", "server.pem", "server.pem"], directory);
    return material(directory);
  });
}
export async function issuePrivateCertificate(root: { certificatePem: string; privateKey: string }, addresses: unknown, validity: unknown) {
  const ips = pkiIps(addresses), days = pkiDays(validity);
  const ca = new X509Certificate(root.certificatePem);
  if (!ca.ca || !root.privateKey) throw new PkiError("ENCRYPTION_REQUIRED");
  if (Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) < Date.now() + (days * 86400 + 300) * 1000) throw new PkiError("CA_EXPIRES_SOON");
  return workspace(async directory => {
    await writeFile(path.join(directory, "root.pem"), root.certificatePem, { mode: 0o600 });
    await writeFile(path.join(directory, "root.key"), root.privateKey, { mode: 0o600 });
    await writeFile(path.join(directory, "extensions.cnf"), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nsubjectAltName=${ips.map(ip => `IP:${ip}`).join(",")}\n`, { mode: 0o600 });
    await keygen(directory, 2048);
    await openssl(["req", "-new", "-sha256", "-key", "server.key", "-subj", `/CN=${ips[0]}`, "-out", "server.csr"], directory);
    await openssl(["x509", "-req", "-in", "server.csr", "-CA", "root.pem", "-CAkey", "root.key", "-set_serial", serial(), "-days", String(days), "-sha256", "-extfile", "extensions.cnf", "-out", "server.pem"], directory);
    for (const ip of ips) await openssl(["verify", "-purpose", "sslserver", "-verify_ip", ip, "-CAfile", "root.pem", "server.pem"], directory);
    return material(directory);
  });
}
