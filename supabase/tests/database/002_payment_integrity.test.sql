create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(11);

insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000000001', 'Test Merchant', 'active');

insert into app.providers (id, code, name, status)
values ('00000000-0000-0000-0000-000000000101', 'test-provider', 'Test Provider', 'active');

insert into app.provider_accounts (
  id, provider_id, merchant_id, name, environment, status,
  credentials_ciphertext, capabilities, configuration
)
values (
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'Test Provider Account', 'sandbox', 'active',
  '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
);

select throws_ok(
  $$insert into app.payments (
      id, merchant_id, environment, source, collection_status,
      amount_cents, currency, pricing_version, rounding_policy_version,
      merchant_fee_cents, merchant_net_cents
    ) values (
      '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000001',
      'sandbox', 'api', 'creating', 0, 'BRL', 'v1', 'v1', 0, 0
    )$$,
  '23514', null,
  'PAY-001: zero-value Payment is rejected'
);

select throws_ok(
  $$insert into app.payments (
      id, merchant_id, environment, source, collection_status,
      amount_cents, currency, pricing_version, rounding_policy_version,
      merchant_fee_cents, merchant_net_cents
    ) values (
      '00000000-0000-0000-0000-000000000011',
      '00000000-0000-0000-0000-000000000001',
      'sandbox', 'api', 'creating', 1000, 'USD', 'v1', 'v1', 0, 1000
    )$$,
  '23514', null,
  'PAY-002: non-BRL Payment is rejected in initial release'
);

select throws_ok(
  $$insert into app.payments (
      id, merchant_id, environment, source, collection_status,
      amount_cents, currency, pricing_version, rounding_policy_version,
      merchant_fee_cents, merchant_net_cents
    ) values (
      '00000000-0000-0000-0000-000000000012',
      '00000000-0000-0000-0000-000000000001',
      'sandbox', 'api', 'creating', 1000, 'BRL', 'v1', 'v1', 100, 950
    )$$,
  '23514', null,
  'PAY-003: merchant fee plus net must equal gross amount'
);

select throws_ok(
  $$insert into app.payments (
      id, merchant_id, environment, source, collection_status,
      amount_cents, currency, pricing_version, rounding_policy_version,
      merchant_fee_cents, merchant_net_cents, refunded_amount_cents
    ) values (
      '00000000-0000-0000-0000-000000000013',
      '00000000-0000-0000-0000-000000000001',
      'sandbox', 'api', 'paid', 1000, 'BRL', 'v1', 'v1', 100, 900, 1001
    )$$,
  '23514', null,
  'PAY-004: refunded aggregate cannot exceed original amount'
);

select throws_ok(
  $$insert into app.payments (
      id, merchant_id, environment, source, collection_status,
      amount_cents, currency, pricing_version, rounding_policy_version,
      merchant_fee_cents, merchant_net_cents
    ) values (
      '00000000-0000-0000-0000-000000000014',
      '00000000-0000-0000-0000-000000000001',
      'sandbox', 'api', 'provider_magic_string', 1000, 'BRL', 'v1', 'v1', 100, 900
    )$$,
  '23514', null,
  'PAY: arbitrary provider status cannot become canonical Payment state'
);

select lives_ok(
  $$insert into app.payments (
      id, merchant_id, environment, source, collection_status,
      amount_cents, currency, pricing_version, rounding_policy_version,
      merchant_fee_cents, merchant_net_cents
    ) values (
      '00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000001',
      'sandbox', 'api', 'creating', 1000, 'BRL', 'v1', 'v1', 100, 900
    )$$,
  'a valid canonical Payment can be persisted'
);

insert into app.request_idempotency (
  id, merchant_id, environment, operation, idempotency_key, request_hash, state
) values (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001',
  'sandbox', 'create_payment', 'same-key', 'hash-a', 'in_progress'
);

select throws_ok(
  $$insert into app.request_idempotency (
      id, merchant_id, environment, operation, idempotency_key, request_hash, state
    ) values (
      '00000000-0000-0000-0000-000000000031',
      '00000000-0000-0000-0000-000000000001',
      'sandbox', 'create_payment', 'same-key', 'hash-a', 'in_progress'
    )$$,
  '23505', null,
  'IDEM-001: operation idempotency scope is unique in PostgreSQL'
);

insert into app.provider_attempts (
  id, payment_id, provider_id, provider_account_id, operation,
  attempt_number, state, client_reference, request_fingerprint
) values (
  '00000000-0000-0000-0000-000000000040',
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  'create_pix_charge', 1, 'prepared', 'attempt-40', 'fp-40'
);

select throws_ok(
  $$insert into app.provider_attempts (
      id, payment_id, provider_id, provider_account_id, operation,
      attempt_number, state, client_reference, request_fingerprint
    ) values (
      '00000000-0000-0000-0000-000000000041',
      '00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102',
      'create_pix_charge', 2, 'execution_unknown', 'attempt-41', 'fp-41'
    )$$,
  '23505', null,
  'ATT-002: one Payment cannot have two unresolved create attempts'
);

update app.provider_attempts
set state = 'definitively_failed'
where id = '00000000-0000-0000-0000-000000000040';

select lives_ok(
  $$insert into app.provider_attempts (
      id, payment_id, provider_id, provider_account_id, operation,
      attempt_number, state, client_reference, request_fingerprint
    ) values (
      '00000000-0000-0000-0000-000000000042',
      '00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102',
      'create_pix_charge', 2, 'prepared', 'attempt-42', 'fp-42'
    )$$,
  'ATT: a new attempt is representable after definitive failure'
);

select throws_ok(
  $$insert into app.provider_attempts (
      id, payment_id, provider_id, provider_account_id, operation,
      attempt_number, state, client_reference, request_fingerprint
    ) values (
      '00000000-0000-0000-0000-000000000043',
      '00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102',
      'create_pix_charge', 2, 'succeeded', 'attempt-43', 'fp-43'
    )$$,
  '23505', null,
  'ATT-001: attempt number is unique per Payment'
);

insert into app.provider_events (
  id, provider_id, provider_account_id, environment, fingerprint,
  resource_type, event_type, payload_hash, state
) values (
  '00000000-0000-0000-0000-000000000050',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  'sandbox', 'provider-event-fp', 'payment', 'payment.paid', 'payload-hash', 'received'
);

select throws_ok(
  $$insert into app.provider_events (
      id, provider_id, provider_account_id, environment, fingerprint,
      resource_type, event_type, payload_hash, state
    ) values (
      '00000000-0000-0000-0000-000000000051',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102',
      'sandbox', 'provider-event-fp', 'payment', 'payment.paid', 'payload-hash', 'received'
    )$$,
  '23505', null,
  'EVT-001: duplicate provider-event fingerprint is rejected in scope'
);

select * from finish();
rollback;
