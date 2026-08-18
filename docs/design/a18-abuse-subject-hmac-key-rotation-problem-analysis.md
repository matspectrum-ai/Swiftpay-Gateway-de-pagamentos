# A18 — Abuse Subject HMAC Key Rotation — Problem Analysis

Status: **PROBLEM_ANALYSIS**  
Date: 2026-08-18  
Implementation authority: **NONE**

## 1. Problem statement

A14 deliberately avoids persisting raw network addresses or merchant/environment identifiers in `app.api_abuse_windows`. The application derives a deterministic SHA-256 HMAC pseudonym from a dedicated secret (`SWIFTPAY_ABUSE_HMAC_KEY`) and the database quota routine stores only that opaque subject hash.

That privacy boundary is correct, but the current HMAC authority is a single required secret with no rotation protocol.

A naive secret replacement is not a safe rotation strategy. Because the persisted quota primary key is `(policy, subject_hash)`, changing the HMAC key changes the database identity of every subject. An actor that already consumed or exhausted a current 60-second window would immediately appear as a fresh subject under the new HMAC key and could receive another quota allowance during the same logical abuse horizon.

Therefore A18 is not merely a configuration-keyring refactor. It is a continuity problem across an intentionally pseudonymized distributed rate-limit identity.

## 2. Current executable facts

### A14 application boundary

`packages/abuse/src/index.ts` currently:

- accepts exactly one `hmacKey`;
- requires at least 32 UTF-8 bytes;
- derives `sha256` HMAC over the versioned namespace `a14v0`, subject class and canonical subject;
- sends exactly one `subjectHash` to the quota store for each admission;
- never persists or emits the raw subject;
- keeps network and merchant/environment subject classes separate.

### A14 database boundary

`packages/db/src/api-abuse-rate-limit.ts` currently calls only:

`app.consume_api_abuse_quota(policy text, subject_hash text)`.

The hosted quota table primary key is:

`(policy, subject_hash)`.

The authoritative quota window is 60 seconds. The database routine atomically creates/locks/updates one subject row and returns one bounded decision.

### Current authority surface

- current hosted `swiftpay_api` app EXECUTE capability count: 24;
- current hosted `swiftpay_worker` app EXECUTE capability count: 6;
- only API has quota-RPC authority;
- runtime roles have no direct access to `app.api_abuse_windows`;
- A14 must remain fail-closed when the admission store is unavailable or malformed.

### Current operational gap

`SWIFTPAY_ABUSE_HMAC_KEY` is not covered by A15 or A16. A15 rotates machine-token signing keys. A16 rotates dashboard cursor HMAC keys. A17 retires webhook AES persisted-secret compatibility. None of those changes provide an A14 subject-identity rotation protocol.

## 3. Security and correctness invariants

Any accepted A18 design must preserve all of the following.

### Quota continuity

A rotation must not grant an already-known subject a fresh quota merely because the active HMAC key changed.

This matters for both:

- network subjects: canonical client IP;
- authenticated machine subjects: canonical merchant UUID + environment.

### Privacy

The database must continue to receive only opaque pseudonymous hashes. A18 must not persist raw IP addresses, merchant IDs, environment strings or reversible subject material merely to support migration.

### Atomicity under concurrency

A rotation design must remain correct under concurrent requests and multiple API replicas. There must not be a race in which different replicas see different key authorities and independently create usable quota headroom for the same logical subject.

### Fail-closed behavior

Malformed key authority, unknown key state, database failure, malformed quota result or transition inconsistency must never silently bypass admission.

### No caller authority

No request header, merchant input, persisted Payment data or external caller field may select an abuse HMAC key.

### Existing A14 behavior

A18 must preserve:

- exact trusted-proxy semantics;
- canonical IPv4/IPv6 resolution;
- A14 policy names and ceilings unless separately specified;
- pre-auth and post-auth ordering;
- 429/Retry-After behavior;
- readiness protection and liveness independence;
- HMAC-only stored subject identities;
- bounded stale-window pruning;
- no worker/provider/financial authority.

## 4. Why simple candidate approaches are insufficient

### 4.1 Replace the single environment key in place

Rejected as a safe default.

The new HMAC produces a different `subject_hash`. Existing quota state remains under the old hash, while the new hash starts with no count. This creates temporary extra quota during rotation.

### 4.2 Keep old and new keys but consume only the active hash

Rejected.

Retaining the old key without consulting its quota row preserves cryptographic material but not quota continuity.

### 4.3 Try all keys in the application and choose whichever row exists

Rejected.

The application cannot safely determine existence without expanding the DB interface, and a check-then-consume design introduces races. It also creates ambiguous authority and trial-all behavior inconsistent with A15/A16 exact-key principles.

### 4.4 Persist raw subject alongside hashes for re-hashing

Rejected.

This weakens the privacy boundary A14 deliberately established and is unnecessary if continuity can be achieved with bounded dual pseudonyms.

### 4.5 Accept a deliberate 60-second reset as operationally harmless

Not accepted without a separate explicit risk decision.

The reset is predictable and can be timed by an attacker. A security hardening slice should not silently introduce a quota-doubling window merely for operational convenience.

## 5. Viable direction: bounded dual-key overlap with one atomic quota decision

The strongest candidate is a bounded transition authority containing:

- exactly one active HMAC key ID/key;
- optionally one previous verify/continuity-only HMAC key ID/key;
- no caller-selected key;
- no unbounded keyring;
- no trial-all semantics.

During overlap the application can derive two pseudonyms for the same canonical subject: active and previous. The database must treat them as aliases of one logical quota decision for the current request.

The important requirement is **one atomic database operation**. Two independent calls to the existing single-hash RPC are insufficient because partial consumption or interleaving can create inconsistent decisions.

