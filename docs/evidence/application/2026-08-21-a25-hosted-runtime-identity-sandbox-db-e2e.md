# A25 Evidence — Hosted Runtime Identity + Sandbox DB E2E

Date: 2026-08-21 (America/Santarem)
Canonical hosted project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
Scope: hosted PostgreSQL runtime identity bootstrap + transaction-scoped Sandbox database E2E only

## Formal RED

RED SHA: `c83690f41d2f1d7b5d4cce613905853c7fa8508c`

Application workflow `32544773993`:

- 397 application tests total;
- 395 PASS;
- exactly two intended failures:
  1. shared hosted-safe bootstrap SQL absent;
  2. local K6 provisioner not yet reusing shared bootstrap.
- runtime database acceptance remained GREEN.

This established the intended deployment-boundary absence without moving LOGIN creation into Supabase migration history.

## A25 implementation GREEN

Initial implementation head: `27814232144fa194ed2dbd006c6ce876927caaef`.

Application workflow `32544895450`:

- application contracts GREEN;
- runtime database acceptance GREEN.

Database workflow `32544895405`:

- pgTAP GREEN;
- runtime topology GREEN;
- K5 GREEN;
- K6 GREEN.

Implementation artifacts:

- `ops/sql/bootstrap-hosted-runtime-identities.sql`;
- `scripts/provision-local-runtime-identities` reuses the shared bootstrap;
- no runtime LOGIN creation was added to `supabase/migrations`;
- hosted bootstrap installs no password/credential;
- local K6 keeps only synthetic loopback credentials.

## Hosted runtime bootstrap attestation

The operational bootstrap was applied to the canonical hosted project outside migration history.

Observed hosted topology:

- `swiftpay_api_runtime`: LOGIN, safe attributes, member only of `swiftpay_api`;
- `swiftpay_worker_runtime`: LOGIN, safe attributes, member only of `swiftpay_worker`;
- API effective `app` EXECUTE capabilities: 30;
- worker effective `app` EXECUTE capabilities: 6;
- direct runtime `app` ACL entries: 0;
- Data API effective `app` EXECUTE: 0;
- hosted runtime credential installed by A25: no.

Pre-smoke business counts:

- PaymentLinks: 0;
- Payments: 0;
- ProviderAttempts: 0.

## A23 compatibility defects exposed by the real hosted runtime

The first positive hosted A25 smoke exposed two PostgreSQL compatibility defects in A23 rather than an A25 authority defect:

1. nonexistent `pg_catalog.jsonb_object_length(jsonb)`;
2. invalid `pg_catalog.coalesce(...)` qualification because `COALESCE` is a SQL special form.

These were repaired by A26 and A27 under independent RED→GREEN cycles before the A25 hosted E2E was rerun.

Hosted repair migrations applied:

- hosted version `20260822031801`, repository migration `20260822025900_a23_jsonb_object_arity_runtime_fix.sql`;
- hosted version `20260822031818`, repository migration `20260822030500_a23_coalesce_special_form_runtime_fix.sql`.

Post-repair hosted pre-smoke attestation:

- API capabilities: 30;
- worker capabilities: 6;
- Data API `app` EXECUTE: 0;
- invalid A23 compatibility references: 0;
- runtime memberships exact;
- PaymentLinks / Payments / ProviderAttempts: 0 / 0 / 0;
- retained PSP rows: 0.

## Positive hosted Sandbox DB E2E

The final hosted smoke executed in one PostgreSQL transaction and exercised application operations as the exact runtime LOGIN identity:

```text
current_user = swiftpay_api_runtime
```

Synthetic transaction-only fixture:

- two merchants;
- two Auth users with isolated merchant memberships;
- one `swiftpay_emulator` provider;
- one platform Sandbox emulator account with `create_pix_charge=true`;
- no retained PSP provider rows or credentials.

Flow proven:

