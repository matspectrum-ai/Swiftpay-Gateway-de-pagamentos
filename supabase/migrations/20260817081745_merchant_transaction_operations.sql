-- SwiftPay V2 A9: read-only dashboard transaction operations.
--
-- This migration adds only member-authorized Payment list/detail reads and the
-- indexes frozen by merchant-transaction-operations-v0. It grants no direct
-- relation access and performs no Payment/provider/financial mutations.

create index payments_dashboard_status_created_idx
    on app.payments (
        merchant_id,
        environment,
        collection_status,
        created_at desc,
        id asc
    );

create index payments_dashboard_external_id_created_idx
    on app.payments (
        merchant_id,
        environment,
        (pg_catalog.md5(external_id)),
        created_at desc,
        id asc
    )
    where external_id is not null;

create function app.list_dashboard_transactions(
    p_actor_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_status text,
    p_external_id text,
    p_created_from timestamptz,
    p_created_to timestamptz,
    p_cursor_created_at timestamptz,
    p_cursor_payment_id uuid,
    p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if p_environment not in ('sandbox', 'production') then
        raise exception using errcode = '22023', message = 'A9 environment is invalid';
    end if;
    if p_status is not null
       and p_status not in ('creating', 'pending', 'paid', 'expired', 'failed', 'cancelled') then
        raise exception using errcode = '22023', message = 'A9 status filter is invalid';
    end if;
    if p_external_id is not null and pg_catalog.length(p_external_id) = 0 then
        raise exception using errcode = '22023', message = 'A9 external id filter is invalid';
    end if;
    if p_created_from is not null and p_created_to is not null and p_created_to <= p_created_from then
        raise exception using errcode = '22023', message = 'A9 created time bounds are invalid';
    end if;
    if (p_cursor_created_at is null) <> (p_cursor_payment_id is null) then
        raise exception using errcode = '22023', message = 'A9 cursor key is incomplete';
    end if;
    if p_limit is null or p_limit < 1 or p_limit > 100 then
        raise exception using errcode = '22023', message = 'A9 limit is invalid';
    end if;

    perform 1
    from app.require_dashboard_merchant_context(
        p_actor_user_id,
        p_merchant_id,
        p_environment,
        'member'
    );

    select coalesce(pg_catalog.jsonb_agg(page.item), '[]'::jsonb)
    into v_result
    from (
        select pg_catalog.jsonb_build_object(
            'id', p.id::text,
            'externalId', p.external_id,
            'method', 'pix',
            'source', p.source,
            'amount', p.amount_cents,
            'fee', p.merchant_fee_cents,
            'netAmount', p.merchant_net_cents,
            'refundedAmount', p.refunded_amount_cents,
            'currency', p.currency,
            'status', p.collection_status,
            'description', p.description,
            'environment', p.environment,
            'expiresAt', case when p.expires_at is null then null else pg_catalog.to_char(
                p.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) end,
            'paidAt', case when p.paid_at is null then null else pg_catalog.to_char(
                p.paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) end,
            'createdAt', pg_catalog.to_char(
                p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'updatedAt', pg_catalog.to_char(
                p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
        ) as item
        from app.payments p
        where p.merchant_id = p_merchant_id
          and p.environment = p_environment
          and (p_status is null or p.collection_status = p_status)
          and (
              p_external_id is null
              or (
                  pg_catalog.md5(p.external_id) = pg_catalog.md5(p_external_id)
                  and p.external_id = p_external_id
              )
          )
          and (p_created_from is null or p.created_at >= p_created_from)
          and (p_created_to is null or p.created_at < p_created_to)
          and (
              p_cursor_created_at is null
              or p.created_at < p_cursor_created_at
              or (p.created_at = p_cursor_created_at and p.id > p_cursor_payment_id)
          )
        order by p.created_at desc, p.id asc
        limit (p_limit + 1)
    ) page;

    return v_result;
end;
$$;

create function app.get_dashboard_transaction(
    p_actor_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_transaction_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if p_environment not in ('sandbox', 'production') then
        raise exception using errcode = '22023', message = 'A9 environment is invalid';
    end if;

    perform 1
    from app.require_dashboard_merchant_context(
        p_actor_user_id,
        p_merchant_id,
        p_environment,
        'member'
    );

    select pg_catalog.jsonb_build_object(
        'id', p.id::text,
        'externalId', p.external_id,
        'method', 'pix',
        'source', p.source,
        'amount', p.amount_cents,
        'fee', p.merchant_fee_cents,
        'netAmount', p.merchant_net_cents,
        'refundedAmount', p.refunded_amount_cents,
        'currency', p.currency,
        'status', p.collection_status,
        'description', p.description,
        'environment', p.environment,
        'expiresAt', case when p.expires_at is null then null else pg_catalog.to_char(
            p.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) end,
        'paidAt', case when p.paid_at is null then null else pg_catalog.to_char(
            p.paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) end,
        'createdAt', pg_catalog.to_char(
            p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'updatedAt', pg_catalog.to_char(
            p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'pix', case
            when p.collection_status in ('pending', 'paid') then (
                select pg_catalog.jsonb_build_object(
                    'txId', pa.provider_txid,
                    'qrCode', pa.pix_qr_reference,
                    'copyAndPaste', pa.pix_copy_paste,
                    'expiresAt', pg_catalog.to_char(
                        pa.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    )
                )
                from app.provider_attempts pa
                where pa.payment_id = p.id
                  and pa.state = 'succeeded'
                  and pa.provider_txid is not null
                  and pa.pix_qr_reference is not null
                  and pa.pix_copy_paste is not null
                  and pa.expires_at is not null
                order by pa.attempt_number desc
                limit 1
            )
            else null
        end
    )
    into v_result
    from app.payments p
    where p.id = p_transaction_id
      and p.merchant_id = p_merchant_id
      and p.environment = p_environment;

    return v_result;
end;
$$;

revoke all on function app.list_dashboard_transactions(
    uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer
) from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app.get_dashboard_transaction(uuid, uuid, text, uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

grant execute on function app.list_dashboard_transactions(
    uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz, uuid, integer
) to swiftpay_api;
grant execute on function app.get_dashboard_transaction(uuid, uuid, text, uuid)
    to swiftpay_api;
