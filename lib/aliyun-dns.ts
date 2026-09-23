import RPCClient from "@alicloud/pop-core";
import { Resolver } from "node:dns/promises";
import { setTimeout as delay } from "node:timers/promises";
import { AcmeError } from "./acme-validation.ts";

export type DnsCredentials = { accessKeyId: string; accessKeySecret: string };
export type DnsRecord = { RecordId: string; RR: string; Type: string; Value: string };
export type DnsRequest = <T>(action: string, params: Record<string, unknown>) => Promise<T>;

export function aliyunRequest(credentials: DnsCredentials): DnsRequest {
  const client = new RPCClient({ ...credentials, endpoint: "https://alidns.aliyuncs.com", apiVersion: "2015-01-09" });
  return async <T>(action: string, params: Record<string, unknown>) => {
    try { return await client.request<T>(action, params, { method: "POST", timeout: 20_000 }); }
    catch (error) {
      const code = String((error as { code?: string })?.code || "");
      if (/InvalidRecordId.NotFound/i.test(code) && action === "DeleteDomainRecord") return {} as T;
      if (/Forbidden|AccessKey|Signature|Unauthorized/i.test(code)) throw new AcmeError("DNS_ACCESS_DENIED");
      throw new AcmeError("DNS_API_FAILED");
    }
  };
}

export async function findChallengeRecords(request: DnsRequest, zone: string, rr: string, value: string) {
  const matches: DnsRecord[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = await request<{ TotalCount: number; DomainRecords: { Record: DnsRecord[] } }>("DescribeDomainRecords", {
      DomainName: zone, RRKeyWord: rr, TypeKeyWord: "TXT", SearchMode: "COMBINATION", PageNumber: page, PageSize: 100,
    });
    const records = result.DomainRecords?.Record || [];
    matches.push(...records.filter((item) => item.RR === rr && item.Type === "TXT" && item.Value === value));
    if (page * 100 >= result.TotalCount || records.length < 100) return matches;
  }
  throw new AcmeError("DNS_API_FAILED");
}

export async function waitForTxt(name: string, value: string, options: {
  timeoutMs?: number; intervalMs?: number; lookup?: (server: string, name: string) => Promise<string[][]>;
} = {}) {
  const lookup = options.lookup || (async (server, domain) => {
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([server]);
    return resolver.resolveTxt(domain);
  });
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  do {
    const propagated = await Promise.all(["223.5.5.5", "1.1.1.1"].map(async (server) => {
      try { return (await lookup(server, name)).some((parts) => parts.join("") === value); }
      catch { return false; }
    }));
    if (propagated.every(Boolean)) return;
    if (Date.now() >= deadline) break;
    await delay(Math.min(options.intervalMs ?? 10_000, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new AcmeError("DNS_PROPAGATION_TIMEOUT");
}
