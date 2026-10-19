import type { Certificate } from "./types";
export type CertificateScope = "public" | "private";
export function certificateWorkspaceScope(project: string, groupIds: string[], type: CertificateScope, ca: string) {
  if (project !== "all" && groupIds.includes(project)) return "project";
  // Cross-project access is limited to the explicit service view of a root CA.
  if (project === "all" && type === "private" && ca !== "all") return "authority";
  return "none";
}
export function certificatesInProject(certificates: Certificate[], groupId: string) {
  return groupId === "all" ? certificates : certificates.filter(certificate => certificate.groupId === groupId);
}
// Project overview deliberately ignores certificate type and all list-only filters.
export function certificateMetrics(certificates: Certificate[], now = Date.now()) {
  const metrics = { total: certificates.length, healthy: 0, expiring: 0, expired: 0 };
  for (const certificate of certificates) {
    const days = Math.ceil((Date.parse(certificate.expiresAt) - now) / 86_400_000);
    if (days < 0) metrics.expired++;
    else if (days <= 30) metrics.expiring++;
    else if (days > 30) metrics.healthy++;
  }
  return metrics;
}
export function certificatesInScope(certificates: Certificate[], scope: CertificateScope, authorityId = "all") {
  return certificates.filter(certificate => Boolean(certificate.privateCa) === (scope === "private") && (scope !== "private" || authorityId === "all" || certificate.privateAuthorityId === authorityId));
}
