CREATE TABLE IF NOT EXISTS cert_ops.acme_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config_encrypted TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cert_ops.acme_accounts (
  environment TEXT PRIMARY KEY CHECK (environment IN ('staging', 'production')),
  key_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cert_ops.acme_orders (
  id UUID PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  group_id UUID REFERENCES cert_ops.groups(id) ON DELETE SET NULL,
  domains JSONB NOT NULL,
  zone VARCHAR(253) NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('staging', 'production')),
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  certificate_id UUID UNIQUE REFERENCES cert_ops.certificates(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'issued', 'failed')),
  stage TEXT NOT NULL DEFAULT 'queued',
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS acme_orders_schedule_idx ON cert_ops.acme_orders(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS acme_orders_pending_idx ON cert_ops.acme_orders(created_at DESC, id DESC) WHERE certificate_id IS NULL;
CREATE TABLE IF NOT EXISTS cert_ops.aliyun_credentials (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  config_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES cert_ops.aliyun_credentials(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS acme_orders_credential_idx ON cert_ops.acme_orders(credential_id);
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS dns_provider TEXT NOT NULL DEFAULT 'aliyun' CHECK (dns_provider IN ('aliyun','manual'));
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS manual_state_encrypted TEXT;
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS manual_records JSONB NOT NULL DEFAULT '[]';
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS manual_expires_at TIMESTAMPTZ;
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS dns_checked_at TIMESTAMPTZ;
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS manual_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS manual_prepared BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cert_ops.acme_orders DROP CONSTRAINT IF EXISTS acme_orders_status_check;
ALTER TABLE cert_ops.acme_orders ADD CONSTRAINT acme_orders_status_check CHECK (status IN ('queued','running','issued','failed','waiting_dns','dns_ready'));
ALTER TABLE cert_ops.acme_orders ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
-- Independent of orders so deleting a certificate cannot orphan challenge cleanup.
CREATE TABLE IF NOT EXISTS cert_ops.acme_dns_records (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  zone TEXT NOT NULL,
  rr TEXT NOT NULL,
  value TEXT NOT NULL,
  record_id TEXT,
  credentials_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
