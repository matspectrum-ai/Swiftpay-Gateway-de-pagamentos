# K3 — Dashboard merchant membership authorization evidence

Status: DONE
Canonical Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)

## Boundary

K3 establishes the private trusted-server authorization primitive that resolves a Supabase Auth identity against the canonical SwiftPay merchant-membership table.

Sources of truth are deliberately separated:

```text
auth.users.id          -> authenticated dashboard identity anchor
app.merchant_members   -> merchant membership + merchant role
merchant lifecycle/KYC -> separate financial capability gate
```

K3 does not expose `app` to the browser, does not use JWT membership claims, does not trust `raw_user_meta_data`, and does not grant positive EXECUTE access to an application database role. That positive role/context boundary is K4.

Canonical specification:

- `docs/specs/dashboard-merchant-membership-authorization-v0.yaml`

Canonical migrations:

- `20260815024000_dashboard_membership_authorization_foundation.sql`
- `20260815024519_dashboard_membership_authorization_behavior.sql`

Canonical tests:

- `026_dashboard_membership_authorization_schema.test.sql`
- `027_dashboard_membership_authorization_behavior.test.sql`

## Frozen contract

```text
app.require_merchant_membership(
  user_id uuid,
  merchant_id uuid,
  required_role text
) -> actual active membership role
```

Role hierarchy:

```text
owner > admin > member
```

The function is `STABLE`, `SECURITY DEFINER`, lives in private `app`, uses fixed `search_path = pg_catalog, app, auth`, and remains revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.

Authorization denial uses SQLSTATE `42501` with one non-enumerating message. Invalid request shape/role uses `23514`.

## TDD evidence

### Specification freeze

Commit: `2ac8bb89afe24bb50aa6dbc75ace412d8c92df91`

### Structural RED

Test commit: `010ed4ad8003322f1324fbadc6ba90487083e88b`
GitHub Actions run: `109` (`31859694197`)
Job: `94950729948`

Result:

- aggregate: 26 files / 871 tests / FAIL;
- only 5/15 K3 structural assertions failed;
- failures were exactly the absent helper signature/return/security-definer/search-path/STABLE attributes;
- existing `merchant_members -> auth.users` FK, composite membership PK and J1 ACL denial remained green.

### Structural GREEN

Foundation commit: `10a2e846b1f9d9391c1572027213c713094c44f5`
GitHub Actions run: `110` (`31859778885`)
Job: `94950954893`

Exact result:

```text
Files=26, Tests=871
Result: PASS
```

The foundation intentionally left authorization behavior fail-closed with SQLSTATE `0A000` and still granted no positive execution capability.

### Behavioral RED

Test commit: `8f512a309c130ad3af2ac020219894a1d4aa5ae8`
GitHub Actions run: `111` (`31859894055`)
Job: `94951276053`

Result:

- previous suites `001–026`: green;
- `027_dashboard_membership_authorization_behavior.test.sql`: all 31 assertions executed;
- assertions 1–26 failed exactly because the foundation helper returned/threw `0A000`;
- side-effect assertions 27–31 were already green;
- aggregate: 27 files / 902 tests / FAIL.

### Behavioral GREEN

Implementation commit: `bc1cd1ba5fa361b54f393345f732fdad5ffbba65`
GitHub Actions run: `112` (`31860024259`)
Job: `94951635244`

Exact result:

```text
All tests successful.
Files=27, Tests=902
Result: PASS
```

The GREEN suite proves:

- active member/admin/owner role hierarchy and actual-role return value;
- insufficient role is denied;
- disabled membership is denied immediately on the next check;
- role downgrade is visible immediately on the next check;
- membership never crosses merchant boundaries;
- unknown, anonymous and soft-deleted Supabase Auth identities are denied;
- `raw_user_meta_data` cannot grant merchant/role authorization;
- `raw_app_meta_data` does not replace canonical database membership;
- suspended/draft merchant lifecycle does not suppress dashboard membership authorization;
- null/invalid authorization requests fail deterministically;
- authorization checks create no audit, Payment, ledger, job or merchant-webhook side effects.

## Managed Supabase deployment evidence

The K3 foundation and behavior migrations were applied to the canonical project and migration history was normalized to the repository versions:

```text
20260815024000 dashboard_membership_authorization_foundation
20260815024519 dashboard_membership_authorization_behavior
```

Remote history contains 27 canonical migrations through `20260815024519`.

A transaction-scoped proof on the managed database verified:

```text
member_result = member
owner_as_admin_result = owner
suspended_result = admin
insufficient_sqlstate = 42501
anonymous_sqlstate = 42501
deleted_sqlstate = 42501
spoof_sqlstate = 42501
disabled_sqlstate = 42501
invalid_sqlstate = 23514
anon_execute_denied = true
authenticated_execute_denied = true
service_role_execute_denied = true
audit_event_count = 0
payment_count = 0
ledger_tx_count = 0
job_count = 0
webhook_event_count = 0
```

The proof transaction was rolled back. Post-rollback verification found zero K3 verification merchants, Auth users or memberships.

One initial remote proof attempt contained an invalid UUID literal in the verification fixture and failed before exercising K3. A cleanup query confirmed zero persisted fixtures; the corrected proof above then passed without changing product implementation.

Supabase Security Advisor after K3: **0 security lints**.

## Security decisions retained

- `raw_user_meta_data` is never authorization truth.
- `raw_app_meta_data` is not canonical merchant-membership truth; membership revocation/role changes must not wait for JWT refresh.
- Supabase anonymous identities are explicitly rejected as SwiftPay dashboard identities even though Supabase maps anonymous users to the authenticated database role.
- Client-supplied `merchant_id` is not authority by itself.
- K3 does not check KYC or merchant lifecycle because those are separate financial capability concerns.
- K3 grants no browser/Data API/service-role access.
- K4 must introduce a narrowly scoped trusted backend/worker database identity and bind execution context before any positive grant is made.
