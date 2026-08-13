# Accithus vs MagicPay — First Provider Proof

Status: source-level proof complete; live contract/sandbox conformance required before RETAIN

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Decision

MagicPay is the **first Pix-in proof candidate** for SwiftPay V2. It is not yet `RETAIN`.

Accithus remains the stronger first Pix-out proof candidate because the inspected withdrawal call sends an explicit `Idempotency-Key` derived from SwiftPay `PayoutId`.

Promotion to `RETAIN` requires provider-contract or sandbox evidence, not source-code assumption.

## MagicPay — Pix-in

Positive evidence:

- create sends integer cents and a SwiftPay-generated `ExternalRef`;
- payer is optional in the inspected request path, so V2 does not need fabricated customer identity;
- provider response has its own payment `Id` and echoes `ExternalRef`;
- webhook envelope has a first-class `id`, `type` and timestamp;
- webhook group uses the shared authentication preprocessor;
- MagicPay HMAC verification uses `X-Signature` over raw request bytes;
- provider payment status can also arrive through authenticated webhook evidence.

Critical unresolved point:

The legacy service creates a local `txId`, sends it as `ExternalRef`, stores the provider response `Id` separately, then later calls:

```text
GET /payment/{txId}
```

where `{txId}` is the local `ExternalRef`.

The inspected client names that path argument `paymentId`. No source test proves that MagicPay accepts `ExternalRef` in the path.

Therefore V2 must prove one of these before enabling recovery:

```text
A. GET /payment/{externalRef} is supported
B. another query-by-externalRef endpoint exists
C. create with identical ExternalRef is provider-idempotent
D. webhook/reconciliation provides deterministic recovery from ExternalRef
```

If none is true, a timeout after create remains operationally unsafe for automatic retry/fallback.

### MagicPay provisional capability

```text
Pix-in create:              PROVE
stable client correlation:  YES (ExternalRef)
provider event identity:    YES (webhook id)
webhook authentication:     YES (HMAC source implementation)
create idempotency:         UNPROVEN
query by client reference:  UNPROVEN
unknown-result recovery:    UNPROVEN until query/dedupe test passes
synthetic customer data:    NOT REQUIRED by inspected Pix request path
```

## MagicPay — Pix-out

Legacy sends stable:

```text
ExternalRef = PAYOUT{PayoutId}
```

but no explicit `Idempotency-Key` header was observed.

The client exposes `GET /transfer/{transferId}`. Source code does not prove that the transfer endpoint deduplicates by `ExternalRef` or that query accepts `ExternalRef`.

Result:

```text
Pix-out: PROVE, not RETAIN
```

Do not blind-retry a transfer timeout.

## MagicPay — refunds

The concrete client contains:

```text
POST /payment/{paymentId}/refund
```

with no amount body in the inspected method. This suggests only a full-refund invocation at this boundary, but the provider contract must prove actual semantics.

No inspected idempotency key or explicit refund recovery call was found, and the method was not wired into the generic production refund execution path audited earlier.

Result:

```text
refund: PROVE, not RETAIN
```

Required proof includes full/partial support, stable refund identity, duplicate behavior and ambiguous-result recovery.

## Accithus — Pix-in

Positive evidence:

- provider create returns provider `id`, `tx_id` and Pix payload;
- status GET exists;
- webhook group uses shared auth preprocessor;
- default provider metadata configures HMAC-SHA256 authentication;
- webhook carries provider object IDs and refund amount/status fields.

Blocking evidence:

- inspected create request has no external/client reference field;
- no create idempotency header was observed;
- webhook envelope is only `event + data` and has no first-class event ID;
- legacy service fabricates missing customer name/email/CPF;
- generic client exception handling collapses network uncertainty into ordinary failure.

V2 must never preserve the fabricated customer fields.

Without a provider-documented recovery reference, a create timeout cannot authorize another create automatically.

### Accithus provisional capability

```text
Pix-in create:              PROVE_LATER
stable client correlation:  NOT OBSERVED in create request
provider event identity:    fingerprint required unless provider exposes more evidence
webhook authentication:     YES (configured HMAC path)
create idempotency:         UNPROVEN
unknown-result recovery:    WEAK from inspected source
customer requirements:      must be proven without synthetic identity
```

## Accithus — Pix-out

Legacy withdrawal explicitly sends:

```text
Idempotency-Key: <PayoutId>
```

This is the strongest source-level payout-idempotency signal among these two providers.

However, the fact that the header is sent does not prove the PSP honors it. Conformance must verify repeated same-key requests return/refer to one external payout.

Result:

```text
Pix-out: STRONG_FIRST_PROOF_CANDIDATE
```

## First conformance sequence

### MagicPay Pix-in

1. create a Pix with a known unique `ExternalRef`;
2. record returned provider `Id` and echoed `ExternalRef`;
3. query by provider `Id`;
4. query/recover by `ExternalRef` using supported provider contract;
5. repeat create with exactly the same `ExternalRef` in safe sandbox and observe whether provider deduplicates or creates a second charge;
6. simulate/induce client timeout only in an approved non-production environment and verify deterministic recovery;
7. verify webhook `id` stability on redelivery;
8. verify invalid HMAC cannot be accepted;
9. verify a paid event resolves the same ProviderAttempt after an uncertain create response.

MagicPay becomes Pix-in `RETAIN` only if recovery is deterministic enough to satisfy `native-pix-provider-adapter.md`.

### Accithus Pix-out

1. create a safe sandbox/test payout with stable SwiftPay payout ID;
2. repeat same operation using the same `Idempotency-Key` under the provider-approved test process;
3. prove one external payout identity/effect;
4. prove status/recovery query after timeout;
5. verify terminal webhook authentication and identity mapping.

Accithus becomes Pix-out `RETAIN` only after that evidence.

## Fallback decision

If MagicPay cannot prove recovery or provider-side dedupe for Pix-in, do not weaken SwiftPay's safety contract to fit it.

The next provider is evaluated under the same conformance suite. Accithus may then be reconsidered for Pix-in only if its current provider contract exposes a safe correlation/recovery primitive not represented by the legacy request model.

## Architectural consequence

The first provider is chosen by recoverability, not by how easy the happy-path POST is.

No provider may force the Payment Core to convert:

```text
unknown external result -> definitive failure
```

or to fabricate customer identity, silently retry monetary POSTs, or use amount as an event/refund identity.