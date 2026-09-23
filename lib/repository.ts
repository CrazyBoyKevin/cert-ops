import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { decryptSecret, encryptSecret } from "./crypto-store.ts";
import type { Certificate, Group, NotificationSettings, StorageMode } from "./types";
import type { ReminderStore } from "./reminder-runner";

const DEFAULT_SETTINGS: NotificationSettings = {
  dingtalkEnabled: false,
  dingtalkWebhook: "",
  dingtalkSecret: "",
  feishuEnabled: false,
  feishuWebhook: "",
  feishuSecret: "",
  emailEnabled: false,
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: "",
  smtpPassword: "",
  emailFrom: "",
  emailRecipients: "",
};

const groupSeeds: Group[] = [
  { id: "7fa0358d-8b8a-4c3d-bf85-5c9436e95e01", name: "核心业务", color: "#5B6CFF" },
  { id: "7fa0358d-8b8a-4c3d-bf85-5c9436e95e02", name: "营销站点", color: "#12B886" },
  { id: "7fa0358d-8b8a-4c3d-bf85-5c9436e95e03", name: "内部服务", color: "#F59F00" },
];

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

const certificateSeeds: Certificate[] = [
  {
    id: "a61a780b-87ae-4cc3-aa2c-82f2d61a1001",
    name: "生产 API 网关",
    primaryDomain: "api.certops.cn",
    domains: ["api.certops.cn", "gateway.certops.cn"],
    issuer: "DigiCert Inc",
    validFrom: futureDate(-318),
    expiresAt: futureDate(47),
    serialNumber: "0A:93:7F:12:8C:44",
    fingerprint: "67:3A:AE:35:72:9F:10:88",
    algorithm: "RSA 2048",
    groupId: groupSeeds[0].id,
    groupName: groupSeeds[0].name,
    groupColor: groupSeeds[0].color,
    createdAt: futureDate(-164),
    hasPrivateKey: true,
  },
  {
    id: "a61a780b-87ae-4cc3-aa2c-82f2d61a1002",
    name: "官网通配符证书",
    primaryDomain: "*.certops.cn",
    domains: ["*.certops.cn", "certops.cn"],
    issuer: "Let's Encrypt",
    validFrom: futureDate(-78),
    expiresAt: futureDate(12),
    serialNumber: "03:2C:88:6A:12:FE",
    fingerprint: "A8:7C:29:EC:11:6B:43:0D",
    algorithm: "EC P-256",
    groupId: groupSeeds[1].id,
    groupName: groupSeeds[1].name,
    groupColor: groupSeeds[1].color,
    createdAt: futureDate(-72),
    hasPrivateKey: true,
  },
  {
    id: "a61a780b-87ae-4cc3-aa2c-82f2d61a1003",
    name: "运维监控面板",
    primaryDomain: "monitor.internal.cn",
    domains: ["monitor.internal.cn"],
    issuer: "GlobalSign nv-sa",
    validFrom: futureDate(-359),
    expiresAt: futureDate(6),
    serialNumber: "42:11:B9:70:36:DA",
    fingerprint: "31:DF:88:B3:62:10:C4:91",
    algorithm: "RSA 2048",
    groupId: groupSeeds[2].id,
    groupName: groupSeeds[2].name,
    groupColor: groupSeeds[2].color,
    createdAt: futureDate(-311),
    hasPrivateKey: false,
  },
  {
    id: "a61a780b-87ae-4cc3-aa2c-82f2d61a1004",
    name: "客户控制台",
    primaryDomain: "console.certops.cn",
    domains: ["console.certops.cn"],
    issuer: "Sectigo Limited",
    validFrom: futureDate(-103),
    expiresAt: futureDate(262),
    serialNumber: "7D:3E:0B:65:14:92",
    fingerprint: "92:09:CC:45:7D:EA:1B:6F",
    algorithm: "RSA 2048",
    groupId: groupSeeds[0].id,
    groupName: groupSeeds[0].name,
    groupColor: groupSeeds[0].color,
    createdAt: futureDate(-98),
    hasPrivateKey: true,
  },
];

type MemoryState = {
  groups: Group[];
  certificates: StoredCertificate[];
  settings: NotificationSettings;
};

type StoredCertificate = Certificate & {
  certificatePem?: string;
  privateKeyEncrypted?: string;
};

const globalState = globalThis as typeof globalThis & {
  certOpsPool?: Pool;
  certOpsSchemaPromise?: Promise<void>;
  certOpsMemory?: MemoryState;
};

function memory() {
  globalState.certOpsMemory ??= {
    groups: structuredClone(groupSeeds),
    certificates: structuredClone(certificateSeeds),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
  return globalState.certOpsMemory;
}

function pool() {
  globalState.certOpsPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 900,
    idleTimeoutMillis: 10_000,
  });
  return globalState.certOpsPool;
}

