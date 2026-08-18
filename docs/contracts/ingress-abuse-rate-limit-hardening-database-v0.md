# A14 — Trusted Ingress, Abuse & Rate-Limit Hardening — Database Contract V0

Status: **FROZEN FOR TDD**  
Date: 2026-08-18

This contract refines `docs/specs/ingress-abuse-rate-limit-hardening-v0.yaml` for PostgreSQL. The YAML specification is authoritative if wording differs.

## 1. Private table

A14 adds exactly one private table:

```text
app.api_abuse_windows
```

Columns:

- `policy text NOT NULL`;
- `subject_hash text NOT NULL`;
- `window_started_at timestamptz NOT NULL`;
- `request_count integer NOT NULL`;
- `updated_at timestamptz NOT NULL`.

Primary key:

```text
(policy, subject_hash)
```

Required checks:

- `policy` is exactly one of:
  - `token_exchange_pre_auth`;
  - `machine_request_pre_auth`;
  - `machine_read`;
  - `machine_mutation`;
  - `dashboard_request_pre_auth`;
  - `readiness_probe`;
- `subject_hash` matches lowercase 64-character hexadecimal SHA-256 shape;
- `request_count >= 0`.

Required index:

```text
api_abuse_windows_updated_at_idx (updated_at)
```

No merchant/credential/user/IP foreign key or plaintext identity column is permitted.

## 2. Trusted routine

Exactly one new application routine:

```sql
app.consume_api_abuse_quota(
  p_policy text,
  p_subject_hash text
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
```

Properties:

- `LANGUAGE plpgsql`;
- `VOLATILE`;
- `SECURITY DEFINER`;
- fixed empty/safe `search_path`;
- no overloads.

Execute allowlist:

- `swiftpay_api`: allowed;
- `PUBLIC`: denied;
- `anon`: denied;
- `authenticated`: denied;
- `service_role`: denied;
- `swiftpay_worker`: denied.

A14 must not grant direct table access to API or worker.

## 3. Frozen policy limits

All policy windows are 60 seconds.

```text
token_exchange_pre_auth   30
machine_request_pre_auth  12000
machine_read              6000
machine_mutation          3000
dashboard_request_pre_auth 300
readiness_probe           120
```

Unknown policy fails before mutation.

`p_subject_hash` must satisfy lowercase 64-hex shape before mutation.

## 4. Atomic fixed-window behavior

For one `(policy, subject_hash)`:

1. establish a row if absent;
2. lock the row so concurrent API replicas serialize the same subject/policy;
3. if current database clock is at/after `window_started_at + 60 seconds`:
   - reset `window_started_at` to current clock;
   - set `request_count=1`;
   - set `updated_at=current clock`;
   - return allowed with `remaining=limit-1`, `retry_after_seconds=0`;
4. otherwise, if `request_count < limit`:
   - increment exactly once;
   - update `updated_at`;
   - return allowed with exact remaining count and zero retry;
5. otherwise:
   - do not increment the counter;
   - return denied with `remaining=0`;
   - return integer `retry_after_seconds` equal to ceiling of the remaining fixed-window duration, clamped to `1..60`.

The routine must use PostgreSQL/database time, not application-provided timestamps.

## 5. Bounded stale-state pruning

One consume call may delete stale rows where:

```text
updated_at < current_clock - 24 hours
```

The delete batch is capped at **32 rows per consume call** and must use the `updated_at` index/order to avoid an unbounded cleanup scan.

Pruning is storage maintenance only. It may not change the current policy/subject decision.

No background worker privilege is added for cleanup.

## 6. Failure behavior

Invalid policy or invalid hash must fail before abuse-window mutation.

Database exceptions are mapped by the TypeScript DB adapter to a sanitized application-store error with no SQL, connection URL, raw identity or hash disclosure.

A malformed routine result is rejected by the adapter.

## 7. Capability delta

Pre-A14 hosted/runtime baseline:

- `swiftpay_api`: 23 exact `app` EXECUTE capabilities;
- `swiftpay_worker`: 6 exact `app` EXECUTE capabilities.

Post-A14 expected capability baseline after migration:

- `swiftpay_api`: **24** exact `app` EXECUTE capabilities;
- `swiftpay_worker`: **6** exact `app` EXECUTE capabilities.

The sole new API execute capability is `app.consume_api_abuse_quota(text,text)`.

No existing routine privilege may be broadened.

## 8. TDD expectations

Database RED/GREEN tests must prove:

- exact table/check/index shape;
- exact one-routine signature/security/search_path;
- exact capability delta;
- no direct runtime table privileges;
- first request, limit boundary, denial and reset behavior;
- same-key concurrency cannot over-admit;
- policy isolation and subject isolation;
- denied calls do not increment;
- malformed policy/hash fail before mutation;
- pruning deletes no more than 32 stale rows and does not remove fresh rows;
- K1-K7/A1-A13 database contracts remain GREEN.
