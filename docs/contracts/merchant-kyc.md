# SwiftPay V2 — Merchant Lifecycle and KYC Contract

Status: Phase 1 contract; exact regulatory/provider field set remains external evidence

## Separation of concerns

```text
merchant.lifecycle_status = draft | active | suspended | closed
kyc_case.status = draft | submitted | under_review | needs_information | approved | rejected
```

`merchant = active` does not by itself grant Production financial capability.

## Production capability

Trusted server-side authorization requires at least:

```text
create Production Pix = merchant active AND KYC approved AND Pix policy enabled
create Production payout = merchant active AND KYC approved AND payout policy enabled
```

API credentials/tokens and frontend navigation cannot bypass this check. Sandbox is a separate capability and never implies Production access.

Suspension removes new Production financial capability immediately. Existing provider events, payout/refund recovery and reconciliation must still be processed so real money movement is not ignored.

## KYC review

Typical flow:

```text
draft -> submitted -> under_review
under_review -> approved | rejected | needs_information
needs_information -> submitted/under_review
```

Final approval is forbidden while a required review item is unresolved or rejected unless that item has been superseded by accepted replacement evidence.

Approval records reviewer, time, reason, requirement-profile version and exact evidence versions.

## Minimal model

```text
merchants
merchant_members
kyc_cases
kyc_documents
kyc_review_requests
kyc_audit_events
```

KYC requirements are versioned. Do not automatically copy the legacy card/boleto field set into Pix-first V2; the final field/document set must come from approved compliance/business/retained-provider requirements.

## KYC evidence

KYC documents use a dedicated private storage class/bucket.

Hard invariants:

- KYC objects are never public;
- browser/merchant cannot choose a public ACL for KYC;
- object is bound to merchant + case + purpose + version;
- file attachment validates ownership and purpose;
- submitted evidence versions are immutable;
- replacement creates a new version;
- generic file-delete APIs cannot erase submitted evidence;
- signed download URLs are short-lived and minted only after authorization;
- admin access is audited.

`kyc_documents` records at least storage path, purpose/version, detected MIME, size, content hash, status and uploader.

Filename extension or declared MIME alone is not trusted; detected content type must match an approved format.

## Review requests

A review request is first-class:

```text
open -> responded -> accepted
                  -> rejected -> superseded when a new accepted response replaces it
```

Responses create/reference new evidence versions instead of mutating old submitted evidence.

## Audit and access

KYC decisions/evidence changes are append-audited with actor, merchant/case, action, reason and timestamp. Sensitive document bytes/secret URLs are not copied into audit payloads.

Supabase RLS/private Storage policies fail closed, but trusted backend authorization remains the decision boundary. Browser clients never receive service-role capability.

## Required fail-first tests

1. active merchant + pending KYC cannot create Production Pix;
2. active + approved KYC can reach enabled Production Pix capability;
3. approved KYC + suspended merchant cannot create Pix/payout;
4. existing API token cannot bypass later suspension/KYC capability loss;
5. Sandbox cannot cross into Production;
6. foreign-merchant file cannot attach to KYC;
7. public/non-KYC asset cannot attach as KYC evidence;
8. submitted evidence cannot be mutated/deleted through generic file APIs;
9. replacement creates a new immutable version;
10. final approval fails while required review item is unresolved/rejected;
11. approval records the exact evidence set and reviewer decision;
12. unauthorized actor cannot mint KYC signed URL;
13. content-type mismatch is rejected;
14. suspension does not suppress legitimate terminal provider/ledger events;
15. browser/RLS mutation of KYC decision/audit state fails closed.

## External evidence before Production

Approve the actual Brazilian compliance/legal KYC minimums, retained-provider/submerchant requirements, evidence retention policy and review roles. These may refine required fields but cannot weaken private storage, tenant binding, evidence immutability or the Production KYC gate.