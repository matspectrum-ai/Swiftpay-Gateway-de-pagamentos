# SwiftPay V2 — A28 MagicPay Provider Contract Evidence — Problem Analysis

Status: Problem Analysis / evidence acquisition only
Date: 2026-09-03 (America/Santarem)
Branch: `agent/a28-magicpay-provider-contract-evidence`

## Problem

SwiftPay V2 now has canonical A25/A26/A27 hosted database/runtime evidence, but retained PSP Production authority remains intentionally zero under A5 fixture-only + A10 default-deny + A11 unbound strict transport.

A MagicPay credential set and the provider documentation entry point have been supplied out-of-repository for evaluation:

`https://app.dashboardmagicpay.com/docs/intro/first-steps`

The credential values are deliberately not recorded here, in Git history, CI, screenshots, logs, fixtures or durable evidence.

At the time of this analysis, the documentation URL is reachable through the available web retrieval path but exposes no crawlable page content, and targeted public search does not yield provider-owned endpoint/authentication/Pix contract pages. Therefore the executable MagicPay contract is not yet evidenced strongly enough to authorize adapter implementation or authenticated monetary calls.

## Why credential shape is not contract evidence

The supplied credential set contains conceptually distinct public/secret/withdrawal material. SwiftPay already has an unrelated retained provider fixture whose credential model has a superficially similar shape.

That similarity MUST NOT be used to infer that MagicPay shares the same:

- API base URL;
- HTTP authentication scheme;
- resource paths;
- request/response payloads;
- amount unit;
- idempotency behavior;
- status vocabulary;
- webhook model;
- withdrawal semantics;
- error semantics.

Doing so would turn an unverified resemblance into Production authority and could create duplicate or ambiguous monetary execution.

## Authority boundary

A28 is an evidence-acquisition slice only.

Until the provider-owned contract is recovered and frozen:

- MagicPay is not added to the A10 active-provider registry;
- no live monetary operation is authorized;
- no Pix charge creation is used as a discovery probe;
- no withdrawal is used as a discovery probe;
- no provider credential is committed to source control;
- no credential is exposed to browser code;
- no credential is written to ordinary application logs;
- no existing AkkadPag/FlevoPay fixture adapter is relabeled or reused as MagicPay;
- ambiguous execution cannot be converted into definitive failure.

## Evidence required before Spec/TDD freeze

A28 requires provider-owned/current evidence for all of the following.

### 1. Environment and host

- Production base URL;
- Sandbox/homologation base URL, if one exists;
- whether the supplied account/credentials are Sandbox, Production or environment-agnostic;
- TLS requirements and any IP allowlist requirements.

### 2. Authentication

- exact headers/auth scheme for normal API requests;
- exact role of public credential material;
- exact role of secret credential material;
- whether withdrawal credential material is used only for cash-out;
- credential rotation/revocation semantics.

### 3. Pix cash-in/create

- HTTP method and path;
- exact amount representation and currency semantics;
- required payer/customer fields;
- external/idempotency identifier semantics;
- webhook/callback field, if per-transaction;
- success response including provider payment identifier, txId, copy-and-paste and expiration;
- duplicate-key/retry semantics;
- validation and rate-limit responses.

### 4. Pix query/recovery

- query-by-provider-id and/or query-by-external-id contract;
- exact provider statuses;
- mapping of pending/paid/failed/cancelled/refunded/expired states;
- behavior after connection timeout or 5xx during create;
- whether a safe reconciliation query can determine if an ambiguous create actually executed.

This evidence is mandatory for SwiftPay's `execution_unknown` invariant.

### 5. Webhooks

- event types;
- payload schema;
- event/replay identifier;
- authentication/signature method;
- signing secret/key lifecycle;
- retry schedule;
- acknowledgement requirements;
- ordering/duplicate guarantees.

### 6. Cash-out/withdrawal

Cash-out is not part of the first Pix charge bridge and remains independently gated.

Before any withdrawal support:

- exact withdrawal endpoint and credential/header contract;
- destination Pix key/account semantics;
- idempotency/replay behavior;
- query/recovery semantics;
- status vocabulary;
- rate limits and operational constraints

must be evidenced separately.

## First authenticated proof after documentation closes

The first authenticated request MUST be non-destructive and explicitly documented by MagicPay, such as an account/profile/status/balance/read-only endpoint if available.

Only after that proof succeeds and the environment is classified may a dedicated Sandbox/homologation Pix create smoke be considered. If the provider exposes Production only, the first monetary smoke requires a separately frozen minimal-value test contract and explicit authority; it is not part of evidence discovery.

## Expected implementation sequence after evidence

Once the provider contract is sufficiently evidenced:

1. freeze A28 YAML spec and provider contract;
2. add fail-first provider adapter tests;
3. implement a dedicated `magicpay` adapter without changing A10 activation;
4. bind it to A11 strict HTTPS transport;
5. prove deterministic mapping and `execution_unknown` behavior;
6. prove authenticated non-destructive environment access;
7. prove Sandbox/homologation create/query if available;
8. design webhook ingress/replay verification;
9. only then propose a deliberate A10 activation transition.

## Current conclusion

The supplied credentials are sufficient input for later authenticated testing, but they are not sufficient evidence to safely implement or activate MagicPay today. The immediate blocker is extraction/verification of the provider-owned API contract, not missing credentials.
