import { isIP } from "node:net";
import { domainToASCII } from "node:url";

export class AcmeError extends Error {
  constructor(code: string) { super(code); this.name = "AcmeError"; }
}

export function normalizeDomain(value: unknown, wildcard = true): string {
  if (typeof value !== "string" || value.length > 512) throw new AcmeError("INVALID_DOMAIN");
  const input = value.trim().toLowerCase().replace(/\.$/, "");
  const prefix = wildcard && input.startsWith("*.") ? "*." : "";
  const base = prefix ? input.slice(2) : input;
  if (!/^[\p{L}\p{N}\p{M}.-]+$/u.test(base)) throw new AcmeError("INVALID_DOMAIN");
  const domain = domainToASCII(base);
  if (!domain || domain.length + prefix.length > 253 || isIP(domain) || !domain.includes(".") ||
      !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      !/[a-z]/.test(domain.split(".").at(-1)!)) throw new AcmeError("INVALID_DOMAIN");
  return prefix + domain;
}

export function validateOrder(input: Record<string, unknown>) {
  const zone = normalizeDomain(input.zone, false);
  const raw = Array.isArray(input.domains) ? input.domains : String(input.domains || "").split(/[\s,，]+/).filter(Boolean);
  if (!raw.length || raw.length > 20) throw new AcmeError("INVALID_DOMAINS");
  const domains = [...new Set(raw.map((item) => normalizeDomain(item)))];
  if (domains.some((domain) => { const base = domain.replace(/^\*\./, ""); return base !== zone && !base.endsWith(`.${zone}`); })) {
    throw new AcmeError("DOMAIN_OUTSIDE_ZONE");
  }
  const name = String(input.name || domains[0]).trim();
  if (!name || name.length > 180) throw new AcmeError("INVALID_NAME");
  const groupId = validateId(input.groupId);
  if (input.environment !== "staging" && input.environment !== "production") throw new AcmeError("INVALID_ENVIRONMENT");
  if (typeof input.autoRenew !== "boolean") throw new AcmeError("INVALID_REQUEST");
  const dnsProvider = input.dnsProvider ?? "aliyun";
  if (dnsProvider !== "aliyun" && dnsProvider !== "manual") throw new AcmeError("INVALID_REQUEST");
  if (dnsProvider === "manual" && (input.autoRenew || input.credentialId)) throw new AcmeError("MANUAL_DNS_ONLY");
  if (dnsProvider === "aliyun" && !input.credentialId) throw new AcmeError("CREDENTIAL_REQUIRED");
  const credentialId = dnsProvider === "manual" ? null : validateId(input.credentialId);
  return { name, groupId, domains, zone, environment: input.environment, autoRenew: input.autoRenew, credentialId, dnsProvider };
}

export function validateId(id: unknown): string {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AcmeError("INVALID_ID");
  return id;
}

export type OrderQuery = { scope?: "pending"; certificateId?: string; id?: string; page?: number };

export function parseOrderQuery(params: URLSearchParams): OrderQuery {
  const scope = params.get("scope"), certificateId = params.get("certificateId"), id = params.get("id");
  if ([scope, certificateId, id].filter((value) => value !== null).length > 1 ||
      (scope !== null && scope !== "pending") || (params.has("page") && scope !== "pending")) throw new AcmeError("INVALID_REQUEST");
  if (certificateId !== null) return { certificateId: validateId(certificateId) };
  if (id !== null) return { id: validateId(id) };
  if (scope === "pending") {
    const rawPage = params.get("page") ?? "1";
    if (!/^[1-9]\d{0,6}$/.test(rawPage)) throw new AcmeError("INVALID_REQUEST");
    return { scope, page: Number(rawPage) };
  }
  return {};
}

export function challengeRecord(domain: string, zone: string) {
  const base = normalizeDomain(domain).replace(/^\*\./, "");
  if (base !== zone && !base.endsWith(`.${zone}`)) throw new AcmeError("DOMAIN_OUTSIDE_ZONE");
  return base === zone ? "_acme-challenge" : `_acme-challenge.${base.slice(0, -(zone.length + 1))}`;
}

export function renewalWindow(validFrom: string, expiresAt: string) {
  return Math.min(30 * 86400_000, (Date.parse(expiresAt) - Date.parse(validFrom)) / 3);
}

export function publicAcmeError(error: unknown): string {
  if (error instanceof AcmeError) return error.message;
  // Never return SDK errors, URLs, signed request data, keys, or database details.
  const message = error instanceof Error ? error.message : "";
  if (/rateLimited|too many|rate limit/i.test(message)) return "RATE_LIMITED";
  if (/CAA/i.test(message)) return "CAA_REJECTED";
  if (/unauthorized|incorrect TXT|NXDOMAIN|DNS problem/i.test(message)) return "DNS_VALIDATION_FAILED";
  return "ISSUANCE_FAILED";
}