A likely database direction is a replacement/next-version trusted routine that accepts a bounded ordered set of one or two validated hashes, acquires deterministic row locks, evaluates the effective decision conservatively and advances all supplied aliases consistently in one transaction.

This is a design direction, not implementation authority. Exact signature, locking order, remaining-count semantics, migration strategy and old-function retirement must be frozen in the A18 spec/contract before tests.

## 6. Key-ID question

Unlike A15/A16 tokens/cursors, A14 subject hashes are not returned to a client and do not carry a serialized `kid`. A key ID may still be useful in configuration/auditability, but the database does not need the key ID to authorize a request if it receives only the already-derived bounded hash aliases.

If key IDs are introduced, they must be operational metadata only and must not become caller-controlled input or a second database identity dimension that accidentally fragments quota state.

## 7. Rotation lifecycle candidate

A safe lifecycle must account for the maximum authoritative quota window.

Candidate sequence:

1. deployment N configures old key as active;
2. deployment N+1 configures new key as active and old key as the single previous continuity key;
3. every admitted subject during overlap consumes one atomic decision across both pseudonyms;
4. overlap remains for at least the maximum time in which an old-hash A14 window can still influence admission, with deployment skew also accounted for;
5. only after the overlap invariant is met may the previous key be removed;
6. deployment N+2 runs active-only on the new key.

The exact minimum overlap duration cannot be casually frozen as exactly 60 seconds until API replica deployment skew and process lifetime assumptions are made explicit. The specification must define the deployment precondition rather than relying on wall-clock hope.

## 8. Database migration concerns

A18 should prefer preserving `app.api_abuse_windows` rather than re-identifying existing rows, because the raw subjects are intentionally unavailable.

Open migration questions:

- replace the current function signature or introduce a new function then revoke/drop the old one;
- if a new function temporarily coexists, prevent capability-count widening from becoming permanent;
- deterministic lock ordering for two hashes to prevent deadlock;
- behavior if active and previous derived hashes are accidentally identical;
- effective `remaining` when the two rows have different historical counts/window starts;
- handling one alias with an expired window and the other still active;
- bounded pruning with two aliases;
- clean rollback/forward-fix behavior during a mixed-replica deployment.

No schema change is justified yet merely to add a key ID column; the current table can potentially remain opaque-hash-only.

## 9. Conservative decision semantics to investigate

During overlap, the safe result should never be more permissive than either relevant historical alias.

A candidate principle is:

- if any non-expired alias is already rate-limited, deny;
- otherwise consume the logical request consistently across the active aliases;
- report a remaining count no greater than the most restrictive alias;
- report a retry-after no shorter than the authoritative remaining blocked interval.

However exact window-start reconciliation must be specified carefully. Simply taking `max(request_count)` can be incorrect when row windows began at different times. The eventual algorithm must be tested with asymmetric window age/count states, not only fresh rows.

## 10. Mixed-deployment risk

This is the hardest operational issue.

If some API replicas run old single-key/single-hash logic while others run new dual-key logic, one logical subject may receive decisions through two different database paths. A18 must either:

- make the database change backward-compatible in a way that still preserves continuity; or
- require an explicit deployment sequence that prevents mixed old/new admission semantics.

The current repository does not yet define a production rolling-deployment contract strong enough to assume zero overlap between software versions. A18 must not hide that uncertainty.

This may force A18 to include a narrow deployment invariant even if the application/database code is otherwise self-contained.

## 11. Hosted-state observations

A14 quota rows are ephemeral operational state, not financial records. They are pruned when stale and are not merchant ledger state. Nevertheless, live rotation correctness matters because the table is authoritative for abuse admission while windows are active.

A18 must not mutate Payment, ProviderAttempt, ledger, jobs, provider activation or webhook state.

## 12. Testing requirements anticipated for the next stage

If A18 proceeds to specification, fail-first contracts should cover at minimum:

- active-only authority preserves A14 behavior;
- bounded active + one previous key configuration;
- malformed/duplicate/undersized key authority rejected without secret echo;
- exact subject derives deterministic active/previous pseudonyms;
- database receives no raw subject or key material;
- old exhausted + new fresh alias remains denied during overlap;
- old partially consumed + new fresh alias cannot gain extra allowance;
- asymmetric window-start states remain conservative;
- concurrent dual-key consumers cannot exceed the logical ceiling;
- active-only after safe previous-key retirement behaves normally;
- transition from previous+active to active-only does not require raw-subject migration;
- network and merchant/environment subject classes remain isolated;
- store/RPC failure remains fail-closed;
- API capability remains narrowly scoped and worker capability unchanged;
- no provider/financial authority introduced.

A real-database acceptance is mandatory because the critical invariant is transactional/concurrent and cannot be proven solely with unit mocks.

## 13. Non-goals

A18 must not become:

- a general secret manager;
- provider credential rotation;
- A15 token-key rotation changes;
- A16 cursor-key rotation changes;
- webhook RSA key-retirement scheduling;
- A14 limit tuning;
- WAF/CDN rate limiting;
- a replacement for trusted-proxy policy;
- a provider integration slice;
- a financial-state migration.

## 14. Current recommendation

Proceed to an A18 specification only if it freezes an **atomic bounded dual-pseudonym continuity protocol** plus an explicit deployment transition invariant. Do not implement a simple keyring that hashes only with the active key, because that would add nominal rotation support while weakening the actual abuse-control guarantee.

The next step is specification/contract design, not code.

## 15. Readiness impact

A18 is internal production hardening. Even if completed, it should not by itself increase the current conservative readiness estimates (99% core / 97% sandbox MVP / 75% weighted V1 engineering / 60% production-capable Pix V1), because the dominant launch blocker remains current PSP contract authority, authenticated sandbox proof, provider webhook/recovery/reconciliation and cutover.