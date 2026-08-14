-- SwiftPay V2 Phase 2: persist the immutable refund-fee policy on Payment.
-- No default is intentional: a payment without an explicit snapshot is not
-- eligible for programmatic refund reservation.

alter table app.payments
    add column refund_fee_policy text;

alter table app.payments
    add constraint payments_refund_fee_policy_ck
    check (
        refund_fee_policy is null
        or refund_fee_policy in (
            'merchant_fee_non_refundable',
            'merchant_fee_refundable_pro_rata',
            'merchant_fee_refundable_full_on_full_refund'
        )
    );
