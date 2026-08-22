# A24 — Checkout abuse-policy constraint repair — Problem Analysis

Date: 2026-08-21
Status: PROBLEM_ANALYSIS / FROZEN FOR SPEC

## Observed defect

During the first hosted A23 post-deploy smoke on canonical Supabase project `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`), `app.consume_api_abuse_quota('checkout_request_pre_auth', ...)` failed with PostgreSQL `23514` on `api_abuse_windows_policy_check`.

The A23 routine correctly recognizes `checkout_request_pre_auth` with limit 120/60s, but the persisted table CHECK still accepts only the pre-A23 policy vocabulary:

- `token_exchange_pre_auth`
- `machine_request_pre_auth`
- `machine_read`
- `machine_mutation`
- `dashboard_request_pre_auth`
- `readiness_probe`

Therefore the first materialization of a checkout quota subject is rejected by the table before A14/A18 admission can return a decision.

## Impact

A23 anonymous hosted checkout is not operational on the hosted database even though schema migration, capability attestation and repository CI are otherwise GREEN. Public checkout admission fails before payment-link lookup or Pix preparation.

No Payment, ProviderAttempt, payment-link, ledger or provider state was created by the failed smoke.

## Why CI missed it

`045_hosted_pix_checkout_payment_links.test.sql` asserts A23 routine identity, privilege boundaries, capability counts and financial non-mutation, but it does not execute `checkout_request_pre_auth` against `app.api_abuse_windows`. The application contract exercises the admission boundary above PostgreSQL and therefore did not expose the stale table CHECK vocabulary.

## Required repair

Add one forward-only migration that replaces only `app.api_abuse_windows_policy_check`, preserving the six existing policy values and adding exactly `checkout_request_pre_auth`.

The repair must not change:

- any A14/A18 numeric limit or 60-second fixed-window semantics;
- HMAC subject derivation or rotation continuity;
- `app.consume_api_abuse_quota(text,text,text)` identity, owner, volatility, SECURITY DEFINER or search path;
- API/worker capability counts (30/6 after A23);
- Data API or direct-table authority;
- Payment/ProviderAttempt/ledger behavior;
- A10/A11 provider authority or any live PSP behavior.

## Acceptance boundary

A24 is accepted only when:

1. pgTAP proves the CHECK vocabulary contains exactly the seven allowed policies;
2. a real database call using `checkout_request_pre_auth` succeeds and materializes the expected quota row inside a rolled-back test transaction;
3. an unknown policy remains rejected by the CHECK;
4. full application/runtime/database regression remains GREEN;
5. hosted migration is applied and the hosted checkout quota smoke succeeds under rollback;
6. 30 API / 6 worker exact capability attestation remains missing 0 / extra 0;
7. Payments and ProviderAttempts remain 0/0 and retained-provider traffic remains zero.
