# K2 — Append-only audit events evidence

Status: DONE
Canonical Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)

## Scope

K2 establishes one server-owned append-only operational audit resource for later KYC, credential, admin and sensitive financial operations. It does not automatically audit every PostgreSQL mutation and it does not introduce an external log/SIEM pipeline.

Canonical specification:

- `docs/specs/audit-events-v0.yaml`

Canonical migrations:

- `20260815021956_audit_events_foundation.sql`
- `20260815022800_audit_events_behavior.sql`

Canonical tests:

- `024_audit_events_schema.test.sql`
- `025_audit_events_behavior.test.sql`

## TDD evidence

### Structural RED

Commit: `5659f5e16988d45c42a7ebb4a27bc09e402a8159`
GitHub Actions run: `102` (`31858813322`)

Result:

- previous suites `001–023`: green;
- `024_audit_events_schema.test.sql`: 40/40 assertions failed exclusively because the K2 table/function/trigger did not exist;
- aggregate: 24 files / 818 tests / FAIL.

### Structural GREEN

Foundation commit: `3d3fe7296d9a141eec8a8ba714ec76c4201e6ae9`
GitHub Actions run: `103` (`31858922894`)

Result:

- 24 files / 818 tests / PASS.

The foundation deliberately left `record_audit_event(...)` and the append-only rejection function fail-closed until behavioral tests existed.

### Behavioral RED

Commit: `81fa19d3e66690147e0493e4619301a4966d6038`
GitHub Actions run: `104` (`31859091997`)

Result:

- previous suites `001–024`: green;
- `025_audit_events_behavior.test.sql`: 38 assertions executed, 26 failed;
- failures were the expected `0A000` foundation stubs or assertions dependent on those stubs;
- aggregate: 25 files / 856 tests / FAIL.

### Behavioral GREEN

Implementation commit: `18e571ac46986aff41784bda338a0285b9ea58fb`
GitHub Actions run: `105` (`31859297198`)
Job: `94949657409`

Exact result:

```text
All tests successful.
Files=25, Tests=856
Result: PASS
```

The GREEN behavior proves:

- valid merchant-scoped and platform-scoped events;
- server-generated durable IDs;
- exact retry returns the original ID and does not duplicate history;
- changed fingerprint or any changed immutable event input under the same logical source identity fails with `23505`;
- invalid vocabulary, required fields, optional blank text, metadata shape and occurrence/version inputs fail closed;
- supplied merchant scope is protected by the canonical merchant foreign key;
- UPDATE and DELETE are rejected with append-only semantics;
- Data API/service roles cannot execute the recorder or mutate audit storage;
- audit recording has no Payment, payout/refund, ledger, job or merchant-webhook side effects.

## Managed Supabase deployment evidence

The two K2 migrations were applied to the canonical managed project and the remote migration history was normalized to the repository versions:

```text
20260815021956 audit_events_foundation
20260815022800 audit_events_behavior
```

Remote history contains 25 canonical migrations through `20260815022800`.

A transaction-scoped remote proof exercised the deployed implementation and then rolled back all fixtures. Observed results:

```text
exact_replay_same_id = true
row_count = 1
changed replay SQLSTATE = 23505
UPDATE SQLSTATE = 23514
DELETE SQLSTATE = 23514
anon execute denied = true
authenticated execute denied = true
service_role execute denied = true
```

Post-rollback verification:

```text
verification_merchants = 0
verification_audit_events = 0
total_audit_events = 0
```

No verification fixture or audit row was left in the managed database.

Supabase Security Advisor after K2: **0 security lints**.

## Security and design boundary

- `app.audit_events` remains in the private server-owned `app` schema.
- `PUBLIC`, `anon`, `authenticated` and `service_role` receive no direct K2 access.
- `record_audit_event(...)` is not `SECURITY DEFINER`; later K4 trusted-role work will define positive backend execution privileges explicitly.
- The generic audit layer intentionally does not copy request/response bodies, KYC document bytes, provider payloads or secrets.
- Generic infrastructure does not attempt regex-based secret detection. Each calling module must define purpose-specific safe metadata and test its own redaction/allowlist rules.
- Audit correction is a new event; historical events are never rewritten.
