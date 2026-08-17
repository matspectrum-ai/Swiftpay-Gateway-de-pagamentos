# SwiftPay V2 — A8 API Credential Management Evidence

Date: 2026-08-17
Status: **DONE / GREEN / HOSTED**

Problem Analysis: `docs/design/a8-api-credential-management-problem-analysis.md`

Frozen spec: `docs/specs/api-credential-management-v0.yaml`

This evidence closes A8. It adds merchant-facing API credential administration to the trusted dashboard realm without authorizing live PSP money movement and without changing the retained-provider production evidence gate.

## Accepted boundary

A8 adds dashboard-only machine credential administration while preserving A1 machine authentication and A6/K4 dashboard authorization as separate realms.

Accepted behavior includes:

- dashboard routes for list, get, create, rotate-secret and revoke;
- reads use the ordinary online-validated A6 dashboard session and current `member` authority;
- every mutation uses a distinct privileged dashboard verifier and requires an online-validated Supabase session whose already-validated JWT has matching `sub` and `aal=aal2`;
- AAL1 or missing `aal` maps to `step_up_required` before secret generation or database mutation;
- Sandbox mutation authority is current `admin` or `owner`; Production mutation authority is current `owner` only;
- no service-role, `sb_secret`, legacy JWT-secret, local-signature-only or A1 machine-auth fallback;
- `pk_sandbox_` / `pk_production_` public keys use 18 CSPRNG bytes encoded base64url without padding;
- `sk_sandbox_` / `sk_production_` Secret Keys use 32 CSPRNG bytes encoded base64url without padding;
- plaintext Secret Key exists only in trusted API memory and is returned only for the winning create/rotation response;
- PostgreSQL persists only the public key and the frozen A1 `scrypt-v1` verifier;
- completed create/rotation replay returns the durable public projection with `secretAvailable=false` and `secretKey=null`;
- exact-IP allowlist only, maximum 32 entries, with null/omitted/empty normalized to unrestricted null and CIDR/wildcards rejected;
- positive `revision bigint NOT NULL DEFAULT 1` optimistic concurrency;
- rotation increments `revision` and `secret_version` exactly once;
- revoke increments `revision` exactly once and is terminal;
- exact completed idempotency replay is evaluated before current revision/status fencing;
- maximum 10 active credentials per merchant/environment is enforced transactionally under the merchant-row lock;
- append-only audit is written exactly once per winning mutation in the same trusted transaction;
- A1 bearer revalidation invalidates old tokens immediately after secret-version rotation or credential revocation;
- zero Payment, ledger, provider, payout/refund, job or webhook effects.

## TDD progression

A8 followed the frozen delivery pipeline:

1. Problem Analysis frozen before implementation;
2. YAML specification frozen;
3. application and PostgreSQL contracts written before implementation;
4. clean RED proved with all predecessor contracts remaining green;
5. minimal application/database implementation added;
6. real-database acceptance expanded to cover behavior, concurrency and least privilege;
7. defects discovered by the RED/GREEN loop were corrected without widening the contract;
8. hosted deployment occurred only after the complete local/CI boundary was green.

The initial RED preserved the A1-A7 baseline and failed only on missing A8 behavior. Application contracts then reached 226/226 GREEN.

## Defects caught before hosted deployment

The TDD/CI loop caught two PostgreSQL syntax defects before any hosted A8 migration was applied:

- schema-qualifying SQL `POSITION` syntax as `pg_catalog.position(...)`;
- schema-qualifying SQL `COALESCE` syntax as `pg_catalog.coalesce(...)`.

Both were corrected to valid PostgreSQL semantics (`pg_catalog.strpos(...)` where a callable function was required and unqualified SQL `coalesce(...)`).

The final `COALESCE` defect was proven through the real `swiftpay_api_runtime` connection. The failed transaction left exactly zero A8 credential, idempotency and audit rows, proving rollback rather than partial mutation. A temporary synthetic diagnostic RPC was removed after GREEN.

## Final pre-hosted GREEN

Final clean behavior head before hosted migration-version reconciliation:

- `f110cbc1a3e38eb338641f9c1be3939def94d975` — `test(a8): remove temporary credential diagnostics after green`.

Application workflow:

- run `32000545024` — **GREEN**;
- typecheck: PASS;
- build: PASS;
- application contracts: **226/226 PASS**;
- runtime-database-acceptance: PASS through K7, A1, A2, A3, A4, A6, A7 and A8.

