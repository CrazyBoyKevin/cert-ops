export type Group = { id: string; name: string; color: string; count?: number };

export type Certificate = {
  id: string;
  name: string;
  primaryDomain: string;
  domains: string[];
  issuer: string;
  validFrom: string;
  expiresAt: string;
  serialNumber: string;
  fingerprint: string;
  algorithm: string;
  groupId: string;
  groupName?: string;
  groupColor?: string;
  createdAt: string;
  hasPrivateKey: boolean;
};

export type NotificationSettings = {
  dingtalkEnabled: boolean;
  dingtalkWebhook: string;
  dingtalkSecret: string;
  feishuEnabled: boolean;
  feishuWebhook: string;
  feishuSecret: string;
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  emailFrom: string;
  emailRecipients: string;
};

export type StorageMode = "postgresql" | "demo";
