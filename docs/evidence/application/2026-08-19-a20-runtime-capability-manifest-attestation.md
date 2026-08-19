# A20 — Runtime Capability Manifest & Exact Attestation — Final Evidence

Date: 2026-08-19
Branch: `agent/foundation-phase-0`

## Accepted boundary

A20 closes a verification gap in the trusted runtime database boundary. Prior K4/K6 and feature contracts proved role separation, zero direct protected-table DML and critical positive/negative RPC capabilities, while later slices also checked aggregate API/worker EXECUTE counts. Counts alone cannot prove nominal identity: an allowed RPC could theoretically be removed while an unintended RPC is granted, leaving the same count.

A20 therefore introduces no new database/runtime authority. It freezes and attests the exact executable `app` routine set for the two trusted capability roles.

Canonical manifest:

- `ops/security/runtime-capabilities-v0.json`
- `swiftpay_api`: exactly 24 canonical `regprocedure` signatures
- `swiftpay_worker`: exactly 6 canonical `regprocedure` signatures

Runtime attestation:

- `supabase/tests/runtime/002_exact_runtime_capability_allowlist.test.sql`
- compares the complete effective EXECUTE set by canonical `regprocedure` signature rather than count alone;
- asserts no missing or extra capability;
- preserves exact runtime-role inheritance;
- preserves app schema `USAGE` with no `CREATE`;
- preserves zero direct/effective app table/sequence authority;
- preserves zero app EXECUTE authority for `anon`, `authenticated` and `service_role`;
- requires every authorized runtime capability to remain `SECURITY DEFINER` with an explicit `search_path` configuration.

No migration, GRANT, REVOKE, provider bridge, application route or financial mutation was introduced.

## TDD RED

RED head: `2a952acb1a74615cf796215a32c2adb15cf4168a`.

Application workflow `32217764269` established a clean fail-first state:

- 362 total application contracts;
- 359 PASS;
- 3 A20 FAIL;
- all A1-A19 contracts remained GREEN;
- every failure was exactly an `ENOENT` for one of the deliberately absent A20 attestation artifacts.

Implementation had not yet created either the canonical manifest or the runtime pgTAP at that RED point.

## GREEN implementation

Accepted implementation head: `b9188cf7954af70f464fbab50f5776c1ee5e9269`.

Application workflow `32217961040`:

- typecheck GREEN;
- build GREEN;
- **362/362 application contracts PASS**;
- A20: 4/4 PASS;
- real PostgreSQL runtime acceptance K7/A14/A18/A1/A2/A3/A4/A6/A7/A8/A9 all GREEN.

Database workflow `32217961050`:

- pgTAP database contracts GREEN;
- deterministic K5 fixture acceptance GREEN;
- K6/A20 runtime topology GREEN, including the exact nominal capability attestation through `supabase/tests/runtime`;
- production-like API and worker runtime identity connection probes GREEN.

## Hosted canonical Supabase attestation

Project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

Read-only hosted attestation using canonical `regprocedure` signatures returned:

- missing authorized capabilities: **0**;
- extra authorized capabilities: **0**;
- `swiftpay_api` EXECUTE count: **24**;
- `swiftpay_worker` EXECUTE count: **6**;
- authorized capabilities lacking `SECURITY DEFINER`: **0**;
- authorized capabilities lacking explicit `search_path` configuration: **0**;
- direct `app` table privileges for `swiftpay_api`: **0**;
- direct `app` table privileges for `swiftpay_worker`: **0**;
- `anon` / `authenticated` / `service_role` effective `app` EXECUTE capabilities: **0**;
- hosted Payment rows: **0**;
- hosted ProviderAttempt rows: **0**.

Supabase Security Advisor during A20 audit: **0 lints**.

## Result

A20 is **DONE / GREEN / HOSTED-ATTESTED / NO AUTHORITY CHANGE**.

The trusted runtime database surface is now versioned by exact nominal capability identity, not merely aggregate counts. Any future missing, extra or substituted API/worker RPC will fail the runtime topology CI even if the aggregate 24/6 counts remain unchanged.

A20 does not advance retained-provider contract authority, does not call a PSP and does not change conservative V1 readiness estimates.
