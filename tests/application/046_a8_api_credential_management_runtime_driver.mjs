import * as auth from '../../packages/auth/dist/index.js';
import * as db from '../../packages/db/dist/index.js';

const DATABASE_URL = process.env.SWIFTPAY_API_DATABASE_URL;
const SIGNING_KEY = process.env.SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY;
const MERCHANT_ID = '28000000-0000-0000-0000-000000000801';
const IDS = {
  member: '18000000-0000-0000-0000-000000000801',
  admin: '18000000-0000-0000-0000-000000000802',
  owner: '18000000-0000-0000-0000-000000000803',
};
const CREDENTIAL_IDS = Array.from(
  { length: 24 },
  (_, index) => `38000000-0000-0000-0000-${String(801 + index).padStart(12, '0')}`,
);

function fail(message) {
  process.stderr.write(`A8_ACCEPTANCE_FAIL ${message}\n`);
  process.exit(1);
}
function check(condition, message) {
  if (!condition) fail(message);
}
if (!DATABASE_URL) fail('SWIFTPAY_API_DATABASE_URL is required');
if (!SIGNING_KEY) fail('SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY is required');

const pool = db.createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'api' });
let idIndex = 0;
let materialIndex = 0;

const ordinarySessionVerifier = async (authorization) => {
  const name = typeof authorization === 'string' ? authorization.replace(/^Bearer /, '') : '';
  const userId = IDS[name];
  return userId
    ? { kind: 'authenticated', principal: { userId } }
    : { kind: 'invalid_session' };
};
const privilegedSessionVerifier = async (authorization) => {
  const name = typeof authorization === 'string' ? authorization.replace(/^Bearer /, '') : '';
  const base = name.replace(/-aal2$/, '');
  const userId = IDS[base];
  return userId && name.endsWith('-aal2')
    ? { kind: 'authenticated', principal: { userId, assuranceLevel: 'aal2' } }
    : { kind: 'step_up_required' };
};
const materialFactory = async (environment) => {
  materialIndex += 1;
  const byte = materialIndex % 250 || 1;
  return auth.generateApiCredentialMaterial(environment, {
    randomBytes: (size) => Buffer.alloc(size, byte),
    verifierFactory: (secret) => auth.createCredentialSecretVerifier(secret, { salt: Buffer.alloc(16, byte) }),
  });
};
const idFactory = () => CREDENTIAL_IDS[idIndex++] ?? fail('credential id fixture exhausted');

