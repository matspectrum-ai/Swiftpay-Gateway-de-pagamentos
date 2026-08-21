create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(38);

insert into app.merchants (id, name, lifecycle_status)
values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Audit Fixture Merchant', 'active');

create temp table audit_side_effect_baseline as
select
    (select count(*) from app.payments) as payments,
    (select count(*) from app.payouts) as payouts,
    (select count(*) from app.refunds) as refunds,
    (select count(*) from app.ledger_transactions) as ledger_transactions,
    (select count(*) from app.jobs) as jobs,
    (select count(*) from app.webhook_events) as webhook_events;

-- 1-6: valid merchant-scoped event and exact persisted envelope.
select lives_ok(
    $$select app.record_audit_event(
        'application_command',
        'kyc-case:case-1:approve:v1',
        'fp-approve-1',
        1,
        'user',
        'auth-user:11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
        null,
        'kyc.case.approved',
        'kyc_case',
        'case-1',
        'manual_review_approved',
        'Evidence reviewed and accepted',
        'req-audit-1',
        'trace-audit-1',
        '{"requirement_profile_version":"br-pix-v1"}'::jsonb,
        '2026-08-15T02:00:00Z'::timestamptz
    )$$,
    'valid user-scoped audit event records successfully'
);

select is(
    (select count(*) from app.audit_events where source_kind = 'application_command' and source_reference = 'kyc-case:case-1:approve:v1'),
    1::bigint,
    'valid record creates exactly one durable audit row'
);

select ok(
    (select id is not null from app.audit_events where source_kind = 'application_command' and source_reference = 'kyc-case:case-1:approve:v1'),
    'recorded event receives a durable server-generated id'
);

select is(
    (select actor_subject from app.audit_events where source_kind = 'application_command' and source_reference = 'kyc-case:case-1:approve:v1'),
    'auth-user:11111111-1111-1111-1111-111111111111',
    'actor subject is preserved as the opaque historical subject'
);

select is(
    (select metadata from app.audit_events where source_kind = 'application_command' and source_reference = 'kyc-case:case-1:approve:v1'),
    '{"requirement_profile_version":"br-pix-v1"}'::jsonb,
    'audit metadata object is preserved exactly'
);

select is(
    (select occurred_at from app.audit_events where source_kind = 'application_command' and source_reference = 'kyc-case:case-1:approve:v1'),
    '2026-08-15T02:00:00Z'::timestamptz,
    'authoritative occurrence time is preserved'
);

-- 7-9: exact retry returns the same id and never duplicates history.
create temp table first_audit_id as
select id from app.audit_events
where source_kind = 'application_command'
  and source_reference = 'kyc-case:case-1:approve:v1';

select lives_ok(
    $$select app.record_audit_event(
        'application_command','kyc-case:case-1:approve:v1','fp-approve-1',1,
        'user','auth-user:11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,null,
        'kyc.case.approved','kyc_case','case-1','manual_review_approved',
        'Evidence reviewed and accepted','req-audit-1','trace-audit-1',
        '{"requirement_profile_version":"br-pix-v1"}'::jsonb,
        '2026-08-15T02:00:00Z'::timestamptz
    )$$,
    'exact audit replay succeeds idempotently'
);

select is(
    (select count(*) from app.audit_events where source_kind = 'application_command' and source_reference = 'kyc-case:case-1:approve:v1'),
    1::bigint,
    'exact replay does not duplicate audit history'
);

select is(
    (select id from app.audit_events where source_kind = 'application_command' and source_reference = 'kyc-case:case-1:approve:v1'),
    (select id from first_audit_id),
    'exact replay preserves the original durable id'
);

-- 10-11: logical identity is immutable even if retry data changes.
select throws_ok(
    $$select app.record_audit_event(
        'application_command','kyc-case:case-1:approve:v1','fp-changed',1,
        'user','auth-user:11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,null,
        'kyc.case.approved','kyc_case','case-1','manual_review_approved',
        'Evidence reviewed and accepted','req-audit-1','trace-audit-1',
        '{"requirement_profile_version":"br-pix-v1"}'::jsonb,
        '2026-08-15T02:00:00Z'::timestamptz
    )$$,
    '23505', null,
    'changed fingerprint on the same audit source identity conflicts'
);

select throws_ok(
    $$select app.record_audit_event(
        'application_command','kyc-case:case-1:approve:v1','fp-approve-1',1,
        'user','auth-user:11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,null,
        'kyc.case.rejected','kyc_case','case-1','manual_review_approved',
        'Evidence reviewed and accepted','req-audit-1','trace-audit-1',
        '{"requirement_profile_version":"br-pix-v1"}'::jsonb,
        '2026-08-15T02:00:00Z'::timestamptz
    )$$,
    '23505', null,
    'changed immutable event data conflicts even when fingerprint is reused'
);

-- 12-14: platform/system event may legitimately have no merchant/environment.
select lives_ok(
    $$select app.record_audit_event(
        'security_event','security:key-rotation:platform:v1','fp-security-1',1,
        'system','swiftpay-security-worker',null,null,
        'security.platform_key_rotated','platform_security','platform',
        null,null,null,'trace-security-1','{}'::jsonb,
        '2026-08-15T01:55:00Z'::timestamptz
    )$$,
    'platform-wide system audit event records without merchant/environment'
);

select is(
    (select merchant_id from app.audit_events where source_kind = 'security_event' and source_reference = 'security:key-rotation:platform:v1'),
    null::uuid,
    'platform-wide event keeps merchant scope null'
);

