import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { decryptSecret, encryptSecret } from "./crypto-store.ts";
import { AcmeError, validateId } from "./acme-validation.ts";
import type { AliyunCredential, PublicAliyunCredential } from "./acme-types";

function decryptCredentials(value: string): Pick<AliyunCredential, "accessKeyId" | "accessKeySecret"> {
  const plaintext = decryptSecret(value);
  if (!plaintext) throw new AcmeError("ENCRYPTION_REQUIRED");
  const parsed = JSON.parse(plaintext);
  if (typeof parsed.accessKeyId !== "string" || !parsed.accessKeyId || typeof parsed.accessKeySecret !== "string" || !parsed.accessKeySecret) {
    throw new AcmeError("CREDENTIAL_REQUIRED");
  }
  return { accessKeyId: parsed.accessKeyId, accessKeySecret: parsed.accessKeySecret };
}

export function publicCredential(credential: AliyunCredential, orderCount = 0): PublicAliyunCredential {
  return { id: credential.id, name: credential.name, accessKeyHint: `••••${credential.accessKeyId.slice(-4)}`, orderCount };
}

// Called inside the schema transaction, protected by the migration advisory lock.
// Removing the legacy pair makes this migration idempotent, even after credentials are deleted.
export async function migrateLegacyCredentials(db: PoolClient) {
  const result = await db.query("SELECT config_encrypted FROM cert_ops.acme_settings WHERE id=1 FOR UPDATE");
  if (!result.rowCount) return;
  const plaintext = decryptSecret(result.rows[0].config_encrypted);
  if (!plaintext) throw new AcmeError("ENCRYPTION_REQUIRED");
  const config = JSON.parse(plaintext);
  if (!config.accessKeyId || !config.accessKeySecret) return;
  const id = randomUUID();
  const keys = { accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret };
  await db.query("INSERT INTO cert_ops.aliyun_credentials(id,name,config_encrypted) VALUES($1,$2,$3)",
    [id, "Aliyun (migrated)", encryptSecret(JSON.stringify(keys))]);
  await db.query("UPDATE cert_ops.acme_orders SET credential_id=$1 WHERE credential_id IS NULL AND dns_provider='aliyun'", [id]);
  await db.query("UPDATE cert_ops.acme_settings SET config_encrypted=$1, updated_at=NOW() WHERE id=1",
    [encryptSecret(JSON.stringify({ email: config.email, termsAgreed: config.termsAgreed }))]);
}

export async function readAliyunCredential(db: PoolClient, id: string | null, lock = false): Promise<AliyunCredential> {
  if (!id) throw new AcmeError("CREDENTIAL_REQUIRED");
  validateId(id);
  const result = await db.query(`SELECT * FROM cert_ops.aliyun_credentials WHERE id=$1${lock ? " FOR KEY SHARE" : ""}`, [id]);
  if (!result.rowCount) throw new AcmeError("CREDENTIAL_NOT_FOUND");
  const row = result.rows[0];
  return { id: row.id, name: row.name, ...decryptCredentials(row.config_encrypted) };
}

export async function listAliyunCredentials(db: PoolClient): Promise<PublicAliyunCredential[]> {
  const result = await db.query(`SELECT a.*, (SELECT COUNT(*)::int FROM cert_ops.acme_orders o WHERE o.credential_id=a.id) AS order_count
    FROM cert_ops.aliyun_credentials a ORDER BY a.created_at, a.id`);
  return result.rows.map((row) => publicCredential({ id: row.id, name: row.name, ...decryptCredentials(row.config_encrypted) }, row.order_count));
}

export function validateCredentialInput(input: Record<string, unknown>, creating: boolean) {
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100) throw new AcmeError("CREDENTIAL_NAME_REQUIRED");
  const accessKeyId = input.accessKeyId ?? "", accessKeySecret = input.accessKeySecret ?? "";
  if (typeof accessKeyId !== "string" || typeof accessKeySecret !== "string" || accessKeyId.length > 256 || accessKeySecret.length > 256) throw new AcmeError("INVALID_REQUEST");
  const keys = { accessKeyId: accessKeyId.trim(), accessKeySecret: accessKeySecret.trim() };
  if (Boolean(keys.accessKeyId) !== Boolean(keys.accessKeySecret) || (creating && !keys.accessKeyId)) throw new AcmeError("CREDENTIAL_PAIR_REQUIRED");
  return { name: input.name.trim(), ...keys };
}

export async function saveAliyunCredential(db: PoolClient, input: Record<string, unknown>, id?: string) {
  const values = validateCredentialInput(input, !id);
  if (id) validateId(id);
  await db.query("BEGIN");
  try {
    // Rotation cannot race an active issuance that is still using the old key.
    if (id && values.accessKeyId) {
      const lock = await db.query("SELECT pg_try_advisory_xact_lock(194827,2) AS locked");
      if (!lock.rows[0].locked) throw new AcmeError("CREDENTIAL_BUSY");
      const pending = await db.query(`SELECT 1 FROM cert_ops.acme_dns_records d JOIN cert_ops.acme_orders o ON o.id=d.order_id
        WHERE o.credential_id=$1 LIMIT 1`, [id]);
      if (pending.rowCount) throw new AcmeError("CREDENTIAL_BUSY");
    }
    if (id) {
      const previous = await db.query("SELECT id FROM cert_ops.aliyun_credentials WHERE id=$1 FOR UPDATE", [id]);
      if (!previous.rowCount) throw new AcmeError("CREDENTIAL_NOT_FOUND");
      if (values.accessKeyId) {
        await db.query("UPDATE cert_ops.aliyun_credentials SET name=$2, config_encrypted=$3, updated_at=NOW() WHERE id=$1",
          [id, values.name, encryptSecret(JSON.stringify({ accessKeyId: values.accessKeyId, accessKeySecret: values.accessKeySecret }))]);
      } else await db.query("UPDATE cert_ops.aliyun_credentials SET name=$2, updated_at=NOW() WHERE id=$1", [id, values.name]);
    } else {
      id = randomUUID();
      await db.query("INSERT INTO cert_ops.aliyun_credentials(id,name,config_encrypted) VALUES($1,$2,$3)",
        [id, values.name, encryptSecret(JSON.stringify({ accessKeyId: values.accessKeyId, accessKeySecret: values.accessKeySecret }))]);
    }
    await db.query("COMMIT");
    return { id };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

export async function removeAliyunCredential(db: PoolClient, id: string) {
  validateId(id);
  await db.query("BEGIN");
  try {
    const row = await db.query("SELECT id FROM cert_ops.aliyun_credentials WHERE id=$1 FOR UPDATE", [id]);
    if (!row.rowCount) throw new AcmeError("CREDENTIAL_NOT_FOUND");
    const used = await db.query("SELECT id FROM cert_ops.acme_orders WHERE credential_id=$1 LIMIT 1", [id]);
    if (used.rowCount) throw new AcmeError("CREDENTIAL_IN_USE");
    await db.query("DELETE FROM cert_ops.aliyun_credentials WHERE id=$1", [id]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    if ((error as { code?: string })?.code === "23503") throw new AcmeError("CREDENTIAL_IN_USE");
    throw error;
  }
}
