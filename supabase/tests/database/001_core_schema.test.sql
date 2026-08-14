begin;

select plan(25);

-- Server-owned domain boundary.
select has_schema('app', 'server-only SwiftPay app schema must exist');

-- Identity / compliance.
select has_table('app', 'merchants', 'merchants table must exist');
select has_table('app', 'merchant_members', 'merchant membership table must exist');
select has_table('app', 'kyc_cases', 'KYC cases table must exist');
select has_table('app', 'kyc_documents', 'versioned private KYC documents table must exist');
select has_table('app', 'api_credentials', 'merchant machine credentials table must exist');

-- Provider/payment spine.
select has_table('app', 'providers', 'provider metadata table must exist');
select has_table('app', 'provider_accounts', 'provider account/config table must exist');
select has_table('app', 'request_idempotency', 'request idempotency table must exist');
select has_table('app', 'payments', 'payments table must exist');
select has_table('app', 'provider_attempts', 'provider attempts table must exist');
select has_table('app', 'provider_events', 'provider events table must exist');

-- Critical operation identity must be enforced by PostgreSQL.
select has_index(
  'app',
  'api_credentials',
  'api_credentials_public_key_uq',
  'API public keys must be unique'
);
select has_index(
  'app',
  'kyc_documents',
  'kyc_documents_version_uq',
  'KYC case/purpose/version must be unique'
);
select has_index(
  'app',
  'request_idempotency',
  'request_idempotency_scope_uq',
  'merchant/environment/operation/idempotency-key scope must be unique'
);
select has_index(
  'app',
  'provider_attempts',
  'provider_attempts_payment_attempt_uq',
  'provider attempt number must be unique per Payment'
);
select has_index(
  'app',
  'provider_attempts',
  'provider_attempts_one_unresolved_uq',
  'one unresolved provider create attempt per Payment must be enforced'
);
select has_index(
  'app',
  'provider_events',
  'provider_events_fingerprint_uq',
  'provider event/fingerprint identity must be database-unique in scope'
);

-- Money/state columns are explicit and integer-based.
select has_column('app', 'payments', 'amount_cents', 'Payment amount must be integer centavos');
select has_column('app', 'payments', 'merchant_fee_cents', 'Payment merchant fee snapshot must exist');
select has_column('app', 'payments', 'merchant_net_cents', 'Payment merchant net snapshot must exist');
select has_column('app', 'payments', 'refunded_amount_cents', 'Payment refund aggregate must exist');
select has_column('app', 'provider_attempts', 'client_reference', 'ProviderAttempt stable client reference must exist');
select has_column('app', 'provider_attempts', 'state', 'ProviderAttempt execution-certainty state must exist');
select has_column('app', 'provider_events', 'fingerprint', 'ProviderEvent deterministic identity fallback must exist');

select * from finish();
rollback;
