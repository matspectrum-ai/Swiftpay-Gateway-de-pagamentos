# Legacy KYC, Onboarding and Sensitive Document Storage

Status: core audit complete; V2 contract required before implementation

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Scope

This audit covers the merchant onboarding/KYC lifecycle, required KYC fields, complement/review workflow, sensitive document upload/storage/access and the relationship between KYC approval and financial capabilities.

It does not define Brazilian regulatory minimums. The legacy code is evidence of current product behavior, not a legal source. Final KYC requirements must be approved from compliance/business/provider requirements.

## Legacy KYC data model

`MerchantKyc` stores:

- legal name and CPF/CNPJ;
- RG/CNH identity-document data;
- business description, website, monthly revenue and average ticket;
- operation classification;
- selected payment methods;
- admin notes/rejection/approval reasons;
- references to proof of address, document front/back, selfie, CNPJ card and company contract files.

The legacy onboarding validator requires a broad set of personal/business data and documents. Some requirements are tied to card/boleto behavior and should not automatically survive a Pix-only rebuild.

## Critical lifecycle finding: merchant becomes Active before KYC approval

Submitting a complete onboarding changes the merchant from:

```text
MerchantStatus = Draft
KycStatus      = Draft
```

to:

```text
MerchantStatus = Active
KycStatus      = Pending
```

before an administrator approves KYC.

Admin approval later sets `KycStatus = Approved` and again sets the merchant `Active`; rejection moves the merchant back to `Draft`; complement keeps the merchant active while changing KYC to `Complement`.

### Financial capability consequence

The audited financial/auth boundaries authorize primarily from `MerchantStatus.Active`:

- direct API-credential creation requires only `MerchantStatus.Active`;
- token issuance checks credential status and merchant status, not KYC status;
- credential validation on payment requests checks merchant status, not KYC status;
- transaction creation has no additional KYC gate in the audited service path;
- cashout merchant validation requires only `MerchantStatus.Active`.

Therefore a merchant with `KycStatus = Pending` can reach the production API-credential/payment boundary once the merchant has been marked Active by onboarding submission. The cashout service also lacks an independent approved-KYC check.

This is a boundary defect. Frontend navigation restrictions are not an authorization control.

## V2 lifecycle requirement

Do not overload one merchant status with onboarding, compliance and financial authorization.

Recommended conceptual separation:

```text
merchant.lifecycle_status
  draft | active | suspended | closed

kyc_case.status
  draft
    -> submitted
    -> under_review
    -> needs_information -> under_review
    -> approved
    -> rejected

financial_capabilities
  production_payments = merchant active AND kyc approved
  production_payouts  = merchant active AND kyc approved AND payout policy allows
```

Sandbox permissions may have a separate explicit contract; they must not implicitly grant production capability.

## KYC complement/review workflow

Legacy KYC can create field-specific pending items. A merchant can respond to a pending item, and when no items remain `Pending`, the case moves back to `UnderReview` after full onboarding validation.

An admin evaluates each responded item as `Approved` or `Rejected`.

### Final-decision gap

The final KYC evaluation endpoint blocks the final decision only while an item is in `Responded` state. A complement item already marked `Rejected` is not considered an unevaluated item by that check.

A final KYC approval can therefore be attempted while a rejected complement item remains in the case. V2 must define explicit case-level completion rules: approval is impossible while any required review item is unresolved or rejected unless that rejection has been superseded by a new accepted submission.

## Legacy storage architecture

Sensitive KYC files share the same generic upload/storage abstraction as product assets, avatars, templates, checkout assets and other files.

`StoredFile` records object name, original filename, declared content type, size, visibility, generic folder, owner UUID, uploader UUID and cached/presigned URL metadata.

The S3-compatible storage service stores objects under a generic shape similar to:

```text
public|private/{folder}/{ownerId}/{uuid}.{extension}
```

Private objects receive presigned URLs. The common path frequently uses a 12-hour URL lifetime.

## Critical storage finding: requester controls KYC public visibility

The merchant upload request contains both:

- `Folder`, including `Kyc`;
- `IsPublic`.

The server verifies that the merchant belongs to the caller but then forwards the requested folder and visibility to storage. If `IsPublic = true`, the storage service applies `PublicRead`.

Consequently the server does not enforce the invariant that a KYC document is always private.

V2 must never expose a requester-controlled `public` switch for KYC material.

## File-type validation weakness

Legacy merchant upload validation checks:

- maximum size of 10 MB;
- filename extension among JPG/JPEG/PNG/PDF/WEBP.

