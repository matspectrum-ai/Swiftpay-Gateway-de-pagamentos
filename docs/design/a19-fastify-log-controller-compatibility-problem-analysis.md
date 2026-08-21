# A19 — Fastify LogController Compatibility — Problem Analysis

Status: **PROBLEM_ANALYSIS**  
Date: 2026-08-19

## Problem

A12 deliberately disables Fastify's automatic request logging and owns HTTP completion logging through SwiftPay's closed-schema `@swiftpay/observability` boundary. The current API constructs Fastify 5.11.0 with the deprecated top-level `disableRequestLogging: true` option.

Fastify's current contract deprecates that top-level option and requires the equivalent authority to move under a `LogController` instance supplied through `logController`. The top-level option is scheduled for removal in Fastify 6.

Leaving the deprecated option in place creates a known runtime compatibility warning (`FSTDEP023`) and an avoidable future upgrade blocker. Suppressing the warning would hide, not remove, the incompatibility.

## Current SwiftPay authority

`apps/api/src/app.ts` currently constructs Fastify with:

- `logger: false`;
- top-level `disableRequestLogging: true`;
- `requestIdHeader: false`;
- server-owned UUIDv4 `genReqId`.

A12 separately owns safe request-completion events. A13 separately owns bounded HTTP/readiness metrics. Neither boundary may be widened or delegated to Fastify/Pino by this compatibility slice.

## Required change boundary

A19 must do exactly one compatibility migration:

- remove the top-level `disableRequestLogging` option;
- construct a Fastify `LogController` with `disableRequestLogging: true`;
- pass that instance as `logController`.

A19 must preserve `logger: false`, request-ID ownership, custom A12 completion logging, A13 metric behavior and all public HTTP behavior.

## Risks

1. Enabling Fastify/Pino logging while migrating would create a second observability authority and could expose URL/header/body data outside A12's closed schema.
2. Removing request-log suppression without replacing it changes Fastify internal logging/error behavior if logging is later enabled.
3. Overriding `LogController` lifecycle methods would create unnecessary coupling to Fastify internals and could silently bypass `disableRequestLogging` semantics.
4. Warning suppression (`--no-deprecation`, `NODE_NO_WARNINGS`, warning filters) would leave the deprecated runtime contract intact.
5. Broad Fastify upgrades in the same slice would make compatibility behavior non-isolatable.

## Constraints

- Fastify remains pinned at 5.11.0 in A19.
- No dependency upgrade.
- No route, status, schema, authentication, rate-limit, provider or financial behavior change.
- No Supabase migration or hosted database change.
- No worker change.
- No logger enablement.
- No custom `LogController` subclass or method overrides unless a frozen test proves the stock controller cannot preserve A12; current evidence gives no reason to authorize such an override.
- No warning suppression mechanism.

## Verification strategy

A19 requires fail-first application tests that prove the present source still uses the deprecated top-level option, then require:

- `LogController` import/use;
- `logController: new LogController({ disableRequestLogging: true })` equivalent structure;
- absence of the top-level option;
- no `FSTDEP023` when constructing/closing the app under Node deprecation-as-error semantics;
- unchanged A12 request IDs and exactly-one safe completion event behavior;
- unchanged A13 metrics and existing full application regression.

No implementation authority exists until the YAML specification, contract and RED test are frozen.
