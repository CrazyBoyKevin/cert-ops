# CertOps native-crypto ACME client

This is a minimal local derivative of MIT-licensed `acme-client@5.4.0` from
https://github.com/publishlab/node-acme-client. It is not an upstream release.
`UPSTREAM.json` records the official npm tarball integrity and per-file SHA-256
hashes; the original MIT license is retained in `LICENSE`.

## Security change

The upstream package eagerly loads its deprecated `acme.forge` interface and
depends on `node-forge`. As of 2026-10-20, the latter has no released fix for
https://github.com/advisories/GHSA-86w9-cpqp-85rv.
CertOps only uses the native `acme.crypto` interface. This derivative:

- omits `src/crypto/forge.js` and removes the `node-forge` dependency;
- removes the `forge` export from `src/index.js` and its legacy TypeScript types;
- retains all ACME protocol, JWS, native crypto, retry and certificate code;
- uses version `5.4.0-certops.1`, marks the package private, and omits upstream
  development scripts/dependencies and type-test fixtures.

This removes the vulnerable implementation, not just its audit warning. Do not
restore `forge`, rename vulnerable packages to bypass audit, or downgrade the
protocol client to the unrelated version suggested by `npm audit fix --force`.

## Maintenance

Install through the root lockfile using `npm ci`. The Docker dependency and
runtime stages must copy `vendor/` before installation. Source archives used
with Apple Container must include `vendor/` as well.

Before upgrading, check upstream security advisories and compare the verified
upstream tarball against this copy. Prefer returning to a maintained official
release once it no longer requires the vulnerable dependency. For a local update,
record new provenance/hashes and review every code difference. Run the dependency
regression tests, local SMTP/ACME tests, production build and isolated database
integration tests. CI should continue running `npm audit --omit=dev`; the local
copy requires manual upstream advisory monitoring as well as registry audits.
