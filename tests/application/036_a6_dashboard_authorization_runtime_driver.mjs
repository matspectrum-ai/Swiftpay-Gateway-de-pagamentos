import * as auth from '../../packages/auth/dist/index.js';
import * as db from '../../packages/db/dist/index.js';

const DATABASE_URL = process.env.SWIFTPAY_API_DATABASE_URL;
const [tokenName, merchantId, environment, requiredRole, expectedKind, expectedRole = ''] = process.argv.slice(2);

const USERS = {
  member: '16000000-0000-0000-0000-000000000601',
  admin: '16000000-0000-0000-0000-000000000602',
  owner: '16000000-0000-0000-0000-000000000603',
  disabled: '16000000-0000-0000-0000-000000000604',
  anonymous: '16000000-0000-0000-0000-000000000605',
  deleted: '16000000-0000-0000-0000-000000000606',
  spoof: '16000000-0000-0000-0000-000000000607',
  mutable: '16000000-0000-0000-0000-000000000608',
  missing: '16000000-0000-0000-0000-000000000699',
};

function fail(message) {
  process.stderr.write(`A6_ACCEPTANCE_FAIL ${message}\n`);
  process.exit(1);
}

if (!DATABASE_URL) fail('SWIFTPAY_API_DATABASE_URL is required');
if (!tokenName || !merchantId || !environment || !requiredRole || !expectedKind) {
  fail('driver arguments are incomplete');
}

if (typeof auth.createDashboardAuthorizationService !== 'function') {
  fail('behavior_not_implemented:createDashboardAuthorizationService');
}
if (typeof db.createDashboardMerchantContextStore !== 'function') {
  fail('behavior_not_implemented:createDashboardMerchantContextStore');
}

const pool = db.createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'api' });
let verifierCalls = 0;
const sessionVerifier = async (authorization) => {
  verifierCalls += 1;
  if (authorization !== `Bearer ${tokenName}`) return { kind: 'invalid_session' };
  const userId = USERS[tokenName];
  if (!userId) return { kind: 'invalid_session' };
  return { kind: 'authenticated', principal: { userId } };
};

try {
  const contextStore = db.createDashboardMerchantContextStore(pool);
  const authorize = auth.createDashboardAuthorizationService({ sessionVerifier, contextStore });
  const result = await authorize({
    authorization: `Bearer ${tokenName}`,
    merchantId,
    environment,
    requiredRole,
  });

  if (verifierCalls !== 1) fail(`verifier_calls:${verifierCalls}`);
  if (!result || result.kind !== expectedKind) {
    fail(`expected_${expectedKind}_got_${result?.kind ?? 'missing'}`);
  }
  if (expectedKind === 'authorized') {
    if (!result.context) fail('authorized_context_missing');
    if (result.context.merchantId !== merchantId) fail('merchant_context_drift');
    if (result.context.environment !== environment) fail('environment_context_drift');
    if (result.context.membershipRole !== expectedRole) {
      fail(`expected_role_${expectedRole}_got_${result.context.membershipRole ?? 'missing'}`);
    }
  }

  process.stdout.write(`A6_ACCEPTANCE_OK ${tokenName} ${expectedKind}${expectedRole ? ` ${expectedRole}` : ''}\n`);
} finally {
  await pool.end();
}