try {
  const contextStore = db.createDashboardMerchantContextStore(pool);
  const credentialStore = db.createDashboardApiCredentialStore(pool);
  const service = auth.createDashboardApiCredentialManagementService({
    ordinarySessionVerifier,
    privilegedSessionVerifier,
    contextStore,
    store: credentialStore,
    materialFactory,
    idFactory,
  });
  const authStore = db.createApiCredentialAuthStore(pool);

  const empty = await service.list({ authorization: 'Bearer member', merchantId: MERCHANT_ID, environment: 'sandbox' });
  check(empty.kind === 'ok' && Array.isArray(empty.credentials) && empty.credentials.length === 0, 'initial_member_list');

  const memberCreate = await service.create({
    authorization: 'Bearer member-aal2', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: 'member-create', request: { name: 'Forbidden member credential' },
  });
  check(memberCreate.kind === 'forbidden', `member_create_${memberCreate.kind}`);

  const createInput = {
    authorization: 'Bearer admin-aal2', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: 'sandbox-create-1', request: { name: 'Sandbox primary', ipAllowlist: [] },
  };
  const created = await service.create(createInput);
  check(created.kind === 'created' && created.replayed === false && created.secretAvailable === true, 'sandbox_create');
  check(typeof created.secretKey === 'string' && created.secretKey.startsWith('sk_sandbox_'), 'sandbox_secret_once');
  const sandboxCredential = created.credential;
  check(sandboxCredential?.id === CREDENTIAL_IDS[0] && sandboxCredential.revision === 1 && sandboxCredential.secretVersion === 1, 'sandbox_projection_initial');

  const createReplay = await service.create(createInput);
  check(createReplay.kind === 'created' && createReplay.replayed === true, 'sandbox_create_replay_kind');
  check(createReplay.secretAvailable === false && createReplay.secretKey === null, 'sandbox_create_replay_secret');
  check(createReplay.credential?.id === CREDENTIAL_IDS[0], 'sandbox_create_replay_identity');

  const createConflict = await service.create({ ...createInput, request: { name: 'Changed request' } });
  check(createConflict.kind === 'idempotency_conflict', `sandbox_create_conflict_${createConflict.kind}`);

  const listed = await service.list({ authorization: 'Bearer member', merchantId: MERCHANT_ID, environment: 'sandbox' });
  check(listed.kind === 'ok' && listed.credentials.length === 1, 'member_list_after_create');
  const got = await service.get({
    authorization: 'Bearer member', merchantId: MERCHANT_ID, environment: 'sandbox', credentialId: CREDENTIAL_IDS[0],
  });
  check(got.kind === 'ok' && got.credential?.publicKey === sandboxCredential.publicKey, 'member_get');
  check(!('secretVerifier' in got.credential) && !('secretKey' in got.credential), 'public_projection_secret_free');

  const now = 2_000_000_000;
  const oldToken = await auth.issueAccessToken({
    merchantId: MERCHANT_ID,
    credentialId: CREDENTIAL_IDS[0],
    environment: 'sandbox',
    secretVersion: 1,
    jti: '48000000-0000-0000-0000-000000000801',
    nowSeconds: now,
  }, SIGNING_KEY);
  check((await auth.authenticateAccessToken(oldToken, SIGNING_KEY, authStore, now + 1))?.credentialId === CREDENTIAL_IDS[0], 'old_token_valid_before_rotation');

  const rotateInput = {
    authorization: 'Bearer admin-aal2', merchantId: MERCHANT_ID, environment: 'sandbox', credentialId: CREDENTIAL_IDS[0],
    idempotencyKey: 'sandbox-rotate-1', request: { expectedRevision: 1 },
  };
  const rotated = await service.rotateSecret(rotateInput);
  check(rotated.kind === 'ok' && rotated.replayed === false && rotated.secretAvailable === true, 'rotation_winner');
  check(rotated.credential?.revision === 2 && rotated.credential?.secretVersion === 2, 'rotation_versions');
  check(await auth.authenticateAccessToken(oldToken, SIGNING_KEY, authStore, now + 2) === null, 'old_token_invalid_after_rotation');

  const rotateReplay = await service.rotateSecret(rotateInput);
  check(rotateReplay.kind === 'ok' && rotateReplay.replayed === true && rotateReplay.secretKey === null && rotateReplay.secretAvailable === false, 'rotation_replay');
  const staleRotate = await service.rotateSecret({ ...rotateInput, idempotencyKey: 'sandbox-rotate-stale' });
  check(staleRotate.kind === 'resource_conflict', `stale_rotation_${staleRotate.kind}`);

  const currentToken = await auth.issueAccessToken({
    merchantId: MERCHANT_ID,
    credentialId: CREDENTIAL_IDS[0],
    environment: 'sandbox',
    secretVersion: 2,
    jti: '48000000-0000-0000-0000-000000000802',
    nowSeconds: now,
  }, SIGNING_KEY);
  check((await auth.authenticateAccessToken(currentToken, SIGNING_KEY, authStore, now + 3))?.credentialId === CREDENTIAL_IDS[0], 'current_token_valid_before_revoke');

  const revokeInput = {
    authorization: 'Bearer admin-aal2', merchantId: MERCHANT_ID, environment: 'sandbox', credentialId: CREDENTIAL_IDS[0],
    idempotencyKey: 'sandbox-revoke-1', request: { expectedRevision: 2 },
  };
  const revoked = await service.revoke(revokeInput);
  check(revoked.kind === 'ok' && revoked.replayed === false, 'revoke_winner');
  check(revoked.credential?.status === 'revoked' && revoked.credential?.revision === 3, 'revoke_projection');
  check(await auth.authenticateAccessToken(currentToken, SIGNING_KEY, authStore, now + 4) === null, 'current_token_invalid_after_revoke');

  const revokeReplay = await service.revoke(revokeInput);
  check(revokeReplay.kind === 'ok' && revokeReplay.replayed === true, 'revoke_replay');
  const rotateRevoked = await service.rotateSecret({ ...rotateInput, idempotencyKey: 'rotate-revoked', request: { expectedRevision: 3 } });
  check(rotateRevoked.kind === 'resource_conflict', `rotate_revoked_${rotateRevoked.kind}`);

  const productionAdmin = await service.create({
    authorization: 'Bearer admin-aal2', merchantId: MERCHANT_ID, environment: 'production',
    idempotencyKey: 'production-admin-create', request: { name: 'Forbidden production admin' },
  });
  check(productionAdmin.kind === 'forbidden', `production_admin_${productionAdmin.kind}`);

  const productionInput = {
    authorization: 'Bearer owner-aal2', merchantId: MERCHANT_ID, environment: 'production',
    idempotencyKey: 'production-owner-create', request: { name: 'Production owner credential' },
  };
  const production = await service.create(productionInput);
  check(production.kind === 'created' && production.replayed === false && production.secretAvailable === true, 'production_owner_create');
  check(production.credential?.environment === 'production', 'production_environment');
  const productionReplay = await service.create(productionInput);
  check(productionReplay.kind === 'created' && productionReplay.replayed === true && productionReplay.secretKey === null, 'production_replay');

  const concurrentCreates = await Promise.all(
    Array.from({ length: 11 }, (_, index) => service.create({
      authorization: 'Bearer admin-aal2',
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      idempotencyKey: `sandbox-limit-${index + 1}`,
      request: { name: `Sandbox limit ${index + 1}` },
    })),
  );
  const createdAtLimit = concurrentCreates.filter((result) => result.kind === 'created' && result.replayed === false);
  const rejectedAtLimit = concurrentCreates.filter((result) => result.kind === 'credential_limit_reached');
  check(createdAtLimit.length === 10, `concurrent_limit_created_${createdAtLimit.length}`);
  check(rejectedAtLimit.length === 1, `concurrent_limit_rejected_${rejectedAtLimit.length}`);
  const sandboxAfterLimit = await service.list({ authorization: 'Bearer member', merchantId: MERCHANT_ID, environment: 'sandbox' });
  check(
    sandboxAfterLimit.kind === 'ok'
      && sandboxAfterLimit.credentials.filter((credential) => credential.status === 'active').length === 10
      && sandboxAfterLimit.credentials.filter((credential) => credential.status === 'revoked').length === 1,
    'transactional_active_credential_limit',
  );

  process.stdout.write('A8_ACCEPTANCE_OK credential management behavior\n');
} finally {
  await pool.end();
}