1. authorized Sandbox Payment Link creation;
2. same-key/same-hash replay returns the same link;
3. Production creation returns `kind=forbidden`;
4. foreign-tenant administration is denied with SQLSTATE `42501`;
5. public Payment Link projection exposes only the expected six public fields;
6. checkout prepare returns `kind=prepared`;
7. same-key/same-hash prepare replays the same Payment/ProviderAttempt;
8. same-key/different-hash conflicts;
9. first provider-attempt claim wins with one execution token;
10. second claim loses;
11. exact six-key Sandbox success resolution succeeds;
12. Payment becomes `pending` with Pix projection populated;
13. completed replay returns the same Payment;
14. completed same-key/different-hash conflicts;
15. internal pre-rollback deltas are exactly one Payment Link, one Payment and one ProviderAttempt;
16. ledger/jobs/payouts/refunds remain unchanged;
17. no Production/paid state is produced;
18. no retained provider I/O occurs;
19. explicit `ROLLBACK` restores all business fixture state.

Financial/runtime invariants observed before rollback:

```text
Payment source                 payment_link
Payment environment            sandbox
Payment status                 pending
amount_cents                   1250
currency                       BRL
pricing_version                sandbox-zero-fee-v0
merchant_fee_cents             0
merchant_net_cents             1250
routing_policy_version         sandbox-emulator-v0
ProviderAttempt                succeeded
retained provider traffic      0
paid transition                0
ledger posting                 0
```

## Post-rollback attestation

All transaction-scoped business state returned to zero:

- fixture merchants: 0;
- fixture users: 0;
- fixture provider: 0;
- fixture provider account: 0;
- PaymentLinks: 0;
- Payments: 0;
- ProviderAttempts: 0;
- request idempotency records: 0;
- ledger transactions: 0;
- jobs: 0;
- payouts: 0;
- refunds: 0;
- retained provider rows: 0.

Authority remained unchanged:

- API capabilities: 30;
- worker capabilities: 6;
- Data API `app` EXECUTE: 0;
- invalid A23 compatibility references: 0;
- workload memberships exact.

## PostgreSQL 17 creator-admin semantics

Canonical hosted `postgres` is `NOSUPERUSER` + `CREATEROLE`.

PostgreSQL 17 automatically grants a role created by a non-superuser CREATEROLE role back to the creator with the effective relationship:

```text
ADMIN TRUE, SET FALSE, INHERIT FALSE
```

The observed creator-admin rows are therefore role-administration metadata, not inherited workload capability. A25's cleanup invariant is:

- temporary smoke `SET` authority rolls back;
- `pg_has_role('postgres','swiftpay_api_runtime','SET') = false` after rollback;
- inherited/USAGE authority remains false;
- any automatic creator-admin membership remains exactly equal to pre-smoke state.

No revocation of PostgreSQL's automatic creator-admin relationship is required by A25.

## A26/A27 integrated final CI

Integrated A25+A26+A27 head before final documentation: `ea1914bc9a9c50f2bcb1f67585350bef098555f9`.

Application workflow `32548379380`:

- application contracts GREEN;
- runtime database acceptance GREEN;
- K7/A14/A18/A1-A9 GREEN.

Database workflow `32548379307`:

- pgTAP GREEN;
- K5 GREEN;
- first K6 runtime-topology attempt failed before tests because the GitHub runner could not bind host port `54322` (`address already in use`).

The isolated runtime-topology job was rerun as job `96971120366` and completed GREEN:

- isolated Postgres startup GREEN;
- runtime identity provisioning GREEN;
- K6 structural contracts GREEN;
- API own-connection acceptance GREEN;
- worker own-connection acceptance GREEN.

This is classified as runner infrastructure, not a code failure.

Final database baseline after A26/A27:

- 48 pgTAP files;
- 1403 assertions PASS.

## Explicit non-claims

A25 proves the hosted PostgreSQL runtime identity and Sandbox database lifecycle. It does **not** prove:

- deployed Fastify HTTP routing;
- browser checkout against deployed compute;
- Vercel runtime configuration;
- server-side hosted runtime password injection;
- live retained PSP traffic;
- Production Pix activation.

Those remain later deployment/provider gates.
