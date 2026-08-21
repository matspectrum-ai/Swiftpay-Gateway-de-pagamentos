# K6 — Trusted runtime deployment topology evidence

Date: 2026-08-15
Branch: `agent/foundation-phase-0`
Canonical managed project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)

## Scope

K6 closes the deployment/authentication topology between the future SwiftPay API/worker processes and the K4 PostgreSQL capability roles. It does not deploy an HTTP API, worker, provider adapter or production secret.

The frozen contract is `docs/specs/trusted-runtime-deployment-topology-v0.yaml`.

## Runtime identities

Production-like runtime identities are distinct PostgreSQL LOGIN roles:

- `swiftpay_api_runtime` inherits exactly `swiftpay_api`;
- `swiftpay_worker_runtime` inherits exactly `swiftpay_worker`.

Both identities are constrained to LOGIN + INHERIT and remain non-superuser, non-CREATEDB, non-CREATEROLE, non-replication and non-BYPASSRLS.

No direct `app` table, sequence or routine ACL is granted to either LOGIN role. Runtime authority is inherited through the K4 NOLOGIN capability roles only.

## Secret handling

`ops/postgres/provision-runtime-identities.sql` is intentionally secret-free. It creates/validates role attributes, restores the expected capability memberships and revokes direct object access, but does not contain a password or managed database URL.

Production password creation/rotation remains an out-of-band deployment-secret operation through a separate administrative connection. Application runtime must never use the migration/admin credential, `postgres`, `service_role`, `authenticator` or another platform-wide identity as a database shortcut.

The local CI provisioner uses fixed loopback-only credentials solely against the isolated Supabase CLI PostgreSQL instance at `127.0.0.1:54322`; it does not accept a managed/remote database URL.

## RED evidence

GitHub Actions run #133 (`31864993544`) introduced the dedicated `runtime-topology` lane. Existing database and sandbox lanes remained GREEN while the runtime lane failed exactly because the provisioner did not yet exist.

A later diagnostic run proved the production-like bootstrap itself and exposed only a pgTAP plan-count mismatch: all 27 runtime assertions passed, but the file declared 26 tests. This harness defect was corrected without changing the permission model.

## GREEN evidence

Commit: `d0158ae8fb87e262986636aa381bb5325815b89e`
GitHub Actions run: #143 (`31865487612`)

All three CI lanes passed:

- canonical database contracts: 29 files / 973 tests / PASS;
- deterministic sandbox fixtures: 1 file / 20 tests / PASS;
- K6 runtime topology: 1 file / 27 tests / PASS.

The K6 lane additionally connected as each runtime identity using its own database connection and returned:

- `SwiftPay api runtime database boundary: OK`;
- `SwiftPay worker runtime database boundary: OK`.

Those connection-level checks prove:

- exact `current_user` identity;
- expected K4 capability membership;
- cross-workload capability membership absent;
- `app` schema USAGE inherited and CREATE denied;
- direct Payment table SELECT/INSERT/UPDATE/DELETE denied;
- API can execute the dashboard-context capability but cannot claim worker jobs;
- worker can claim jobs but cannot execute the dashboard-context capability.

The structural pgTAP suite also proves zero direct `app` relation/sequence ACL entries for both LOGIN identities and confirms that current financial/provider/audit primitives remain outside both runtime allowlists.

## Managed-project boundary

No production runtime password was created and no runtime LOGIN credential was activated on the managed project as part of K6. That is deliberate: application deployment/secrets must exist before a production credential can be provisioned safely.

The managed project remains the canonical schema/migration target and K4 capability roles are already deployed there. K6 supplies the versioned, secret-free bootstrap and connection-level acceptance harness needed for the deployment phase.

## Result

K6 platform topology is GREEN. Phase 2 structural platform/security foundation is closed for the first executable vertical slice, subject only to workload-driven performance/index work and future capability additions demanded by concrete application contracts.
