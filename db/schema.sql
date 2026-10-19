CREATE SCHEMA IF NOT EXISTS cert_ops;

CREATE TABLE IF NOT EXISTS cert_ops.groups (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  color VARCHAR(16) NOT NULL DEFAULT '#5B6CFF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cert_ops.certificates (
  id UUID PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  primary_domain VARCHAR(255) NOT NULL,
  domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  issuer VARCHAR(255) NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  serial_number TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  algorithm VARCHAR(80) NOT NULL,
  group_id UUID NOT NULL REFERENCES cert_ops.groups(id) ON DELETE RESTRICT,
  certificate_pem TEXT NOT NULL,
  private_key_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS certificates_expires_at_idx ON cert_ops.certificates(expires_at);
CREATE INDEX IF NOT EXISTS certificates_group_id_idx ON cert_ops.certificates(group_id);
ALTER TABLE cert_ops.certificates ADD COLUMN IF NOT EXISTS private_ca BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cert_ops.certificates ADD COLUMN IF NOT EXISTS private_authority_id UUID;

CREATE TABLE IF NOT EXISTS cert_ops.notification_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config_encrypted TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cert_ops.notification_logs (
  id UUID PRIMARY KEY,
  certificate_id UUID NOT NULL REFERENCES cert_ops.certificates(id) ON DELETE CASCADE,
  reminder_days SMALLINT NOT NULL,
  channel VARCHAR(20) NOT NULL,
  sent_on DATE NOT NULL DEFAULT CURRENT_DATE,
  success BOOLEAN NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(certificate_id, reminder_days, channel, sent_on)
);
