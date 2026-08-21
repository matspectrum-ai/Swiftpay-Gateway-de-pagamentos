create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(20);

-- Deterministic Auth identity anchor.
select is(
    (select count(*) from auth.users where id = '51000000-0000-0000-0000-000000000001'::uuid),
    1::bigint,
    'K5 synthetic Auth identity exists exactly once'
);
select is(
    (select email from auth.users where id = '51000000-0000-0000-0000-000000000001'::uuid),
    'local-sandbox-owner@example.test',
    'K5 synthetic Auth identity uses recognizable example.test email'
);
select ok(
    (select not is_anonymous and deleted_at is null from auth.users where id = '51000000-0000-0000-0000-000000000001'::uuid),
    'K5 synthetic Auth identity is non-anonymous and not deleted'
);

-- Canonical local merchant context.
select is(
    (select count(*) from app.merchants where id = '50000000-0000-0000-0000-000000000001'::uuid),
    1::bigint,
    'K5 local sandbox merchant exists exactly once'
);
select is(
    (select name || '|' || lifecycle_status from app.merchants where id = '50000000-0000-0000-0000-000000000001'::uuid),
    'SwiftPay Local Sandbox Merchant|active',
    'K5 merchant has canonical active fixture state'
);
select is(
    (select count(*) from app.merchant_members
      where merchant_id = '50000000-0000-0000-0000-000000000001'::uuid
        and user_id = '51000000-0000-0000-0000-000000000001'::uuid),
    1::bigint,
    'K5 owner membership exists exactly once'
);
select is(
    (select role || '|' || status from app.merchant_members
      where merchant_id = '50000000-0000-0000-0000-000000000001'::uuid
        and user_id = '51000000-0000-0000-0000-000000000001'::uuid),
    'owner|active',
    'K5 membership is active owner'
);

-- Approved KYC state without document/storage fabrication.
select is(
    (select count(*) from app.kyc_cases where id = '52000000-0000-0000-0000-000000000001'::uuid),
    1::bigint,
    'K5 approved KYC case exists exactly once'
);
select is(
    (select merchant_id::text || '|' || status || '|' || requirement_profile_version
       from app.kyc_cases where id = '52000000-0000-0000-0000-000000000001'::uuid),
    '50000000-0000-0000-0000-000000000001|approved|local-sandbox-v1',
    'K5 KYC case is bound to local merchant and approved'
);
select is((select count(*) from app.kyc_documents), 0::bigint, 'K5 fixture creates no KYC document metadata');
select is((select count(*) from storage.objects), 0::bigint, 'K5 fixture creates no Storage objects');

-- Frozen provider catalog identity only; no executable account credentials.
select is(
    (select count(*) from app.providers where id = '53000000-0000-0000-0000-000000000001'::uuid and code = 'akkadpag' and status = 'active'),
    1::bigint,
    'K5 AkkadPag provider catalog identity exists exactly once'
);
select is(
    (select count(*) from app.providers where id = '53000000-0000-0000-0000-000000000002'::uuid and code = 'flevopay' and status = 'active'),
    1::bigint,
    'K5 FlevoPay provider catalog identity exists exactly once'
);
select is((select count(*) from app.provider_accounts), 0::bigint, 'K5 fixture creates no provider accounts or provider credentials');
select is((select count(*) from app.api_credentials), 0::bigint, 'K5 fixture creates no API credential or secret verifier');

-- Local seed is identity/configuration only: no financial or async state.
select is((select count(*) from app.payments), 0::bigint, 'K5 fixture creates no Payments');
select is((select count(*) from app.ledger_transactions), 0::bigint, 'K5 fixture creates no ledger transactions');
select is((select count(*) from app.jobs), 0::bigint, 'K5 fixture creates no durable jobs');
select is((select count(*) from app.webhook_events), 0::bigint, 'K5 fixture creates no merchant webhook events');
select is((select count(*) from app.audit_events), 0::bigint, 'K5 fixture creates no operational audit events');

select * from finish();
rollback;