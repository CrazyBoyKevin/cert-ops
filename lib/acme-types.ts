export type AcmeEnvironment = "staging" | "production";
export type ManualDnsRecord = { name: string; rr: string; type: "TXT"; value: string; domain: string; verified: boolean };
export type AcmeSettings = {
  email: string;
  termsAgreed: boolean;
};
export type AliyunCredential = {
  id: string;
  name: string;
  accessKeyId: string;
  accessKeySecret: string;
};
export type PublicAliyunCredential = {
  id: string;
  name: string;
  accessKeyHint: string;
  orderCount: number;
};
export type AcmeIssuanceConfig = AcmeSettings & Pick<AliyunCredential, "accessKeyId" | "accessKeySecret">;
export type PublicAcmeSettings = AcmeSettings & {
  credentialsConfigured: boolean;
  credentials: PublicAliyunCredential[];
};
export type AcmeOrder = {
  id: string;
  dnsProvider: "aliyun" | "manual";
  manualRecords: ManualDnsRecord[];
  manualExpiresAt: string | null;
  dnsCheckedAt: string | null;
  credentialId: string | null;
  credentialName: string | null;
  name: string;
  groupId: string | null;
  domains: string[];
  zone: string;
  environment: AcmeEnvironment;
  autoRenew: boolean;
  certificateId: string | null;
  status: "queued" | "running" | "issued" | "failed" | "waiting_dns" | "dns_ready";
  stage: string;
  lastError: string | null;
  nextAttemptAt: string;
  expiresAt: string | null;
  lastIssuedAt: string | null;
};
