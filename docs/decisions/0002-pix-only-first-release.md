# ADR 0002 — First Release Is Pix-Only

Status: Accepted

Date: 2026-08-13

## Context

The legacy platform supports Pix, boleto and credit card. Multi-method support expands domain models, pricing matrices, provider capabilities, settlement behavior, testing and regulatory/security surface.

The reconstruction goal is a substantially simpler payment platform, and Pix is the required initial payment method.

## Decision

SwiftPay V2 first release supports Pix only.

Credit card and boleto are not implemented as disabled branches in generic payment models. Their fields, fee matrices and provider capabilities are excluded from the initial schema and application contracts.

## Consequences

### Remove from initial system

- card number/CVV/expiry data;
- PCI-related payment data handling;
- installments;
- card-specific statuses/fees;
- boleto due-date/instruction model;
- boleto-specific fees/compensation;
- generic payment-method factories whose only value is supporting absent methods.

### Preserve extension ability

The architecture should avoid choices that make a future second payment method impossible, but future-proofing must not recreate current multi-method complexity prematurely.

A future method requires a new ADR, contracts and migrations.

## Rationale

Pix-only lets the first V2 focus engineering effort on the difficult invariants that remain even with one method:

- provider integration;
- idempotency;
- webhook ordering;
- ledger;
- balances;
- fees;
- payouts;
- KYC;
- reconciliation;
- tenant/security boundaries.

## Migration consequence

Legacy boleto/card records may be migrated only as historical/archive data if needed for reporting. They do not imply V2 runtime support.