Database workflow:

- run `32000545091` — **GREEN**;
- pgTAP: PASS;
- deterministic sandbox fixtures: PASS;
- runtime topology / least privilege: PASS.

The hosted migration-version alignment commit is:

- `96f23baff6aaf808acd68e17de3c30b4d247a185` — `chore(a8): align migration filenames with hosted history`.

It renames only the three A8 migration paths to the Supabase-hosted migration versions and reuses the exact existing SQL blob SHAs; SQL contents are unchanged.

## Hardened real-database acceptance

`tests/application/046_a8_api_credential_management_runtime_acceptance.sh` executes the real A8 driver through production-like `swiftpay_api_runtime` against isolated PostgreSQL.

The lifecycle proves:

1. member can list/read credentials but cannot mutate;
2. Sandbox admin can create a credential and receives plaintext Secret Key once;
3. exact create replay returns the same credential with no plaintext;
4. same idempotency key with changed request conflicts;
5. public projection contains no verifier or Secret Key;
6. an A1 bearer token with secret version 1 is accepted before rotation;
7. rotation advances `revision` and `secret_version` once and returns new plaintext once;
8. the old A1 bearer token is rejected immediately after rotation;
9. exact rotation replay succeeds with no plaintext;
10. a new stale rotation request conflicts;
11. a current A1 bearer token is accepted before revoke;
12. revoke advances revision once and immediately invalidates that token;
13. exact revoke replay succeeds without another mutation;
14. rotation of a revoked credential conflicts;
15. Production admin cannot create credentials;
16. Production owner can create and replay without plaintext redisclosure;
17. eleven attempted active Sandbox creates result in exactly ten winners and one `credential_limit_reached`;
18. final credential/audit counts prove exactly-once mutation semantics;
19. no plaintext Secret Key or `scrypt-v1` verifier leaks into idempotency/audit snapshots;
20. financial/provider/job/webhook table counts remain exactly invariant;
21. runtime roles retain zero direct protected-table authority;
22. private `_a8_*` helpers remain unavailable to runtime roles;
23. `swiftpay_api` has exactly 21 trusted `app` EXECUTE capabilities and `swiftpay_worker` remains exactly 6.

The acceptance prints:

`SwiftPay A8 API credential management real-database acceptance: OK`

## Hosted Supabase deployment

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

No reset, seed, fixture insertion or hosted business-data acceptance was performed.

Hosted migrations applied successfully:

- `20260817061316_api_credential_management_foundation.sql`;
- `20260817061346_api_credential_management_create.sql`;
- `20260817061415_api_credential_management_behavior.sql`.

Repository migration filenames were reconciled to those exact hosted versions without changing SQL bytes.

## Hosted least-privilege audit

Read-only catalog verification after deployment proves:

- `app.api_credentials.revision` exists, is `NOT NULL`, and defaults to `1`;
- all five frozen A8 management RPCs exist;
- `swiftpay_api` has exactly **21** `app` EXECUTE capabilities;
- `swiftpay_worker` remains exactly **6** `app` EXECUTE capabilities;
- API and worker have no direct SELECT/INSERT/UPDATE/DELETE over `api_credentials`, `api_credential_token_windows`, `request_idempotency` or `audit_events`;
- private `_a8_begin_api_credential_command` and `_a8_complete_api_credential_command` are not executable by either runtime role;
- no hosted credential verifier row contains a plaintext `sk_sandbox_` or `sk_production_` value;
- no idempotency snapshot or audit metadata contains a plaintext Secret Key or `scrypt-v1` verifier pattern.

Hosted Security Advisor after A8: **0 lints**.

Performance Advisor remains INFO-only with the pre-existing unindexed-foreign-key and unused-index candidates. A8 does not add speculative indexing/deletion outside its frozen behavior slice; optimization remains a dedicated measured/tested workstream.

## Safety conclusion

A8 is **DONE**.

A merchant can now create, inspect, rotate and revoke machine API credentials through the trusted dashboard boundary, with online AAL2 step-up for mutations, one-time plaintext disclosure, replay-safe idempotency, immediate A1 token invalidation and explicit least privilege.

This materially improves Sandbox product usability and removes API credential administration from the internal product gap. It does **not** change the main Production blocker: live AkkadPag/FlevoPay transport, provider webhook ingress and ambiguous-execution recovery remain gated on accepted current provider-owned contract evidence or authenticated current sandbox proof.
