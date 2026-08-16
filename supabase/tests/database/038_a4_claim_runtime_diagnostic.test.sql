create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(1);

insert into app.merchants (id, name, lifecycle_status)
values ('a4800000-0000-0000-0000-000000000001'::uuid, 'A4 Diagnostic Merchant', 'active');

insert into app.webhook_endpoints (
  id, merchant_id, environment, url, status,
  secret_ciphertext, secret_version, subscribed_events
) values (
  'a4810000-0000-0000-0000-000000000001'::uuid,
  'a4800000-0000-0000-0000-000000000001'::uuid,
  'sandbox',
  'https://merchant.example.test/diagnostic',
  'active',
  'cipher-v1',
  1,
  '["payment.paid"]'::jsonb
);

do $diag$
declare
  v_event_id uuid;
  v_source_id uuid := 'a4820000-0000-0000-0000-000000000001'::uuid;
  v_claim jsonb;
  v_state text;
  v_message text;
begin
  v_event_id := app.record_webhook_event(
    'a4800000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'payment.paid',
    'payment',
    v_source_id,
    'payment',
    v_source_id,
    'payment-v1',
    jsonb_build_object('id', v_source_id::text, 'status', 'paid'),
    '2030-01-01T00:00:00Z'::timestamptz
  );

  begin
    select x into v_claim
      from app.claim_merchant_webhook_deliveries('a4-diagnostic-worker', 1, 30) x
      limit 1;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    raise warning 'A4_ACTIVE_CLAIM_DIAGNOSTIC sqlstate=% message=%', v_state, v_message;
  end;
end
$diag$;

select pass('A4 temporary diagnostic executed');
select * from finish();
rollback;
