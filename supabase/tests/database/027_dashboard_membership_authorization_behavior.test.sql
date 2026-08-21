create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(31);

-- Canonical merchant fixtures. K3 deliberately does not gate dashboard access on lifecycle.
insert into app.merchants (id, name, lifecycle_status) values
    ('20000000-0000-0000-0000-000000000001'::uuid, 'K3 Active Merchant', 'active'),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'K3 Suspended Merchant', 'suspended'),
    ('20000000-0000-0000-0000-000000000003'::uuid, 'K3 Draft Merchant', 'draft');

-- Supabase Auth identities. Metadata spoof fixtures intentionally claim roles/merchant IDs.
insert into auth.users (
    id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
    is_anonymous, deleted_at, created_at, updated_at
) values
    ('10000000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'k3-member@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'authenticated', 'authenticated', 'k3-admin@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
    ('10000000-0000-0000-0000-000000000003'::uuid, 'authenticated', 'authenticated', 'k3-owner@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
    ('10000000-0000-0000-0000-000000000004'::uuid, 'authenticated', 'authenticated', 'k3-disabled@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
    ('10000000-0000-0000-0000-000000000005'::uuid, 'authenticated', 'authenticated', 'k3-user-spoof@example.test', '{"merchant_id":"20000000-0000-0000-0000-000000000001","role":"owner"}'::jsonb, '{}'::jsonb, false, null, now(), now()),
    ('10000000-0000-0000-0000-000000000006'::uuid, 'authenticated', 'authenticated', 'k3-app-spoof@example.test', '{}'::jsonb, '{"merchant_id":"20000000-0000-0000-0000-000000000001","role":"owner"}'::jsonb, false, null, now(), now()),
    ('10000000-0000-0000-0000-000000000007'::uuid, 'authenticated', 'authenticated', null, '{}'::jsonb, '{}'::jsonb, true, null, now(), now()),
    ('10000000-0000-0000-0000-000000000008'::uuid, 'authenticated', 'authenticated', 'k3-deleted@example.test', '{}'::jsonb, '{}'::jsonb, false, now(), now(), now()),
    ('10000000-0000-0000-0000-000000000009'::uuid, 'authenticated', 'authenticated', 'k3-mutable@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now());

insert into app.merchant_members (merchant_id, user_id, role, status) values
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 'member', 'active'),
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000002'::uuid, 'admin', 'active'),
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000003'::uuid, 'owner', 'active'),
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000004'::uuid, 'admin', 'disabled'),
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000007'::uuid, 'owner', 'active'),
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000008'::uuid, 'owner', 'active'),
    ('20000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000009'::uuid, 'owner', 'active'),
    ('20000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000002'::uuid, 'admin', 'active'),
    ('20000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000003'::uuid, 'owner', 'active');

-- Safe positive-call wrapper: the foundation stub becomes a normal failed assertion,
-- rather than aborting the whole RED file before all cases execute.
create function pg_temp.k3_membership_result(p_user uuid, p_merchant uuid, p_required text)
returns text
language plpgsql
as $$
begin
    return app.require_merchant_membership(p_user, p_merchant, p_required);
exception when others then
    return '__ERROR__:' || sqlstate;
end;
$$;

-- Role hierarchy: actual role is returned, not merely true/false.
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'member'), 'member', 'member satisfies member');
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'member'), 'admin', 'admin satisfies member');
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'admin'), 'admin', 'admin satisfies admin');
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'member'), 'owner', 'owner satisfies member');
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'admin'), 'owner', 'owner satisfies admin');
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'owner'), 'owner', 'owner satisfies owner');

select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'admin') $$, '42501', 'merchant membership authorization denied', 'member cannot satisfy admin');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'owner') $$, '42501', 'merchant membership authorization denied', 'member cannot satisfy owner');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'owner') $$, '42501', 'merchant membership authorization denied', 'admin cannot satisfy owner');

-- Canonical membership/identity checks. All authorization failures use one message.
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'member') $$, '42501', 'merchant membership authorization denied', 'disabled membership is denied');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'member') $$, '42501', 'merchant membership authorization denied', 'membership does not cross merchant boundary');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', 'member') $$, '42501', 'merchant membership authorization denied', 'anonymous Auth identity is denied even with membership');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000001', 'member') $$, '42501', 'merchant membership authorization denied', 'soft-deleted Auth identity is denied even with membership');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'member') $$, '42501', 'merchant membership authorization denied', 'raw_user_meta_data cannot grant merchant authorization');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', 'member') $$, '42501', 'merchant membership authorization denied', 'raw_app_meta_data cannot replace canonical membership');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000099', '20000000-0000-0000-0000-000000000001', 'member') $$, '42501', 'merchant membership authorization denied', 'unknown Auth identity is denied without identity disclosure');

-- Merchant lifecycle is intentionally a separate capability concern.
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'admin'), 'admin', 'suspended merchant can still authorize a dashboard member');
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'owner'), 'owner', 'draft merchant can still authorize a dashboard owner');

-- Invalid request shape is distinct from authorization denial.
select throws_ok($$ select app.require_merchant_membership(null, '20000000-0000-0000-0000-000000000001', 'member') $$, '23514', 'invalid merchant membership authorization request', 'null user id is invalid');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000001', null, 'member') $$, '23514', 'invalid merchant membership authorization request', 'null merchant id is invalid');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null) $$, '23514', 'invalid merchant membership authorization request', 'null required role is invalid');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'superadmin') $$, '23514', 'invalid merchant membership authorization request', 'unknown required role is invalid');

-- Membership state is read on every authorization check; JWT refresh is not required.
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 'owner'), 'owner', 'mutable fixture starts authorized as owner');
update app.merchant_members
set status = 'disabled'
where merchant_id = '20000000-0000-0000-0000-000000000001'::uuid
  and user_id = '10000000-0000-0000-0000-000000000009'::uuid;
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 'member') $$, '42501', 'merchant membership authorization denied', 'disablement is effective on the next check');
update app.merchant_members
set status = 'active', role = 'member'
where merchant_id = '20000000-0000-0000-0000-000000000001'::uuid
  and user_id = '10000000-0000-0000-0000-000000000009'::uuid;
select is(pg_temp.k3_membership_result('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 'member'), 'member', 'role downgrade is visible on the next check');
select throws_ok($$ select app.require_merchant_membership('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 'owner') $$, '42501', 'merchant membership authorization denied', 'downgraded role immediately loses owner authorization');

-- Pure authorization checks must not create operational or financial side effects.
select is((select count(*) from app.audit_events), 0::bigint, 'membership checks do not append audit history');
select is((select count(*) from app.payments), 0::bigint, 'membership checks do not create Payments');
select is((select count(*) from app.ledger_transactions), 0::bigint, 'membership checks do not post ledger transactions');
select is((select count(*) from app.jobs), 0::bigint, 'membership checks do not enqueue jobs');
select is((select count(*) from app.webhook_events), 0::bigint, 'membership checks do not create merchant webhook events');

select * from finish();
rollback;