async function ensureSchema(client: PoolClient) {
  if (!globalState.certOpsSchemaPromise) {
    globalState.certOpsSchemaPromise = (async () => {
      const sql = await readFile(path.join(process.cwd(), "db/schema.sql"), "utf8");
      await client.query(sql);
      const existingGroups = await client.query(`SELECT COUNT(*)::int AS count FROM cert_ops.groups`);
      if (Number(existingGroups.rows[0]?.count || 0) === 0) {
        for (const group of groupSeeds) {
          await client.query(
            `INSERT INTO cert_ops.groups (id, name, color) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
            [group.id, group.name, group.color],
          );
        }
      }
    })().catch((error) => {
      globalState.certOpsSchemaPromise = undefined;
      throw error;
    });
  }
  await globalState.certOpsSchemaPromise;
}

async function database<T>(work: (client: PoolClient) => Promise<T>): Promise<T | null> {
  if (!process.env.DATABASE_URL) return null;
  let client: PoolClient | undefined;
  try {
    client = await pool().connect();
    await ensureSchema(client);
    return await work(client);
  } catch (error) {
    console.warn("[CertOps] PostgreSQL unavailable, using demo storage:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    client?.release();
  }
}

// ACME must never fall back to demo storage: DNS changes need durable tracking.
export async function withPostgres<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_REQUIRED");
  const client = await pool().connect();
  let discard = false;
  try {
    await ensureSchema(client);
    return await work(client);
  } catch (error) {
    discard = true;
    throw error;
  } finally {
    client.release(discard);
  }
}

function mapCertificate(row: Record<string, unknown>): Certificate {
  return {
    id: String(row.id),
    name: String(row.name),
    primaryDomain: String(row.primary_domain),
    domains: Array.isArray(row.domains) ? row.domains.map(String) : [],
    issuer: String(row.issuer),
    validFrom: new Date(String(row.valid_from)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    serialNumber: String(row.serial_number),
    fingerprint: String(row.fingerprint),
    algorithm: String(row.algorithm),
    groupId: String(row.group_id),
    groupName: String(row.group_name || "未分组"),
    groupColor: String(row.group_color || "#94A3B8"),
    createdAt: new Date(String(row.created_at)).toISOString(),
    hasPrivateKey: Boolean(row.has_private_key),
  };
}

function publicCertificate(certificate: StoredCertificate): Certificate {
  return {
    id: certificate.id,
    name: certificate.name,
    primaryDomain: certificate.primaryDomain,
    domains: certificate.domains,
    issuer: certificate.issuer,
    validFrom: certificate.validFrom,
    expiresAt: certificate.expiresAt,
    serialNumber: certificate.serialNumber,
    fingerprint: certificate.fingerprint,
    algorithm: certificate.algorithm,
    groupId: certificate.groupId,
    groupName: certificate.groupName,
    groupColor: certificate.groupColor,
    createdAt: certificate.createdAt,
    hasPrivateKey: certificate.hasPrivateKey,
  };
}

export async function listCertificates(): Promise<{ data: Certificate[]; storage: StorageMode }> {
  const rows = await database(async (client) => {
    const result = await client.query(`
      SELECT c.*, g.name AS group_name, g.color AS group_color,
             (c.private_key_encrypted IS NOT NULL) AS has_private_key
      FROM cert_ops.certificates c
      JOIN cert_ops.groups g ON g.id = c.group_id
      ORDER BY c.expires_at ASC
    `);
    return result.rows.map(mapCertificate);
  });
  return rows ? { data: rows, storage: "postgresql" } : { data: memory().certificates.map(publicCertificate), storage: "demo" };
}

export async function listGroups(): Promise<{ data: Group[]; storage: StorageMode }> {
  const rows = await database(async (client) => {
    const result = await client.query(`
      SELECT g.id, g.name, g.color, COUNT(c.id)::int AS count
      FROM cert_ops.groups g LEFT JOIN cert_ops.certificates c ON c.group_id = g.id
      GROUP BY g.id ORDER BY g.created_at ASC
    `);
    return result.rows.map((row) => ({ id: row.id, name: row.name, color: row.color, count: row.count }));
  });
  if (rows) return { data: rows, storage: "postgresql" };
  const state = memory();
  return {
    data: state.groups.map((group) => ({ ...group, count: state.certificates.filter((cert) => cert.groupId === group.id).length })),
    storage: "demo",
  };
}

export async function createGroup(name: string) {
  const colors = ["#5B6CFF", "#12B886", "#F59F00", "#E8598B", "#15AABF"];
  const group = { id: randomUUID(), name, color: colors[Math.floor(Math.random() * colors.length)] };
  const saved = await database(async (client) => {
    const result = await client.query(
      `INSERT INTO cert_ops.groups (id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color`,
      [group.id, group.name, group.color],
    );
    return result.rows[0] as Group;
  });
  if (saved) return saved;
  if (memory().groups.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("GROUP_NAME_EXISTS");
  }
  memory().groups.push(group);
  return group;
}

export async function updateGroup(id: string, name: string) {
  const saved = await database(async (client) => {
    const result = await client.query(
      `UPDATE cert_ops.groups SET name = $2 WHERE id = $1 RETURNING id, name, color`,
      [id, name],
    );
    return result.rows[0] ? result.rows[0] as Group : false;
  });
  if (saved === false) return null;
  if (saved) return saved;

  const state = memory();
  const group = state.groups.find((item) => item.id === id);
  if (!group) return null;
  if (state.groups.some((item) => item.id !== id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("GROUP_NAME_EXISTS");
  }
  group.name = name;
  state.certificates.forEach((certificate) => {
    if (certificate.groupId === id) certificate.groupName = name;
  });
  return { ...group };
}

export type DeleteGroupResult = "deleted" | "not_found" | "not_empty";

export async function deleteGroup(id: string): Promise<DeleteGroupResult> {
  const result = await database(async (client) => {
    const deleted = await client.query(
      `DELETE FROM cert_ops.groups AS g
       WHERE g.id = $1
         AND NOT EXISTS (SELECT 1 FROM cert_ops.certificates AS c WHERE c.group_id = g.id)
       RETURNING g.id`,
      [id],
    );
    if (deleted.rowCount === 1) return "deleted" as const;
    const status = await client.query(
      `SELECT EXISTS (SELECT 1 FROM cert_ops.groups WHERE id = $1) AS found,
              EXISTS (SELECT 1 FROM cert_ops.certificates WHERE group_id = $1) AS has_certificates`,
      [id],
    );
    if (!status.rows[0]?.found) return "not_found" as const;
    return status.rows[0]?.has_certificates ? "not_empty" as const : "not_found" as const;
  });
  if (result) return result;

  const state = memory();
  const index = state.groups.findIndex((item) => item.id === id);
  if (index < 0) return "not_found";
  if (state.certificates.some((certificate) => certificate.groupId === id)) return "not_empty";
  state.groups.splice(index, 1);
  return "deleted";
}

export type NewCertificate = Omit<Certificate, "id" | "createdAt" | "groupName" | "groupColor" | "hasPrivateKey"> & {
  certificatePem: string;
  privateKeyEncrypted: string;
};

export async function createCertificate(input: NewCertificate) {
  const id = randomUUID();
  const saved = await database(async (client) => {
    const result = await client.query(
      `INSERT INTO cert_ops.certificates
       (id, name, primary_domain, domains, issuer, valid_from, expires_at, serial_number, fingerprint, algorithm, group_id, certificate_pem, private_key_encrypted)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [id, input.name, input.primaryDomain, JSON.stringify(input.domains), input.issuer, input.validFrom, input.expiresAt,
        input.serialNumber, input.fingerprint, input.algorithm, input.groupId, input.certificatePem, input.privateKeyEncrypted || null],
    );
    const group = await client.query(`SELECT name, color FROM cert_ops.groups WHERE id = $1`, [input.groupId]);
    return mapCertificate({ ...result.rows[0], group_name: group.rows[0]?.name, group_color: group.rows[0]?.color,
      has_private_key: Boolean(input.privateKeyEncrypted) });
  });
  if (saved) return { data: saved, storage: "postgresql" as StorageMode };
  const group = memory().groups.find((item) => item.id === input.groupId) || memory().groups[0];
  const certificate: StoredCertificate = { ...input, id, createdAt: new Date().toISOString(), groupId: group.id,
    groupName: group.name, groupColor: group.color, hasPrivateKey: Boolean(input.privateKeyEncrypted) };
  memory().certificates.unshift(certificate);
  return { data: publicCertificate(certificate), storage: "demo" as StorageMode };
}

export async function getCertificateContents(id: string) {
  const saved = await database(async (client) => {
    const result = await client.query(
      `SELECT name, primary_domain, certificate_pem, private_key_encrypted
       FROM cert_ops.certificates WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) return null;
    return {
      name: String(result.rows[0].name),
      primaryDomain: String(result.rows[0].primary_domain),
      certificatePem: String(result.rows[0].certificate_pem || ""),
      privateKey: decryptSecret(String(result.rows[0].private_key_encrypted || "")),
    };
  });
  if (saved) return saved;

  const certificate = memory().certificates.find((item) => item.id === id);
  if (!certificate) return null;
  return {
    name: certificate.name,
    primaryDomain: certificate.primaryDomain,
    certificatePem: certificate.certificatePem || "",
    privateKey: decryptSecret(certificate.privateKeyEncrypted || ""),
  };
}

export async function updateCertificate(id: string, name: string, groupId: string) {
  const saved = await database(async (client) => {
    const result = await client.query(
      `UPDATE cert_ops.certificates AS c
       SET name = $2, group_id = $3
       FROM cert_ops.groups AS g
       WHERE c.id = $1 AND g.id = $3
       RETURNING c.*, g.name AS group_name, g.color AS group_color,
                 (c.private_key_encrypted IS NOT NULL) AS has_private_key`,
      [id, name, groupId],
    );
    return result.rows[0] ? mapCertificate(result.rows[0]) : false;
  });
  if (saved === false) return null;
  if (saved) return { data: saved, storage: "postgresql" as StorageMode };

  const state = memory();
  const certificate = state.certificates.find((item) => item.id === id);
  const group = state.groups.find((item) => item.id === groupId);
  if (!certificate || !group) return null;
  certificate.name = name;
  certificate.groupId = group.id;
  certificate.groupName = group.name;
  certificate.groupColor = group.color;
  return { data: publicCertificate(certificate), storage: "demo" as StorageMode };
}

export async function deleteCertificate(id: string) {
  const deleted = await database(async (client) => {
    const result = await client.query(`DELETE FROM cert_ops.certificates WHERE id = $1 RETURNING id`, [id]);
    return result.rowCount === 1;
  });
  if (deleted !== null) return deleted;
  const index = memory().certificates.findIndex((item) => item.id === id);
  if (index < 0) return false;
  memory().certificates.splice(index, 1);
  return true;
}

export async function getNotificationSettings() {
  const settings = await database(async (client) => {
    const result = await client.query(`SELECT config_encrypted FROM cert_ops.notification_settings WHERE id = 1`);
    if (!result.rows[0]) return structuredClone(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...JSON.parse(decryptSecret(result.rows[0].config_encrypted)) } as NotificationSettings;
  });
  return settings || memory().settings;
}

export async function saveNotificationSettings(settings: NotificationSettings) {
  const saved = await database(async (client) => {
    await client.query(
      `INSERT INTO cert_ops.notification_settings (id, config_encrypted, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET config_encrypted = EXCLUDED.config_encrypted, updated_at = NOW()`,
      [encryptSecret(JSON.stringify(settings))],
    );
    return true;
  });
  if (!saved) memory().settings = settings;
  return settings;
}

// Reminder delivery must never fall back to demo data when PostgreSQL is unavailable.
export async function withReminderStore<T>(work: (store: ReminderStore) => Promise<T>): Promise<T | null> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for reminders");
  const client = await pool().connect();
  let locked = false;
  let discard = false;
  try {
    // A session lock covers both automatic and manual checks across all replicas.
    const lock = await client.query("SELECT pg_try_advisory_lock(194827, 1) AS locked");
    locked = Boolean(lock.rows[0].locked);
    if (!locked) return null;
    await ensureSchema(client);
    return await work({
      async settings() {
        const result = await client.query("SELECT config_encrypted FROM cert_ops.notification_settings WHERE id = 1");
        return result.rows[0]
          ? { ...DEFAULT_SETTINGS, ...JSON.parse(decryptSecret(result.rows[0].config_encrypted)) }
          : structuredClone(DEFAULT_SETTINGS);
      },
      async certificates() {
        const result = await client.query("SELECT * FROM cert_ops.certificates WHERE expires_at > NOW() AND expires_at <= NOW() + INTERVAL '15 days' ORDER BY expires_at");
        return result.rows.map(mapCertificate);
      },
      async wasSent(id, days, channel) {
        const result = await client.query("SELECT 1 FROM cert_ops.notification_logs WHERE certificate_id = $1 AND reminder_days = $2 AND channel = $3 AND success = TRUE LIMIT 1", [id, days, channel]);
        return result.rows.length > 0;
      },
      async record(id, days, result) {
        await client.query(`INSERT INTO cert_ops.notification_logs (id, certificate_id, reminder_days, channel, success, detail)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (certificate_id, reminder_days, channel, sent_on)
          DO UPDATE SET success = EXCLUDED.success, detail = EXCLUDED.detail, created_at = NOW()`,
        [randomUUID(), id, days, result.channel, result.success, result.success ? "已发送" : "发送失败，下一轮检查重试；请检查渠道配置及网络"]);
      },
    });
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(194827, 1)"); }
      catch { discard = true; }
    }
    client.release(discard);
  }
}