No content-signature/magic-byte verification was observed in the audited path. The supplied content type is also persisted/passed to object storage.

V2 must validate detected file type independently from the filename and reject type mismatches. Malware/content scanning should be part of the sensitive-document ingestion policy where operationally appropriate.

## Critical authorization finding: arbitrary StoredFile IDs can be attached to KYC

`UpdateMerchant` accepts KYC document IDs as UUIDs and assigns them directly to `MerchantKyc`.

The audited update path does not prove that the referenced file:

- belongs to the same merchant;
- was uploaded by an allowed actor;
- has `Folder = Kyc`;
- is private;
- was created for the expected KYC document purpose.

The normal merchant read path later loads the attached `StoredFile` relationships and the mapper generates/refreshes a URL directly for each attached file without re-checking `StoredFile.OwnerId`.

Therefore there is a cross-tenant authorization gap: if a foreign `StoredFile` UUID is known or otherwise obtained, it can plausibly be bound to another merchant's KYC record and then returned through that merchant's authenticated read path as a signed URL.

UUID unpredictability is not authorization.

V2 must bind sensitive-file ownership/purpose at upload time and validate the complete ownership tuple when attaching or replacing a document.

## Evidence mutability after submission

The generic file-delete endpoint authorizes an admin, uploader or merchant owner. It has no KYC-case-state restriction.

For proof of address, document front, document back and selfie, the audited EF mapping uses `DeleteBehavior.SetNull` from `MerchantKyc` to `StoredFile`.

Thus at least these submitted KYC evidence references can be removed after submission through the generic file deletion path, leaving the KYC record with null document references while review state remains separate.

Submitted compliance evidence must not be mutable in place.

## V2 storage design

Use separate storage classes rather than a generic visibility switch.

Recommended shape:

```text
Supabase Storage
├── merchant-public
│   └── logos / checkout assets / other explicitly public media
└── kyc-private
    └── merchant_id / kyc_case_id / document_id / version
```

`kyc-private` invariants:

1. bucket is private; no public ACL/path mode;
2. every object is bound to merchant, case, purpose and document version;
3. upload is authorized by trusted backend logic or a tightly scoped short-lived upload grant;
4. filename extension is not trusted for type validation;
5. metadata stores detected MIME, byte size and content hash;
6. document access is authorized before a short-lived signed download URL is minted;
7. submitted document versions are immutable;
8. replacement creates a new version rather than mutating/deleting accepted evidence;
9. retention/deletion is an explicit policy, not a generic file endpoint;
10. admin access is audited.

A five-minute signed download URL is a better default for KYC review than the legacy multi-hour generic URL, subject to final admin UX requirements.

## Minimal V2 KYC model

A much smaller model can preserve the necessary semantics:

### `kyc_cases`

- id
- merchant_id
- status
- submitted_at
- decided_at
- decision_reason
- reviewed_by
- created_at / updated_at

### `kyc_documents`

- id
- kyc_case_id
- merchant_id
- purpose
- version
- storage_path
- original_filename
- detected_mime_type
- size_bytes
- sha256
- status (`uploaded`, `submitted`, `accepted`, `rejected`, optionally `quarantined`)
- uploaded_by
- created_at

### `kyc_review_requests`

- id
- kyc_case_id
- field/document purpose
- message
- status (`open`, `responded`, `accepted`, `rejected`, `superseded`)
- requested_by
- responded_at / resolved_at

### `kyc_audit_events`

Append-only event record for submission, evidence replacement, request-for-information, review and final decision.

## V2 security/contract requirements

1. Production financial actions require an approved KYC case in trusted backend authorization.
2. KYC approval is independent from the merchant's general lifecycle state.
3. Sensitive KYC objects are never public.
4. A file ID cannot be attached across tenants or purposes.
5. Submitted evidence is versioned and immutable.
6. No final approval while required review requests are rejected/unresolved.
7. Admin decisions record actor, reason, time and evidence version set.
8. KYC document reads generate short-lived signed URLs only after authorization.
9. Upload validation uses detected content type, not only extension/declared MIME.
10. RLS/storage policies fail closed; service-role access remains server-side and narrowly scoped.
11. The V2 Pix-only required-field set must be separately approved from compliance/provider requirements rather than copied from legacy card/boleto onboarding.

## Reconstruction implication

Supabase Auth + PostgreSQL + private Supabase Storage fit this boundary well, but RLS/storage policies are defense in depth, not a substitute for application authorization.

The V2 can be materially smaller than legacy KYC while being safer: one case state machine, versioned private evidence, explicit review requests and a single server-side financial-capability gate.