-- SwiftPay V2 A24: align the persisted abuse-policy CHECK with the A23
-- checkout_request_pre_auth policy already frozen in app.consume_api_abuse_quota.
-- No quota limit, function authority, runtime capability or financial behavior changes.

alter table app.api_abuse_windows
  drop constraint api_abuse_windows_policy_check;

alter table app.api_abuse_windows
  add constraint api_abuse_windows_policy_check
  check (policy in (
    'token_exchange_pre_auth',
    'machine_request_pre_auth',
    'machine_read',
    'machine_mutation',
    'dashboard_request_pre_auth',
    'checkout_request_pre_auth',
    'readiness_probe'
  ));
