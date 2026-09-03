create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(15);

grant swiftpay_api to postgres with inherit false;

insert into auth.users (
  id,aud,role,email,raw_user_meta_data,raw_app_meta_data,is_anonymous,deleted_at,created_at,updated_at
) values (
  'a2600000-0000-0000-0000-000000000001'::uuid,
  'authenticated','authenticated','a26-owner@example.test','{}'::jsonb,'{}'::jsonb,false,null,now(),now()
);

insert into app.merchants(id,name,lifecycle_status) values
('a2610000-0000-0000-0000-000000000001'::uuid,'A26 Runtime Compatibility Merchant','active');

insert into app.merchant_members(merchant_id,user_id,role,status) values
('a2610000-0000-0000-0000-000000000001'::uuid,'a2600000-0000-0000-0000-000000000001'::uuid,'owner','active');

insert into app.providers(id,code,name,status) values
('a2620000-0000-0000-0000-000000000001'::uuid,'swiftpay_emulator','A26 SwiftPay Sandbox Emulator','active');

insert into app.provider_accounts(
  id,provider_id,merchant_id,name,environment,status,credentials_ciphertext,capabilities,configuration
) values (
  'a2630000-0000-0000-0000-000000000001'::uuid,
  'a2620000-0000-0000-0000-000000000001'::uuid,
  null,'A26 Platform Sandbox Emulator','sandbox','active','{}'::jsonb,
  '{"create_pix_charge":true}'::jsonb,'{"emulator":true}'::jsonb
);

-- Direct fixture links isolate the resolution branch from the broken dashboard-create branch.
insert into app.payment_links(
  id,merchant_id,environment,public_token,status,amount_cents,currency,description,pix_expiration_minutes
) values
('a2640000-0000-0000-0000-000000000001'::uuid,'a2610000-0000-0000-0000-000000000001'::uuid,'sandbox','plink_sandbox_'||repeat('B',32),'active',1250,'BRL','A26 resolve valid',30),
('a2640000-0000-0000-0000-000000000002'::uuid,'a2610000-0000-0000-0000-000000000001'::uuid,'sandbox','plink_sandbox_'||repeat('C',32),'active',1250,'BRL','A26 resolve extra key',30);

create temporary table a26_results(
  case_name text primary key,
  result jsonb,
  error_state text,
  error_message text
);

create procedure pg_temp.a26_capture_link(p_case text,p_key text,p_hash text,p_command jsonb)
language plpgsql security invoker as $$
declare v_result jsonb; v_state text; v_message text;
begin
  execute 'set local role swiftpay_api';
  begin
    select app.create_dashboard_payment_link(
      'a2600000-0000-0000-0000-000000000001'::uuid,
      'a2610000-0000-0000-0000-000000000001'::uuid,
      'sandbox',p_key,p_hash,p_command
    ) into v_result;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
  end;
  execute 'reset role';
  insert into pg_temp.a26_results values(p_case,v_result,v_state,v_message);
end $$;

create procedure pg_temp.a26_capture_prepare(p_case text,p_token text,p_key text,p_hash text)
language plpgsql security invoker as $$
declare v_result jsonb; v_state text; v_message text;
begin
  execute 'set local role swiftpay_api';
  begin
    select app.prepare_payment_link_pix_payment(p_token,p_key,p_hash) into v_result;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
  end;
  execute 'reset role';
  insert into pg_temp.a26_results values(p_case,v_result,v_state,v_message);
end $$;

create procedure pg_temp.a26_capture_claim(p_case text,p_prepare_case text)
language plpgsql security invoker as $$
declare v_payment uuid; v_attempt uuid; v_result jsonb; v_state text; v_message text;
begin
  select (result->'payment'->>'id')::uuid,(result->'providerAttempt'->>'id')::uuid
    into v_payment,v_attempt from pg_temp.a26_results where case_name=p_prepare_case;
  execute 'set local role swiftpay_api';
  begin
    select app.claim_api_pix_attempt('a2610000-0000-0000-0000-000000000001'::uuid,'sandbox',v_payment,v_attempt) into v_result;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
  end;
  execute 'reset role';
  insert into pg_temp.a26_results values(p_case,v_result,v_state,v_message);
end $$;

