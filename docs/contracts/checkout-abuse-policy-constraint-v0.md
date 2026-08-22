# SwiftPay V2 — A24 Checkout Abuse-Policy Constraint V0 Contract

Status: **FROZEN FOR TDD**  
Date: 2026-08-21

A24 repairs one database-contract mismatch discovered by the first hosted A23 smoke. It does not create a new quota protocol.

## Exact database contract

`app.api_abuse_windows_policy_check` MUST accept exactly these policy values:

```text
token_exchange_pre_auth
machine_request_pre_auth
machine_read
machine_mutation
dashboard_request_pre_auth
checkout_request_pre_auth
readiness_probe
```

Any other `policy` value remains rejected by the table CHECK.

## Executable behavior

The already-frozen function:

```text
app.consume_api_abuse_quota(text,text,text)
```

MUST be able to execute `checkout_request_pre_auth` against a clean database. For a fresh canonical 64-hex subject, the first call MUST be admitted and persist one in-transaction quota row with `request_count = 1`.

The A23 limit remains exactly 120 requests per 60-second fixed window. A18 active/previous HMAC continuity semantics remain unchanged.

## Authority invariants

A24 MUST NOT alter:

- exact runtime capabilities: 30 `swiftpay_api` / 6 `swiftpay_worker`;
- `swiftpay_api`-only EXECUTE authority for `app.consume_api_abuse_quota(text,text,text)`;
- zero direct protected-table privileges for runtime roles;
- zero `app` EXECUTE authority for `PUBLIC`, `anon`, `authenticated`, or `service_role` where frozen;
- any provider activation/transport authority;
- any Payment, ProviderAttempt, ledger, payout, refund, reservation or reconciliation behavior.

## Migration contract

A24 is a forward-only migration. It MUST replace only `api_abuse_windows_policy_check`; it MUST NOT rewrite existing quota rows or modify the quota function.

## TDD acceptance

The fail-first pgTAP contract MUST prove the pre-A24 schema is RED because the CHECK omits `checkout_request_pre_auth` and a real checkout quota call cannot materialize its row.

After implementation, the same test MUST be GREEN while the complete existing database/application/runtime regression remains GREEN.
