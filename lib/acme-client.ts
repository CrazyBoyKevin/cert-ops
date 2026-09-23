import * as acme from "acme-client";
import type { PoolClient } from "pg";
import { decryptSecret, encryptSecret } from "./crypto-store.ts";
import { AcmeError } from "./acme-validation.ts";
import type { AcmeEnvironment, AcmeSettings } from "./acme-types";

// Call only while holding the issuance advisory lock (194827,2).
export async function acmeClient(db: PoolClient, environment: AcmeEnvironment) {
  let account = (await db.query("SELECT key_encrypted FROM cert_ops.acme_accounts WHERE environment=$1", [environment])).rows[0];
  if (!account) {
    account = { key_encrypted: encryptSecret((await acme.crypto.createPrivateKey()).toString()) };
    await db.query("INSERT INTO cert_ops.acme_accounts(environment,key_encrypted) VALUES($1,$2)", [environment, account.key_encrypted]);
  }
  const accountKey = decryptSecret(account.key_encrypted);
  if (!accountKey) throw new AcmeError("ENCRYPTION_REQUIRED");
  acme.axios.defaults.timeout = 30_000;
  return new acme.Client({ directoryUrl: acme.directory.letsencrypt[environment], accountKey,
    backoffAttempts: 15, backoffMin: 3000, backoffMax: 10_000 });
}

export async function configureAcmeAccount(client: acme.Client, config: AcmeSettings) {
  const contact = [`mailto:${config.email}`];
  const account = await client.createAccount({ termsOfServiceAgreed: config.termsAgreed, contact });
  if (JSON.stringify(account.contact) !== JSON.stringify(contact)) await client.updateAccount({ contact });
}
