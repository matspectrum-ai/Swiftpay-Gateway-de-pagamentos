# SwiftPay V2 — A23 Hosted Pix Checkout + Payment Links — GREEN Evidence

Date: 2026-08-21  
Branch: `agent/foundation-phase-0`  
Feature: A23 — Hosted Pix Checkout + Payment Links  
Status: **DONE / GREEN / SANDBOX-ONLY / HOSTED DEPLOY PENDING**

## Frozen inputs

- Problem Analysis: `docs/design/a23-hosted-pix-checkout-payment-links-problem-analysis.md`
- Spec: `docs/specs/hosted-pix-checkout-payment-links-v0.yaml`
- Contract: `docs/contracts/hosted-pix-checkout-payment-links-v0.md`
- Application contracts: `tests/application/066_a23_hosted_pix_checkout_payment_links.contract.test.mjs`
- Database contract: `supabase/tests/database/045_hosted_pix_checkout_payment_links.test.sql`
- Migrations:
  - `20260819163000_hosted_pix_checkout_payment_links.sql`
  - `20260820041000_a23_checkout_quota_special_forms_fix.sql`

The final GREEN evidence below records the verified end state of the frozen A23 boundary. An explicit A23 RED workflow identifier was not recovered during this consolidation pass; no RED identifier is fabricated here.

## Accepted behavior

A23 adds a separate hosted-checkout/payment-link origin while preserving the A2 machine API contract:

- merchant-managed fixed-amount Sandbox Payment Links;
- opaque `plink_sandbox_...` public tokens;
- anonymous same-origin checkout read/create routes;
- new Payment origin `source = 'payment_link'`, distinct from A2 `source = 'api'`;
- deterministic Sandbox execution through the existing emulator and provider-attempt claim/resolve semantics;
- Production fail-closed;
- A14/A18 distributed admission controls reused for anonymous checkout creation;
- separate `apps/checkout` browser surface with no Supabase, database or provider authority;
- retained PSP authority remains zero and no A5 adapter is bridged to A11.

## Final application GREEN

Behavioral head under test before evidence documentation:

`fd3ad0ed32b7eadd0f3f82178181864f02534680`

Application workflow: `32529455364`.

`application-contracts` job `96918384325`:

- frozen install: GREEN;
- TypeScript typecheck: GREEN;
- build: GREEN;
- application contracts: **393 / 393 PASS**;
- A23 contracts: **10 / 10 PASS**;
- failures/skips/todos: **0 / 0 / 0**.

The final log proves the A23 boundary explicitly, including:

- frozen Problem Analysis/spec/contract presence;
- payment-link database/routine surface;
- exact post-A23 runtime capability manifest **30 API / 6 worker**;
- checkout abuse-control composition;
- separate hosted-checkout payment service and database stores;
- dashboard and anonymous checkout route composition;
- dashboard Payment Links UI;
- separate anonymous checkout SPA;
- preservation of zero retained-provider authority and A2 machine-source semantics.

## Final real-runtime regression GREEN

Application workflow `32529455364`, runtime-database-acceptance job `96918384097`: **GREEN**.

Against isolated PostgreSQL with the complete migration chain, all required real-runtime gates passed:

- K7 executable runtime;
- A14 ingress abuse;
- A18 abuse HMAC rotation;
- A1 machine authentication;
- A2 Pix create/get;
- A3 paid ledger/balance;
- A4 merchant webhook delivery;
- A6 dashboard authorization;
- A7 webhook endpoint management;
- A8 API credential management;
- A9 merchant transaction operations.

During final consolidation, two CI/test-only stale assumptions were repaired without production behavior changes:

1. `.github/workflows/application-contracts.yml` referenced obsolete A3/A4 acceptance filenames; it now invokes the canonical `021_a3_real_runtime_acceptance.sh` and `027_a4_real_runtime_acceptance.sh` scripts.
2. A8/A9 real-runtime topology assertions still expected the pre-A23 API capability total of 25; they now assert the frozen A23 exact total of **30 API / 6 worker**.

No financial, authentication, provider or database implementation was weakened to obtain GREEN.

## Final database GREEN

Database workflow: `32529455405`.

- pgTAP: **45 files / 1368 assertions PASS**;
- `045_hosted_pix_checkout_payment_links.test.sql`: PASS;
- K5 deterministic sandbox fixtures: GREEN;
- K6 runtime topology and exact role-boundary verification: GREEN.

The isolated database run applies both A23 migrations and proves the resulting schema/routines before pgTAP execution.

## Hosted Supabase state

Canonical hosted project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

At this evidence checkpoint, A23 is **not yet hosted**. The hosted migration history currently ends at:

`20260819132824_abuse_subject_hmac_rotation_canonical_insert_order`

Therefore:

- hosted A23 migrations applied: **0 / 2**;
- hosted runtime capability state remains the pre-A23 **25 API / 6 worker** baseline;
- repository/CI post-A23 capability contract is **30 API / 6 worker**;
- no claim of hosted checkout availability is authorized by this evidence.

The A23 hosted deployment must be a separate controlled operation: apply the two checked-in migrations, re-attest exact 30/6 capabilities and protected-table boundaries, run Security Advisor and a bounded Sandbox smoke, and preserve rollback/forward-fix evidence.

## Safety / non-scope

- retained-provider live calls: **0**;
- A10 default authorized retained-provider operations: **0**;
- Production checkout/payment-link creation remains fail-closed;
- no provider contract lineage/evidence gate was relaxed;
- no browser receives database/service-role/provider authority;
- no direct runtime protected-table DML was introduced;
- no Vercel deployment for the Gateway V2 repository was identified during the consolidation check; existing SwiftPay Vercel projects observed are linked to other repositories or unrelated SHAs.

## Merge readiness

A23 code and local/CI database behavior are GREEN and suitable for canonical source consolidation into `main`. Hosted Supabase deployment remains deliberately separate and pending.
