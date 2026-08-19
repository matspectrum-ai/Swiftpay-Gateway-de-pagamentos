# A20 — Runtime Capability Manifest & Exact Attestation — Contract V0

Status: **FROZEN FOR TDD**  
Date: 2026-08-19

The authoritative behavioral specification is `docs/specs/runtime-capability-manifest-attestation-v0.yaml`.

## 1. Scope

A20 adds a deterministic least-privilege **attestation** boundary. It does not alter PostgreSQL privileges.

The repository must become able to answer exactly: “Which `app` RPC signatures may the API capability role execute, and which may the worker capability role execute?” without relying on aggregate counts, PostgreSQL OIDs or chat/history context.

## 2. Canonical manifest

A20 MUST add:

`ops/security/runtime-capabilities-v0.json`

Required shape:

```ts
interface RuntimeCapabilityManifestV0 {
  readonly schemaVersion: 'swiftpay-runtime-capabilities-v0';
  readonly canonicalSchema: 'app';
  readonly roles: {
    readonly swiftpay_api: {
      readonly expectedCount: 24;
      readonly signatures: readonly string[];
    };
    readonly swiftpay_worker: {
      readonly expectedCount: 6;
      readonly signatures: readonly string[];
    };
  };
}
```

Each signature is canonical PostgreSQL `regprocedure` text, e.g.:

```text
app.consume_api_abuse_quota(text,text,text)
```

The arrays MUST be lexically sorted and duplicate-free.

OIDs and `information_schema.specific_name` values are forbidden manifest identifiers.

The exact signatures are frozen by the YAML specification.

## 3. Local database attestation

A20 MUST add:

`supabase/tests/runtime/002_exact_runtime_capability_allowlist.test.sql`

The test MUST execute after normal migrations and `scripts/provision-local-runtime-identities`, through the existing Database contracts `runtime-topology` job.

For each capability role it MUST derive the effective granted `app` EXECUTE set as schema-qualified type signatures and assert **exact sorted-array equality** with the frozen manifest set.

A count assertion alone is insufficient.

The test MUST fail for a one-for-one substitution such as:

```text
revoke expected_rpc from swiftpay_api;
grant unexpected_rpc to swiftpay_api;
```

even if the total remains 24.

## 4. Structural least-privilege invariants

The A20 attestation MUST preserve/re-prove:

- `swiftpay_api` and `swiftpay_worker` have `USAGE` but not `CREATE` on schema `app`;
- API/worker runtime LOGIN roles have no superuser/createdb/createrole/replication/bypass-RLS attributes;
- `swiftpay_api_runtime` inherits exactly `swiftpay_api`;
- `swiftpay_worker_runtime` inherits exactly `swiftpay_worker`;
- API/worker runtime identities have zero direct `app` relation/sequence ACL entries;
- `anon`, `authenticated`, `service_role` and `PUBLIC` have no executable `app` routine authority;
- Data API roles have no `app` table privileges;
- every routine in either exact runtime allowlist is `SECURITY DEFINER`;
- every such routine carries an explicit `search_path` configuration that excludes `public`, `pg_temp` and `$user`.

The contract permits historically required trusted search paths such as an empty path, `pg_catalog, app`, or `pg_catalog, app, auth`; A20 does not normalize them.

## 5. Hosted attestation

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

After local GREEN, A20 MUST perform a read-only hosted postflight proving:

- exact API signature set equals manifest;
- exact worker signature set equals manifest;
- structural invariants above still hold;
- Supabase Security Advisor reports zero security lints.

No hosted DDL, GRANT, REVOKE or migration is authorized by A20 when the hosted state already conforms.

If hosted attestation finds a mismatch, A20 MUST stop and open a separately specified remediation instead of mutating authority ad hoc.

## 6. Non-authority

A20 grants no authority to:

- add/remove a runtime RPC;
- change role membership;
- change schema/table privileges;
- modify Payment, ProviderAttempt, ledger, payout, refund, job or webhook state;
- call or activate a retained PSP;
- alter A10 provider activation.

## 7. TDD gate

Implementation authority remains **NONE** until fail-first tests prove that the manifest and exact-attestation artifact are missing on the current A19 head.

RED MUST preserve all existing product/database behavior while failing only for the missing A20 guardrail.
