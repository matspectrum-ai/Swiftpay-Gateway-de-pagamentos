# A18 — Abuse Subject HMAC Key Rotation — Final Evidence

Date: 2026-08-19  
Status: **DONE / HOSTED**  
Branch: `agent/foundation-phase-0`  
Accepted implementation head: `15958e178f9496fc273d5576b38ad125134b59dc`

## 1. Contract boundary

Authoritative artifacts:

- Problem Analysis: `docs/design/a18-abuse-subject-hmac-key-rotation-problem-analysis.md`
- Frozen spec: `docs/specs/abuse-subject-hmac-key-rotation-v0.yaml`
- Frozen contract: `docs/contracts/abuse-subject-hmac-key-rotation-v0.md`
- Application contract: `tests/application/060_a18_abuse_subject_hmac_key_rotation.contract.test.mjs`
- Real-database concurrency acceptance: `tests/application/061_a18_abuse_subject_hmac_rotation_runtime_acceptance.sh`
- Database contract: `supabase/tests/database/043_abuse_subject_hmac_key_rotation.test.sql`
- Repository migration: `supabase/migrations/20260819024500_abuse_subject_hmac_key_rotation.sql`

A18 rotates the A14 abuse-subject HMAC authority without resetting effective quota state. It adds one optional previous continuity key and keeps a single PostgreSQL quota decision authoritative for active plus optional previous pseudonyms.

A18 does not change A14 policy limits, the 60-second fixed window, trusted-proxy behavior, public HTTP failures, worker authority, provider authority or any financial state machine.

## 2. TDD proof

RED was observed before implementation.

Application RED proved the existing A14 implementation lacked:

- optional previous HMAC configuration;
- active + previous pseudonym derivation in one store call;
- the three-argument adapter boundary;
- runtime wiring for the previous continuity key.

Database RED proved the hosted-compatible three-argument RPC did not yet exist.

Implementation followed only after those failures were observed.

## 3. CI GREEN

Application workflow: `32210344185` — GREEN.

- typecheck: PASS;
- build: PASS;
- application contracts: **353/353 PASS**;
- K7 real runtime database acceptance: PASS;
- A14 ingress-abuse real-database acceptance: PASS;
- A18 abuse-HMAC-rotation real-database acceptance: PASS;
- A1/A2/A3/A4/A6/A7/A8/A9 runtime regression acceptance: PASS.

A18 real-database concurrency acceptance proves:

- 31 concurrent dual-key consumes with active/previous orientation reversed admit exactly 30 and deny exactly 1 for the A14 token pre-auth limit of 30;
- both aliases converge to the same request count and window;
- mixed A14 two-argument and A18 three-argument callers coexist against one RPC;
- the mixed concurrency path also admits exactly 30 and denies exactly 1;
- no deadlock occurs under reversed alias ordering;
- API/worker EXECUTE capability counts remain 24/6.

Database workflow: `32210344189` — GREEN.

- pgTAP: **43 files / 1326 assertions PASS**;
- K5 deterministic sandbox fixtures: PASS;
- K6 runtime topology: PASS.

## 4. Hosted deployment

Canonical Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

Hosted migration history records:

- `20260819043811_abuse_subject_hmac_key_rotation`.

The hosted canonical function is exactly one routine:

```text
app.consume_api_abuse_quota(
  p_policy text,
  p_active_subject_hash text,
  p_previous_subject_hash text default null
)
```

Hosted metadata after deployment:

- function count for `app.consume_api_abuse_quota`: **1**;
- trailing defaults: **1**;
- `SECURITY DEFINER`: **true**;
- volatility: **VOLATILE**;
- `swiftpay_api` total `app` EXECUTE capabilities: **24**;
- `swiftpay_worker` total `app` EXECUTE capabilities: **6**;
- `swiftpay_api` may execute the quota RPC: **yes**;
- `swiftpay_worker` may execute the quota RPC: **no**;
- `PUBLIC` may execute the quota RPC: **no**.

There is no residual two-argument overload. A14 compatibility is supplied by the defaulted third argument on the single canonical function.

## 5. Hosted compatibility smoke

A hosted smoke was executed inside a transaction and rolled back.

Sequence:

1. invoke the canonical routine with the legacy A14 two-argument form;
2. invoke the same routine with the A18 three-argument form using a second alias and the first alias as previous;
3. inspect both rows;
4. `ROLLBACK`.

Observed before rollback:

- both aliases had `request_count = 2`;
- both aliases had the same canonical `window_started_at`.

Observed after rollback:

- `app.api_abuse_windows`: **0 rows**;
- Payments: **0**;
- ProviderAttempts: **0**.

The smoke therefore proves live hosted two-argument compatibility and active/previous reconciliation without retaining fixture state.

## 6. Security and capability postflight

Supabase Security Advisor after deployment: **0 lints**.

A18 introduced no direct-table authority and no worker quota authority. Runtime capability counts remain exactly the pre-A18 hosted counts of 24 API EXECUTEs and 6 worker EXECUTEs.

No raw IP, merchant/environment subject material, subject HMAC or HMAC key is persisted by the new contract. PostgreSQL receives only opaque lowercase SHA-256 HMAC pseudonyms.

## 7. Financial/provider non-effect

After hosted deployment and rollback smoke:

- Payments: **0**;
- ProviderAttempts: **0**;
- retained-provider calls caused by A18: **0**;
- A10 activation promotions caused by A18: **0**.

A18 therefore introduces no provider or monetary execution authority.

## 8. Operational rotation invariant

The previous key is continuity-only and bounded to one key.

Safe rollout remains:

1. database migration first;
2. old A14 replicas remain old-key-only;
3. new A18 replicas run new active key + old previous key;
4. drain all old-key-only replicas;
5. wait at least 60 seconds after the last old-key-only replica becomes incapable of serving;
6. remove `SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY` and redeploy active-only.

It is forbidden to run A14 code with the new active key while old-key windows may remain live, or to run A18 active-only while any old A14 old-key-only replica can still serve.

## 9. Closure

A18 is **DONE / HOSTED**.

The rotation boundary is contract-defined, fail-first tested, concurrency-tested against real PostgreSQL, deployed to the canonical hosted Supabase project and postflight-verified without widening database, provider or financial authority.
