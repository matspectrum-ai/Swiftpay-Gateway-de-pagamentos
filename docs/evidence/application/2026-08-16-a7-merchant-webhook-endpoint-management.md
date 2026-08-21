# SwiftPay V2 — A7 Merchant Webhook Endpoint Management Evidence

Date: 2026-08-16
Status: **DONE / GREEN / HOSTED**

Problem Analysis: `docs/design/a7-merchant-webhook-endpoint-management-problem-analysis.md`

Frozen spec: `docs/specs/merchant-webhook-endpoint-management-v0.yaml`

This evidence closes A7. It does not authorize live PSP money movement and it does not change provider-production evidence gates.

## Accepted boundary

A7 adds a first-class dashboard-only merchant webhook endpoint lifecycle while preserving A4 delivery and K3/K4/A6 authorization invariants.

Accepted behavior includes:

- dashboard realm only under `/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints`;
- list/get require current `member` authority; create/update/disable/enable/rotate require current `admin` authority;
- A1 machine credentials do not become webhook-administration credentials;
- no direct browser/Data API table mutation;
- create, list, get, update, disable, enable and rotate-secret operations;
- no DELETE in V0;
- URL mutation only while disabled;
- exactly `payment.paid` as the executable subscription vocabulary;
- positive optimistic-concurrency `revision` incremented exactly once per successful mutation;
- durable request idempotency scoped by merchant/environment/operation/key;
- completed create/rotate replay never persists or re-discloses plaintext signing secret;
- append-only audit composition in the same trusted database transaction;
- one-time `whsec_<base64url(32 CSPRNG bytes)>` plaintext only on the winning create/rotate response;
- new signing secrets wrapped with RSA-OAEP-SHA256, endpoint/version/key-ID bound through OAEP label;
- API receives encrypt-only public wrapping authority; worker receives private-keyring decrypt authority;
- A4 AES-256-GCM legacy rows remain dispatch-compatible during migration;
- durable `webhook_endpoint_secret_versions` history with 24-hour prior-version overlap;
- immutable delivery URL and signing-secret-version snapshots;
- `X-SwiftPay-Signature-Version` emitted from the immutable delivery version;
- disabling terminalizes pending not-yet-leased delivery/job work without HTTP;
- zero Payment/ledger/provider/payout/refund mutation authority.

## Final application GREEN

Final behavior head before hosted migration-version reconciliation:

- `155472ba299f1e75d33dd6cad430ad61b923a043` — `fix(a7): let rotation idempotency precede revision fencing`.

Application workflow:

- run `31934008876` — **GREEN**;
- application-contracts: **209/209 PASS**;
- typecheck: PASS;
- build: PASS;
- runtime-database-acceptance: PASS through K7, A1, A2, A3, A4, A6 and A7.

Database workflow:

- run `31934008886` — **GREEN**;
- pgTAP: PASS;
- deterministic sandbox fixtures: PASS;
- runtime topology / least privilege: PASS.

The migration-version reconciliation commit is:

- `34e3ee28359b0ea8a96ade40d84323e0094e931d` — `chore(a7): reconcile hosted migration versions`.

It renames only the three A7 migration files to the hosted versions and reuses the exact same blob SHAs; SQL contents are unchanged.

## Hardened real-database acceptance

`tests/application/042_a7_webhook_endpoint_management_runtime_acceptance.sh` now invokes the real acceptance driver `042_a7_webhook_endpoint_management_runtime_driver.mjs` against isolated Postgres using production-like `swiftpay_api_runtime` and `swiftpay_worker_runtime` identities.

It proves, in one lifecycle:

1. runtime roles cannot directly select endpoint/secret-history tables;
2. member can read but cannot create;
3. admin create returns one plaintext signing secret;
4. exact create replay returns the durable public projection with `secretAvailable=false` and no plaintext;
5. same idempotency key with changed request conflicts;
6. active URL mutation conflicts;
7. disable -> update URL -> enable succeeds with monotonic revisions;
8. a delivery created before rotation snapshots URL + secret version 1;
9. rotation creates secret version 2 and returns plaintext only once;
10. completed rotation replay succeeds without another plaintext even though endpoint revision already advanced;
11. a new idempotency key with stale expected revision conflicts;
12. durable secret history contains RSA versions 1 and 2 and no plaintext;
13. old secret remains usable only through its bounded overlap;
14. real worker claim/resolve path dispatches version-1 and version-2 deliveries;
15. captured HTTP attempts validate against the exact returned HMAC secrets and immutable signature-version headers;
16. changing endpoint URL later does not redirect already-created deliveries;
17. new fanout after URL mutation snapshots the new URL;
18. disabling terminalizes a pending delivery/job and produces no HTTP attempt;
19. audit counts are exactly one per winning successful mutation, not per replay;
20. completed idempotency snapshots contain no signing plaintext/ciphertext/key authority;
21. endpoint current/previous compatibility mirrors contain ciphertext only;
22. financial table counts are exactly invariant across the A7 management lifecycle.

