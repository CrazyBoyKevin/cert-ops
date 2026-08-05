import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";

function valueFromDn(dn: string, key: string) {
  return dn
    .split(/\n|,(?=\s*[A-Z]+=)/)
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

function parseDomains(x509: X509Certificate) {
  const domains = (x509.subjectAltName || "")
    .split(/,\s*/)
    .filter((item) => item.startsWith("DNS:"))
    .map((item) => item.slice(4).trim());
  const commonName = valueFromDn(x509.subject, "CN");
  if (commonName && !domains.includes(commonName)) domains.unshift(commonName);
  return [...new Set(domains)];
}

export function parseCertificate(input: Buffer | string, privateKey?: string) {
  const x509 = new X509Certificate(input);
  const domains = parseDomains(x509);
  const primaryDomain = domains[0] || valueFromDn(x509.subject, "CN") || "未识别域名";
  const issuer = valueFromDn(x509.issuer, "O") || valueFromDn(x509.issuer, "CN") || x509.issuer;

  if (privateKey?.trim()) {
    const privatePublic = createPublicKey(createPrivateKey(privateKey)).export({ type: "spki", format: "der" });
    const certPublic = x509.publicKey.export({ type: "spki", format: "der" });
    if (!Buffer.from(privatePublic).equals(Buffer.from(certPublic))) {
      throw new Error("私钥与证书不匹配，请检查后重新上传");
    }
  }

  const keyType = x509.publicKey.asymmetricKeyType?.toUpperCase() || "UNKNOWN";
  const details = x509.publicKey.asymmetricKeyDetails;
  const bits = details && "modulusLength" in details ? ` ${details.modulusLength}` : "";

  return {
    primaryDomain,
    domains: domains.length ? domains : [primaryDomain],
    issuer,
    validFrom: new Date(x509.validFrom).toISOString(),
    expiresAt: new Date(x509.validTo).toISOString(),
    serialNumber: x509.serialNumber,
    fingerprint: x509.fingerprint256,
    algorithm: `${keyType}${bits}`,
  };
}
