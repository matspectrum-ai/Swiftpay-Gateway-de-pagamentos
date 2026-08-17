import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const providers = await import('../../packages/providers/dist/index.js');

const SCHEMA = 'a10-provider-activation-v0';
const AKKAD = 'akkadpag-legacy-api-v1';
const FLEVO = 'flevopay-legacy-app-api-v1';
const DIGEST = 'a'.repeat(64);
const REVIEWED_AT = '2026-08-17T08:30:00.000Z';

function requireA10() {
  assert.equal(providers.PROVIDER_ACTIVATION_SCHEMA_VERSION, SCHEMA);
  assert.equal(typeof providers.DEFAULT_PROVIDER_ACTIVATION_REGISTRY, 'object');
  assert.equal(typeof providers.parseProviderActivationRegistry, 'function');
  assert.equal(typeof providers.createProviderOperationAuthorizer, 'function');
  return {
    parse: providers.parseProviderActivationRegistry,
    createAuthorizer: providers.createProviderOperationAuthorizer,
  };
}

function record(overrides = {}) {
  return {
    provider: 'akkadpag',
    operation: 'pix_in_create',
    environment: 'sandbox',
    contractLineage: AKKAD,
    state: 'sandbox_proven',
    approvedBaseUrl: 'https://sandbox.example-provider.test/v1/',
    evidenceBundleSha256: DIGEST,
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function registry(records, overrides = {}) {
  return {
    schemaVersion: SCHEMA,
    registryVersion: 'test-1',
    records,
    ...overrides,
  };
}

function parseValid(input) {
  const { parse } = requireA10();
  const result = parse(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.registry;
}

function authorizerFor(records) {
  const { createAuthorizer } = requireA10();
  return createAuthorizer({ registry: parseValid(registry(records)) });
}

test('A10 providers package exports the frozen activation boundary', () => {
  requireA10();
});

test('A10 default registry is valid and authorizes zero retained-provider runtime operations', () => {
  const { parse, createAuthorizer } = requireA10();
  const parsed = parse(providers.DEFAULT_PROVIDER_ACTIVATION_REGISTRY);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.registry.registryVersion, '2026-08-17.0');

  const authorizer = createAuthorizer({ registry: parsed.registry });
  const providersAndLineages = [
    ['akkadpag', AKKAD],
    ['flevopay', FLEVO],
  ];
  const operations = [
    'pix_in_create', 'pix_in_query', 'pix_in_recover',
    'pix_out_create', 'pix_out_query', 'pix_out_recover', 'webhook_verify',
  ];
  for (const [provider, contractLineage] of providersAndLineages) {
    for (const environment of ['sandbox', 'production']) {
      for (const operation of operations) {
        const decision = authorizer.authorize({ provider, operation, environment, contractLineage });
        assert.equal(decision.kind, 'denied', `${provider}:${environment}:${operation}`);
        assert.equal(decision.reason, 'activation_state_denied', `${provider}:${environment}:${operation}`);
      }
    }
  }
});

test('A10 denies unregistered subjects and exact lineage mismatches', () => {
  const authorizer = authorizerFor([record()]);
  assert.deepEqual(authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_query', environment: 'sandbox', contractLineage: AKKAD,
  }), { kind: 'denied', reason: 'subject_not_registered' });
  assert.deepEqual(authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'sandbox', contractLineage: 'akadpay-public-2026',
  }), { kind: 'denied', reason: 'lineage_mismatch' });
});

test('A10 fixture-only and current-contract-proven states never authorize runtime provider traffic', () => {
  const fixture = record({
    state: 'fixture_only', approvedBaseUrl: null, evidenceBundleSha256: null, reviewedAt: null,
  });
  const current = record({
    environment: 'production', state: 'current_contract_proven', approvedBaseUrl: 'https://provider.example/v1/',
  });
  const authorizer = authorizerFor([fixture, current]);
  assert.deepEqual(authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'sandbox', contractLineage: AKKAD,
  }), { kind: 'denied', reason: 'activation_state_denied' });
  assert.deepEqual(authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'production', contractLineage: AKKAD,
  }), { kind: 'denied', reason: 'activation_state_denied' });
});

test('A10 sandbox-proven authorizes only the exact sandbox tuple and returns immutable decision context', () => {
  const authorizer = authorizerFor([record()]);
  const decision = authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'sandbox', contractLineage: AKKAD,
  });
  assert.equal(decision.kind, 'authorized');
  assert.deepEqual(decision.grant, {
    provider: 'akkadpag',
    operation: 'pix_in_create',
    environment: 'sandbox',
    contractLineage: AKKAD,
    activationState: 'sandbox_proven',
    approvedBaseUrl: 'https://sandbox.example-provider.test/v1/',
    evidenceBundleSha256: DIGEST,
    reviewedAt: REVIEWED_AT,
    registryVersion: 'test-1',
  });
  assert.equal(Object.isFrozen(decision.grant), true);
  assert.throws(() => { decision.grant.approvedBaseUrl = 'https://attacker.example/'; }, TypeError);
});

