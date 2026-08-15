# K1 — KYC private Storage verification

Date: 2026-08-14 (America/Santarem)
Canonical Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
Branch: `agent/foundation-phase-0`

## Contract

Specification: `docs/specs/kyc-private-storage-v0.yaml`

K1 establishes only the private Storage boundary for KYC evidence. It does not implement merchant/admin upload authorization, signed URLs, compliance MIME requirements, malware scanning, review workflow or retention jobs.

## TDD evidence

### Valid RED

Commit: `48d597972dfc3dc0b78bcccd008b0d4eac95e2e1`
GitHub Actions run: `97` (`31858331750`)

Result:

- previous suites `001`–`022`: PASS;
- `023_kyc_private_storage.test.sql`: 44 assertions executed completely;
- 28/44 assertions failed only because the KYC bucket/restrictive policies were absent and broad permissive probe policies could therefore reach KYC metadata;
- aggregate: **23 files / 778 tests / FAIL**.

An earlier attempted RED was discarded because direct SQL DELETE against managed Storage metadata triggered `storage.protect_delete()`. The specification/test were corrected instead of bypassing the platform protection.

### GREEN

Migration: `supabase/migrations/20260815021111_kyc_private_storage.sql`
Commit: `a0d71e5b64a0bb20b762df110e8a0c15f6d91ce5`
GitHub Actions run: `98` (`31858542521`)

Result:

- `001`–`023`: PASS;
- **23 files / 778 tests / PASS**.

The GREEN migration introduces exactly:

- one `kyc-evidence` private bucket;
- 10 MiB bucket file-size limit;
- no invented MIME allowlist;
- four `AS RESTRICTIVE` fences on `storage.buckets` for SELECT/INSERT/UPDATE/DELETE;
- four `AS RESTRICTIVE` fences on `storage.objects` for SELECT/INSERT/UPDATE/DELETE;
- roles scoped to `anon` and `authenticated`;
- no permissive KYC policy;
- no privileged helper function;
- no modification/removal of managed Storage triggers/functions/tables.

The pgTAP suite temporarily creates broad permissive SELECT/INSERT/UPDATE policies and proves that the KYC restrictive fences still deny KYC access/mutation while non-KYC probe rows remain governable by their own permissive policies.

DELETE fences are verified structurally because current managed Storage deliberately rejects direct SQL DELETE of `storage.buckets`/`storage.objects` using `storage.protect_delete()`; runtime file deletion belongs to the Storage API.

## Canonical managed Supabase deployment

The GREEN SQL was applied to `swiftpay v2` after CI passed.

The connector initially recorded the deployment as version `20260815021341`; migration history was normalized immediately to the repository version:

`20260815021111 | kyc_private_storage`

Remote verification proved:

- `storage.buckets.id = 'kyc-evidence'` exists;
- `public = false`;
- `file_size_limit = 10485760`;
- `allowed_mime_types IS NULL`;
- RLS remains enabled on both `storage.buckets` and `storage.objects`;
- exactly 8 SwiftPay KYC policies exist;
- every policy is `RESTRICTIVE`;
- every policy targets `anon` + `authenticated`;
- bucket predicates explicitly exclude `id = 'kyc-evidence'`;
- object predicates explicitly exclude `bucket_id = 'kyc-evidence'`.

Supabase Security Advisor after deployment: **0 security lints**.

## Boundary retained for later slices

K1 does not grant browser KYC access. The future trusted backend must authorize merchant/case/purpose/version, mint opaque object paths, perform Storage API operations with server-side capability, validate detected content, attach the result to `app.kyc_documents`, and audit privileged access. Submitted evidence replacement remains new-version/new-path rather than overwrite.
