CREATE TABLE IF NOT EXISTS cert_ops.private_authorities (
  id UUID PRIMARY KEY,
  subject JSONB NOT NULL,
  certificate_pem TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cert_ops.private_services (
  certificate_id UUID PRIMARY KEY REFERENCES cert_ops.certificates(id) ON DELETE CASCADE,
  authority_id UUID NOT NULL REFERENCES cert_ops.private_authorities(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS cert_ops.private_versions (
  id UUID PRIMARY KEY,
  certificate_id UUID NOT NULL REFERENCES cert_ops.private_services(certificate_id) ON DELETE CASCADE,
  certificate_pem TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS private_versions_certificate_idx ON cert_ops.private_versions(certificate_id, created_at DESC);
UPDATE cert_ops.certificates c SET private_authority_id=s.authority_id
FROM cert_ops.private_services s WHERE c.id=s.certificate_id AND c.private_authority_id IS DISTINCT FROM s.authority_id;