test('A10 sandbox proof does not authorize production and production-enabled is tuple-specific', () => {
  const authorizer = authorizerFor([
    record(),
    record({
      environment: 'production', state: 'production_enabled', approvedBaseUrl: 'https://api.example-provider.test/v1/',
      evidenceBundleSha256: 'b'.repeat(64),
    }),
  ]);

  const sandboxOnly = authorizerFor([record()]);
  assert.deepEqual(sandboxOnly.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'production', contractLineage: AKKAD,
  }), { kind: 'denied', reason: 'subject_not_registered' });

  const production = authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'production', contractLineage: AKKAD,
  });
  assert.equal(production.kind, 'authorized');
  assert.equal(production.grant.activationState, 'production_enabled');
  assert.equal(production.grant.approvedBaseUrl, 'https://api.example-provider.test/v1/');
});

test('A10 rejects duplicate identities, unknown fields, missing fields and enum drift as a complete invalid registry', () => {
  const { parse } = requireA10();
  for (const input of [
    registry([record(), record()]),
    registry([{ ...record(), extra: true }]),
    registry([{ ...record(), operation: undefined }]),
    registry([{ ...record(), provider: 'akadpay' }]),
    registry([{ ...record(), state: 'enabled' }]),
    { ...registry([record()]), unexpected: true },
  ]) {
    assert.deepEqual(parse(input), { ok: false, reason: 'registry_invalid' });
  }
});

test('A10 enforces state-bound evidence metadata and preserves parsed registry from caller mutation', () => {
  const { parse } = requireA10();
  const invalidRecords = [
    record({ evidenceBundleSha256: null }),
    record({ approvedBaseUrl: null }),
    record({ reviewedAt: null }),
    record({ state: 'fixture_only' }),
    record({ state: 'unsupported' }),
  ];
  for (const invalid of invalidRecords) {
    assert.deepEqual(parse(registry([invalid])), { ok: false, reason: 'registry_invalid' });
  }

  const input = registry([record()]);
  const parsed = parse(input);
  assert.equal(parsed.ok, true);
  input.records[0].state = 'fixture_only';
  input.records[0].approvedBaseUrl = null;
  const authorizer = providers.createProviderOperationAuthorizer({ registry: parsed.registry });
  assert.equal(authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'sandbox', contractLineage: AKKAD,
  }).kind, 'authorized');
});

test('A10 strictly validates evidence digest, review timestamp and canonical safe HTTPS provider origin', () => {
  const { parse } = requireA10();
  const invalidOverrides = [
    { evidenceBundleSha256: 'A'.repeat(64) },
    { evidenceBundleSha256: 'a'.repeat(63) },
    { reviewedAt: '2026-08-17T08:30:00Z' },
    { reviewedAt: '2026-02-30T08:30:00.000Z' },
    { approvedBaseUrl: 'http://provider.example/v1/' },
    { approvedBaseUrl: 'https://user:pass@provider.example/v1/' },
    { approvedBaseUrl: 'https://provider.example/v1/?x=1' },
    { approvedBaseUrl: 'https://provider.example/v1/#frag' },
    { approvedBaseUrl: 'https://localhost/v1/' },
    { approvedBaseUrl: 'https://api.localhost/v1/' },
    { approvedBaseUrl: 'https://127.0.0.1/v1/' },
    { approvedBaseUrl: 'https://[::1]/v1/' },
    { approvedBaseUrl: 'https://provider.example/v1' },
  ];
  for (const overrides of invalidOverrides) {
    assert.deepEqual(parse(registry([record(overrides)])), { ok: false, reason: 'registry_invalid' }, JSON.stringify(overrides));
  }
});

test('A10 grant contains no credentials/customer/payment material and A10 adds no live network implementation', async () => {
  requireA10();
  const authorizer = authorizerFor([record()]);
  const decision = authorizer.authorize({
    provider: 'akkadpag', operation: 'pix_in_create', environment: 'sandbox', contractLineage: AKKAD,
  });
  assert.equal(decision.kind, 'authorized');
  const text = JSON.stringify(decision.grant).toLowerCase();
  for (const forbidden of ['secret', 'credential', 'authorization', 'customer', 'document', 'email', 'phone', 'pixkey', 'paymentid']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }

  const source = await readFile(new URL('../../packages/providers/src/index.ts', import.meta.url), 'utf8');
  for (const forbidden of ["from 'node:http'", "from 'node:https'", "from 'node:net'", "from 'node:tls'", "from 'undici'", 'fetch(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
