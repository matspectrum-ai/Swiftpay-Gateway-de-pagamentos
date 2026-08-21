-- SwiftPay V2 A2: trusted Pix create/get emulator database foundation.
--
-- This migration intentionally establishes schema and capability boundaries only.
-- The four trusted routines fail closed until the behavior migration is added
-- under explicit pgTAP RED -> GREEN coverage.

alter table app.payments
    add column fee_mode text,
    add column fee_fixed_cents bigint,
    add column fee_basis_points integer,
    add column fee_percentage_component_cents bigint,
    add column routing_policy_version text,
    add constraint payments_fee_fixed_cents_nonnegative_ck
        check (fee_fixed_cents is null or fee_fixed_cents >= 0),
    add constraint payments_fee_basis_points_nonnegative_ck
        check (fee_basis_points is null or fee_basis_points >= 0),
    add constraint payments_fee_percentage_component_nonnegative_ck
        check (fee_percentage_component_cents is null or fee_percentage_component_cents >= 0);

alter table app.provider_attempts
    add column recovery_required_at timestamptz;

create function app.prepare_api_pix_payment(
    p_merchant_id uuid,
    p_environment text,
    p_idempotency_key text,
    p_request_hash text,
    p_request jsonb,
    p_pricing jsonb,
    p_routing_policy_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    raise exception using
        errcode = '0A000',
        message = 'A2 Pix payment routine is not implemented';
end;
$$;

create function app.claim_api_pix_attempt(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid,
    p_provider_attempt_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    raise exception using
        errcode = '0A000',
        message = 'A2 Pix payment routine is not implemented';
end;
$$;

create function app.resolve_api_pix_attempt(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid,
    p_provider_attempt_id uuid,
    p_execution_token uuid,
    p_resolution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    raise exception using
        errcode = '0A000',
        message = 'A2 Pix payment routine is not implemented';
end;
$$;

create function app.get_api_payment(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    raise exception using
        errcode = '0A000',
        message = 'A2 Pix payment routine is not implemented';
end;
$$;

revoke all on function app.prepare_api_pix_payment(uuid, text, text, text, jsonb, jsonb, text)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.claim_api_pix_attempt(uuid, text, uuid, uuid)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.get_api_payment(uuid, text, uuid)
    from public, anon, authenticated, service_role, swiftpay_worker;

grant execute on function app.prepare_api_pix_payment(uuid, text, text, text, jsonb, jsonb, text)
    to swiftpay_api;
grant execute on function app.claim_api_pix_attempt(uuid, text, uuid, uuid)
    to swiftpay_api;
grant execute on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    to swiftpay_api;
grant execute on function app.get_api_payment(uuid, text, uuid)
    to swiftpay_api;