select is(
    (select environment from app.audit_events where source_kind = 'security_event' and source_reference = 'security:key-rotation:platform:v1'),
    null::text,
    'platform-wide event keeps environment null'
);

-- 15-25: deterministic input validation.
select throws_ok(
    $$select app.record_audit_event('invalid','bad:source:1','fp',1,'system','worker',null,null,'action','resource','id',null,null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'invalid source kind fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:actor:1','fp',1,'invalid','subject',null,null,'action','resource','id',null,null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'invalid actor kind fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:env:1','fp',1,'system','worker',null,'staging','action','resource','id',null,null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'invalid environment fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:version:1','fp',0,'system','worker',null,null,'action','resource','id',null,null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'non-positive event version fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:version:null','fp',null,'system','worker',null,null,'action','resource','id',null,null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'null event version fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','   ','fp',1,'system','worker',null,null,'action','resource','id',null,null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'blank required source reference fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:required:2','   ',1,'system','worker',null,null,'action','resource','id',null,null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'blank request fingerprint fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:optional:1','fp',1,'system','worker',null,null,'action','resource','id','   ',null,null,null,'{}'::jsonb,now())$$,
    '23514', null, 'blank optional reason code fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:metadata:array','fp',1,'system','worker',null,null,'action','resource','id',null,null,null,null,'[]'::jsonb,now())$$,
    '23514', null, 'array metadata fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:metadata:null','fp',1,'system','worker',null,null,'action','resource','id',null,null,null,null,null,now())$$,
    '23514', null, 'null metadata fails closed'
);
select throws_ok(
    $$select app.record_audit_event('security_event','bad:occurred:null','fp',1,'system','worker',null,null,'action','resource','id',null,null,null,null,'{}'::jsonb,null)$$,
    '23514', null, 'null occurred_at fails closed'
);

-- 26-27: merchant scope is canonical when supplied; empty metadata object is valid.
select throws_ok(
    $$select app.record_audit_event(
        'application_command','bad:merchant:1','fp-bad-merchant',1,'user','auth-user:x',
        'bbbbbbbb-0000-0000-0000-000000000099'::uuid,null,
        'credential.revoked','api_credential','cred-1',null,null,null,null,'{}'::jsonb,now()
    )$$,
    '23503', null,
    'nonexistent merchant scope is rejected by canonical foreign key'
);

select lives_ok(
    $$select app.record_audit_event(
        'worker_command','worker:recovery:1','fp-worker-1',1,'system','swiftpay-worker',
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,'sandbox',
        'payment.recovery_checked','payment','payment-1',null,null,null,null,'{}'::jsonb,
        '2026-08-15T01:50:00Z'::timestamptz
    )$$,
    'empty metadata object is valid'
);

-- 28-31: append-only history cannot be rewritten or deleted.
insert into app.audit_events (
    source_kind, source_reference, request_fingerprint, event_version,
    actor_kind, actor_subject, merchant_id, environment, action,
    resource_type, resource_id, metadata, occurred_at
) values (
    'operator_command','append-only-fixture:1','fp-fixture',1,
    'user','auth-user:fixture','aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'production','merchant.note.recorded','merchant',
    'aaaaaaaa-0000-0000-0000-000000000001','{}'::jsonb,
    '2026-08-15T01:45:00Z'::timestamptz
);

select throws_ok(
    $$update app.audit_events set action = 'tampered' where source_reference = 'append-only-fixture:1'$$,
    '23514', null,
    'audit UPDATE is rejected as append-only history'
);
select is(
    (select action from app.audit_events where source_reference = 'append-only-fixture:1'),
    'merchant.note.recorded',
    'rejected UPDATE leaves audit row unchanged'
);
select throws_ok(
    $$delete from app.audit_events where source_reference = 'append-only-fixture:1'$$,
    '23514', null,
    'audit DELETE is rejected as append-only history'
);
select is(
    (select count(*) from app.audit_events where source_reference = 'append-only-fixture:1'),
    1::bigint,
    'rejected DELETE leaves audit row durable'
);

-- 32-34: function/table remain invisible to browser/service roles.
select ok(
    not has_function_privilege('anon', 'app.record_audit_event(text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz)', 'EXECUTE'),
    'anon cannot execute audit recorder'
);
select ok(
    not has_function_privilege('authenticated', 'app.record_audit_event(text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz)', 'EXECUTE'),
    'authenticated cannot execute audit recorder'
);
select ok(
    not has_table_privilege('service_role', 'app.audit_events', 'SELECT,INSERT,UPDATE,DELETE'),
    'service_role has no direct audit table privileges'
);

-- 35-38: audit recording has zero financial/async/webhook side effects.
select is(
    (select count(*) from app.payments),
    (select payments from audit_side_effect_baseline),
    'audit operations do not mutate Payments'
);
select is(
    (select count(*) from app.payouts) + (select count(*) from app.refunds),
    (select payouts + refunds from audit_side_effect_baseline),
    'audit operations do not mutate payouts/refunds'
);
select is(
    (select count(*) from app.ledger_transactions) + (select count(*) from app.jobs),
    (select ledger_transactions + jobs from audit_side_effect_baseline),
    'audit operations do not append ledger transactions or jobs'
);
select is(
    (select count(*) from app.webhook_events),
    (select webhook_events from audit_side_effect_baseline),
    'audit operations do not emit merchant webhook events'
);

select * from finish();
rollback;
