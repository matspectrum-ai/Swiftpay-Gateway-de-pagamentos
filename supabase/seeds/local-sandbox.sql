-- SwiftPay V2 K5 deterministic local sandbox fixture.
-- LOCAL DEVELOPMENT ONLY. Pure DML; schema remains migration-owned.

begin;

insert into auth.users (
    id,
    aud,
    role,
    email,
    raw_user_meta_data,
    raw_app_meta_data,
    is_anonymous,
    deleted_at,
    created_at,
    updated_at
) values (
    '51000000-0000-0000-0000-000000000001'::uuid,
    'authenticated',
    'authenticated',
    'local-sandbox-owner@example.test',
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    null,
    now(),
    now()
)
on conflict (id) do update set
    aud = excluded.aud,
    role = excluded.role,
    email = excluded.email,
    raw_user_meta_data = excluded.raw_user_meta_data,
    raw_app_meta_data = excluded.raw_app_meta_data,
    is_anonymous = excluded.is_anonymous,
    deleted_at = null,
    updated_at = now();

insert into app.merchants (
    id,
    name,
    lifecycle_status
) values (
    '50000000-0000-0000-0000-000000000001'::uuid,
    'SwiftPay Local Sandbox Merchant',
    'active'
)
on conflict (id) do update set
    name = excluded.name,
    lifecycle_status = excluded.lifecycle_status,
    suspended_at = null,
    closed_at = null,
    updated_at = now();

insert into app.merchant_members (
    merchant_id,
    user_id,
    role,
    status
) values (
    '50000000-0000-0000-0000-000000000001'::uuid,
    '51000000-0000-0000-0000-000000000001'::uuid,
    'owner',
    'active'
)
on conflict (merchant_id, user_id) do update set
    role = excluded.role,
    status = excluded.status;

insert into app.kyc_cases (
    id,
    merchant_id,
    status,
    requirement_profile_version,
    submitted_at,
    decided_at,
    decision_reason
) values (
    '52000000-0000-0000-0000-000000000001'::uuid,
    '50000000-0000-0000-0000-000000000001'::uuid,
    'approved',
    'local-sandbox-v1',
    now(),
    now(),
    'synthetic local sandbox fixture'
)
on conflict (id) do update set
    merchant_id = excluded.merchant_id,
    status = excluded.status,
    requirement_profile_version = excluded.requirement_profile_version,
    submitted_at = coalesce(app.kyc_cases.submitted_at, excluded.submitted_at),
    decided_at = coalesce(app.kyc_cases.decided_at, excluded.decided_at),
    decision_reason = excluded.decision_reason,
    reviewed_by = null,
    updated_at = now();

insert into app.providers (
    id,
    code,
    name,
    status
) values
    (
        '53000000-0000-0000-0000-000000000001'::uuid,
        'akkadpag',
        'AkkadPag',
        'active'
    ),
    (
        '53000000-0000-0000-0000-000000000002'::uuid,
        'flevopay',
        'FlevoPay',
        'active'
    )
on conflict (id) do update set
    code = excluded.code,
    name = excluded.name,
    status = excluded.status;

commit;