create procedure pg_temp.a26_capture_resolve(p_case text,p_prepare_case text,p_claim_case text,p_extra_key boolean)
language plpgsql security invoker as $$
declare v_payment uuid; v_attempt uuid; v_execution uuid; v_expires text; v_resolution jsonb; v_result jsonb; v_state text; v_message text;
begin
  select (result->'payment'->>'id')::uuid,(result->'providerAttempt'->>'id')::uuid,result->'providerAttempt'->>'expiresAt'
    into v_payment,v_attempt,v_expires from pg_temp.a26_results where case_name=p_prepare_case;
  select (result->>'executionToken')::uuid into v_execution from pg_temp.a26_results where case_name=p_claim_case;
  v_resolution := jsonb_build_object(
    'certainty','success','providerPaymentId','a26-emulator-payment','txId','a26-txid',
    'copyAndPaste','A26-SANDBOX-NONPAYABLE','qrCode','data:text/plain,A26-SANDBOX-NONPAYABLE','expiresAt',v_expires
  );
  if p_extra_key then v_resolution := v_resolution || '{"unexpected":true}'::jsonb; end if;
  execute 'set local role swiftpay_api';
  begin
    select app.resolve_api_pix_attempt(
      'a2610000-0000-0000-0000-000000000001'::uuid,'sandbox',v_payment,v_attempt,v_execution,v_resolution
    ) into v_result;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
  end;
  execute 'reset role';
  insert into pg_temp.a26_results values(p_case,v_result,v_state,v_message);
end $$;

select ok(to_regprocedure('pg_catalog.jsonb_object_length(jsonb)') is null,
  'A26 reproduces PostgreSQL runtime with no jsonb_object_length helper');

call pg_temp.a26_capture_link(
  'valid_link','a26-link-valid',repeat('a',64),
  jsonb_build_object('amount',1250,'currency','BRL','description','A26 valid link','pixExpirationMinutes',30,'publicToken','plink_sandbox_'||repeat('A',32))
);
call pg_temp.a26_capture_link(
  'extra_link','a26-link-extra',repeat('b',64),
  jsonb_build_object('amount',1250,'currency','BRL','description','A26 invalid link','pixExpirationMinutes',30,'publicToken','plink_sandbox_'||repeat('D',32),'unexpected',true)
);

select is((select error_state from pg_temp.a26_results where case_name='valid_link'),null::text,
  'A26 valid five-key dashboard link command executes on PostgreSQL');
select is((select result->>'kind' from pg_temp.a26_results where case_name='valid_link'),'created',
  'A26 valid five-key dashboard link command returns created');
select is((select error_state from pg_temp.a26_results where case_name='extra_link'),null::text,
  'A26 extra-key dashboard link command is rejected without runtime helper error');
select is((select result->>'kind' from pg_temp.a26_results where case_name='extra_link'),'validation_error',
  'A26 extra-key dashboard link command remains validation_error');

call pg_temp.a26_capture_prepare('prepare_valid','plink_sandbox_'||repeat('B',32),'a26-checkout-valid',repeat('c',64));
call pg_temp.a26_capture_claim('claim_valid','prepare_valid');
select is((select result->>'kind' from pg_temp.a26_results where case_name='prepare_valid'),'prepared',
  'A26 isolated valid resolution fixture prepares checkout');
select ok(coalesce((select (result->>'claimed')::boolean from pg_temp.a26_results where case_name='claim_valid'),false),
  'A26 isolated valid resolution fixture claims checkout once');
call pg_temp.a26_capture_resolve('resolve_valid','prepare_valid','claim_valid',false);
select is((select error_state from pg_temp.a26_results where case_name='resolve_valid'),null::text,
  'A26 exact six-key success resolution executes on PostgreSQL');
select is((select result->>'status' from pg_temp.a26_results where case_name='resolve_valid'),'pending',
  'A26 exact six-key success resolution moves Payment to pending');
select is((select collection_status from app.payments where id=(select (result->'payment'->>'id')::uuid from pg_temp.a26_results where case_name='prepare_valid')),'pending',
  'A26 persisted Payment is pending after valid success resolution');

call pg_temp.a26_capture_prepare('prepare_extra','plink_sandbox_'||repeat('C',32),'a26-checkout-extra',repeat('d',64));
call pg_temp.a26_capture_claim('claim_extra','prepare_extra');
select is((select result->>'kind' from pg_temp.a26_results where case_name='prepare_extra'),'prepared',
  'A26 isolated extra-key resolution fixture prepares checkout');
select ok(coalesce((select (result->>'claimed')::boolean from pg_temp.a26_results where case_name='claim_extra'),false),
  'A26 isolated extra-key resolution fixture claims checkout once');
call pg_temp.a26_capture_resolve('resolve_extra','prepare_extra','claim_extra',true);
select is((select error_state from pg_temp.a26_results where case_name='resolve_extra'),'22023',
  'A26 seven-key success resolution remains invalid with SQLSTATE 22023');

select is((select count(*)::bigint from app.ledger_transactions),0::bigint,
  'A26 runtime compatibility repair creates no ledger state');
select ok(not exists(select 1 from app.payments where collection_status='paid'),
  'A26 runtime compatibility repair never marks a Payment paid');

select * from finish();
rollback;
