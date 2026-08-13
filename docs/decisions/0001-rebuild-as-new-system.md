# ADR 0001 — Rebuild SwiftPay as a New System

Status: Accepted

Date: 2026-08-13

## Context

The legacy SwiftPay repository contains a broad payment/business platform with multiple APIs, infrastructure services, payment methods and product domains. The reconstruction goal is not a cosmetic refactor. It is to produce a materially simpler SwiftPay centered on the retained payment business.

A rewrite-in-place would force the new architecture to inherit existing module boundaries, migrations, infrastructure assumptions and broad feature coupling before those choices are re-evaluated.

## Decision

Build SwiftPay V2 in a separate repository:

`matspectrum-ai/Swiftpay-Gateway-de-pagamentos`

Treat the legacy repository:

`SwiftPay-Prod/swiftpay---Prod`

as behavioral evidence and migration source, not as the implementation template.

The legacy production system remains untouched during V2 reconstruction unless a separate migration/cutover change is explicitly approved.

## Consequences

### Positive

- architecture can be reduced deliberately;
- feature removal does not require maintaining legacy abstractions;
- migration can be tested independently;
- rollback remains possible until cutover;
- legacy behavior can be converted into contracts/tests rather than copied mechanically.

### Negative

- migration tooling will be required;
- some behavior must be reimplemented rather than refactored;
- temporary duplication of systems is expected;
- compatibility decisions must be explicit.

## Constraints

- no production cutover before retained financial behavior is verified;
- no claim of parity without contract evidence;
- no direct database sharing as an architectural shortcut unless separately approved;
- every retained legacy capability must have a V2 decision.