The acceptance prints:

`SwiftPay A7 webhook endpoint management real-database acceptance: OK`

## Rotation replay correction

During GREEN hardening, the service layer still pre-checked `current.revision === expectedRevision` before invoking the database rotation RPC. That could incorrectly reject an exact completed replay because the successful first rotation had already incremented the endpoint revision.

The final implementation removes that premature service-layer revision fence. The trusted RPC remains authoritative and deliberately evaluates durable idempotency before optimistic concurrency:

- same key + same request + completed snapshot -> replay success, no new secret;
- new key + stale `expectedRevision` -> `resource_conflict`.

`tests/application/043_a7_rotation_replay.contract.test.mjs` freezes this behavior.

## CI secret-log hardening

The A7 runtime acceptance generates an ephemeral RSA-2048 keypair per CI job. During hardening, the private-keyring value was visible in Actions environment log rendering. It was not a production key, but the behavior was unacceptable.

The provisioning script now:

- writes the keys directly to `$GITHUB_ENV`;
- emits GitHub `::add-mask::` commands for the private key and serialized private-keyring before later steps;
- never commits generated key material.

Final runtime logs show the private-keyring only as `***`.

## Hosted Supabase deployment

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

No reset, seed, fixture insertion or hosted business-data acceptance was performed.

Hosted migrations applied successfully:

- `20260816073330_webhook_endpoint_management_foundation.sql`;
- `20260816073500_webhook_endpoint_management_behavior.sql`;
- `20260816073604_webhook_endpoint_management_behavior_fix.sql`.

The repository migration files were reconciled to those hosted versions byte-for-byte through the original migration blob identities.

## Hosted least-privilege audit

Read-only catalog audit after deployment proves:

- `webhook_endpoints.revision` exists as `bigint NOT NULL`;
- `webhook_deliveries.endpoint_url_snapshot` exists as `text NOT NULL`;
- `app.webhook_endpoint_secret_versions` exists;
- `swiftpay_api` has exactly **16** `app` EXECUTE capabilities: the prior nine trusted API routines plus exactly seven A7 endpoint-management routines;
- `swiftpay_worker` remains exactly **6** EXECUTE capabilities;
- worker has no A7 management routine execution;
- API has no worker webhook claim/resolve execution;
- API/worker have no direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges on `webhook_endpoints`, `webhook_endpoint_secret_versions`, `request_idempotency` or `audit_events`;
- private `_a7_*` helpers are not executable by either runtime role;
- management functions and the effective delivery claim routine are SECURITY DEFINER with fixed empty `search_path` where frozen;
- read routines are STABLE and mutations/claim are VOLATILE as frozen.

Hosted Security Advisor after A7: **0 lints**.

Performance Advisor remains INFO-only. It reports existing unindexed-foreign-key and unused-index candidates, including the newly created secret-history index being unused in the young hosted database. These are non-blocking and must be addressed only in a dedicated measured/tested optimization slice; A7 does not speculate by deleting or adding indexes outside its frozen scope.

Supabase linter references:

- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## Safety conclusion

A7 is **DONE**.

The merchant can now manage the webhook endpoint lifecycle through a dashboard-user/K4-authorized trusted API boundary without receiving direct database authority, without giving the API the worker's legacy AES decryption key, without persisting plaintext signing secrets, without redirecting already-created deliveries, and without gaining any financial mutation authority.

This closure improves sandbox product usability. It does **not** change the external production blocker: live AkkadPag/FlevoPay activation, provider webhook ingress and execution-unknown recovery remain gated on accepted current provider-owned contract evidence or authenticated current sandbox proof.
