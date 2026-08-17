# SwiftPay V2 — A8 API Credential Management Application Interfaces

Status: **FROZEN FOR TDD**  
Date: 2026-08-17

The following names and interface shapes are the V0 application contract. Implementations may use narrower internal helpers, but these exported boundaries are stable for A8.

## Auth package exports

```ts
type PrivilegedDashboardSessionResult =
  | { kind: 'authenticated'; principal: { userId: string; assuranceLevel: 'aal2' } }
  | { kind: 'invalid_session' }
  | { kind: 'step_up_required' }
  | { kind: 'authentication_unavailable' };

type PrivilegedDashboardSessionVerifier = (
  authorization: unknown,
) => Promise<PrivilegedDashboardSessionResult>;

function createPrivilegedDashboardSessionVerifier(
  options: DashboardSessionVerifierOptions,
): PrivilegedDashboardSessionVerifier;
```

`DashboardSessionVerifierOptions` and its transport semantics are reused from A6. The privileged verifier performs the same one online `/auth/v1/user` request before reading `sub`/`aal` from the already-validated access token.

Credential verifier generation:

```ts
function createCredentialSecretVerifier(
  secret: string,
  options?: { readonly salt?: Buffer },
): Promise<string>;
```

When `salt` is omitted, production uses 16 CSPRNG bytes. When supplied, it must be exactly 16 bytes and exists only to make contract tests deterministic. Output is the exact A1 `scrypt-v1` representation.

Credential material:

```ts
interface ApiCredentialMaterial {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly secretVerifier: string;
}

function generateApiCredentialMaterial(
  environment: 'sandbox' | 'production',
  options?: {
    readonly randomBytes?: (size: number) => Buffer;
    readonly verifierFactory?: (secret: string) => Promise<string>;
  },
): Promise<ApiCredentialMaterial>;
```

The injected functions are test seams only. Defaults are Node CSPRNG + `createCredentialSecretVerifier`.

## DB package export

```ts
function createDashboardApiCredentialStore(pool: RuntimePool): DashboardApiCredentialStore;
```

```ts
interface DashboardApiCredentialStore {
  list(input: { userId: string; merchantId: string; environment: Environment }): Promise<readonly ApiCredential[]>;
  get(input: { userId: string; merchantId: string; environment: Environment; credentialId: string }): Promise<ApiCredential | null>;
  create(input: MutationCommand): Promise<Record<string, unknown>>;
  rotateSecret(input: MutationCommand & { credentialId: string }): Promise<Record<string, unknown>>;
  revoke(input: MutationCommand & { credentialId: string }): Promise<Record<string, unknown>>;
}

interface MutationCommand {
  userId: string;
  merchantId: string;
  environment: Environment;
  idempotencyKey: string;
  requestHash: string;
  command: Record<string, unknown>;
}
```

The store may call only the five frozen A8 trusted routines and performs no direct protected-table SQL.

## Auth management-service export

```ts
function createDashboardApiCredentialManagementService(options: {
  ordinarySessionVerifier: DashboardSessionVerifier;
  privilegedSessionVerifier: PrivilegedDashboardSessionVerifier;
  contextStore: DashboardMerchantContextStore;
  store: DashboardApiCredentialStore;
  materialFactory?: (environment: Environment) => Promise<ApiCredentialMaterial>;
  idFactory?: () => string;
}): DashboardApiCredentialManagementService;
```

```ts
interface DashboardApiCredentialManagementService {
  list(input: { authorization?: string; merchantId: string; environment: string }): Promise<Record<string, unknown>>;
  get(input: { authorization?: string; merchantId: string; environment: string; credentialId: string }): Promise<Record<string, unknown>>;
  create(input: { authorization?: string; merchantId: string; environment: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  rotateSecret(input: { authorization?: string; merchantId: string; environment: string; credentialId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  revoke(input: { authorization?: string; merchantId: string; environment: string; credentialId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
}
```

Reads MUST use only `ordinarySessionVerifier`; mutations MUST use only `privilegedSessionVerifier`.

## Fastify composition contract

`BuildAppOptions` gains one optional service:

```ts
readonly dashboardApiCredentials?: DashboardApiCredentialManagementService;
```

Fastify exposes exactly the five routes frozen in the YAML spec. It maps `step_up_required` to HTTP 403 with public error code `step_up_required`; it does not expose the dashboard Bearer token or secret verifier in any response/log.

Create first success is 201; create replay is 200; rotate/revoke success and replay are 200. List returns `{ object: 'list', data: [...] }`.
