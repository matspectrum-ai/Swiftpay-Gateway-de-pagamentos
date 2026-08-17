import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const providers = await import('../../packages/providers/dist/index.js');

const LINEAGE = 'akkadpag-legacy-api-v1';
const DIGEST = 'c'.repeat(64);
const REVIEWED_AT = '2026-08-17T09:00:00.000Z';
const BASE_URL = 'https://provider.example.test/api/v1/';

function requireA11() {
  assert.equal(typeof providers.ProviderHttpTransportError, 'function');
  assert.equal(typeof providers.createStrictProviderHttpTransport, 'function');
  assert.equal(typeof providers.createNodeProviderDnsResolver, 'function');
  assert.equal(typeof providers.createNodeProviderHttpsExecutor, 'function');
  return {
    ErrorClass: providers.ProviderHttpTransportError,
    createTransport: providers.createStrictProviderHttpTransport,
  };
}

function activatedRecord(overrides = {}) {
  return {
    provider: 'akkadpag',
    operation: 'pix_in_create',
    environment: 'sandbox',
    contractLineage: LINEAGE,
    state: 'sandbox_proven',
    approvedBaseUrl: BASE_URL,
    evidenceBundleSha256: DIGEST,
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function parseRegistry(records, registryVersion = 'a11-test-1') {
  const parsed = providers.parseProviderActivationRegistry({
    schemaVersion: providers.PROVIDER_ACTIVATION_SCHEMA_VERSION,
    registryVersion,
    records,
  });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return parsed.registry;
}

function subject(overrides = {}) {
  return {
    provider: 'akkadpag',
    operation: 'pix_in_create',
    environment: 'sandbox',
    contractLineage: LINEAGE,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    method: 'POST',
    relativePath: 'transactions',
    headers: { Authorization: 'Basic SECRET_A11' },
    bodyUtf8: '{"amount":100}',
    ...overrides,
  };
}

function publicResolver(addresses = ['8.8.8.8'], calls = []) {
  return {
    async resolve(hostname) {
      calls.push(hostname);
      return addresses;
    },
  };
}

function recordingExecutor(result = {
  kind: 'response',
  statusCode: 200,
  headers: { 'X-Test': 'ok' },
  body: Buffer.from('{"ok":true}', 'utf8'),
}, calls = []) {
  return {
    async execute(input) {
      calls.push(input);
      return result;
    },
  };
}

function createActivatedTransport({ record = activatedRecord(), resolver, executor } = {}) {
  const { createTransport } = requireA11();
  return createTransport({
    registry: parseRegistry([record]),
    resolver: resolver ?? publicResolver(),
    executor: executor ?? recordingExecutor(),
  });
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected rejection');
}

function assertTransportError(error, code, phase) {
  const { ErrorClass } = requireA11();
  assert.equal(error instanceof ErrorClass, true, `${error?.constructor?.name}:${error?.message}`);
  assert.equal(error.name, 'ProviderHttpTransportError');
  assert.equal(error.code, code);
  assert.equal(error.phase, phase);
}

test('A11 providers package exports the strict provider HTTP boundary', () => {
  requireA11();
});

test('A11 rejects unvalidated activation registry at construction', () => {
  const { createTransport } = requireA11();
  assert.throws(
    () => createTransport({
      registry: providers.DEFAULT_PROVIDER_ACTIVATION_REGISTRY,
      resolver: publicResolver(),
      executor: recordingExecutor(),
    }),
    (error) => {
      assertTransportError(error, 'activation_registry_invalid', 'pre_transmission');
      return true;
    },
  );
});

test('A11 default parsed A10 registry denies before DNS and HTTPS execution', async () => {
  const { createTransport } = requireA11();
  const parsed = providers.parseProviderActivationRegistry(providers.DEFAULT_PROVIDER_ACTIVATION_REGISTRY);
  assert.equal(parsed.ok, true);
  const resolverCalls = [];
  const executorCalls = [];
  const transport = createTransport({
    registry: parsed.registry,
    resolver: publicResolver(['8.8.8.8'], resolverCalls),
    executor: recordingExecutor(undefined, executorCalls),
  });
  const error = await captureError(transport.send({ subject: subject(), request: request() }));
  assertTransportError(error, 'activation_denied', 'pre_transmission');
  assert.deepEqual(resolverCalls, []);
  assert.deepEqual(executorCalls, []);
});

test('A11 authorized transport derives exact origin/base path from A10 grant and pins public DNS while preserving SNI/Host', async () => {
  requireA11();
  const resolverCalls = [];
  const executorCalls = [];
  const transport = createActivatedTransport({
    record: activatedRecord({ approvedBaseUrl: 'https://provider.example.test:8443/api/v1/' }),
    resolver: publicResolver(['8.8.8.8', '1.1.1.1'], resolverCalls),
    executor: recordingExecutor(undefined, executorCalls),
  });
  const response = await transport.send({
    subject: subject(),
    request: request({ relativePath: 'query?action=get_transaction&id=abc' }),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(resolverCalls, ['provider.example.test']);
  assert.equal(executorCalls.length, 1);
  const sent = executorCalls[0];
  assert.equal(sent.pinnedAddress, '8.8.8.8');
  assert.equal(sent.hostname, 'provider.example.test');
  assert.equal(sent.host, 'provider.example.test:8443');
  assert.equal(sent.port, 8443);
  assert.equal(sent.path, '/api/v1/query?action=get_transaction&id=abc');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.servername, 'provider.example.test');
  assert.equal(sent.timeoutMs, 5000);
  assert.equal(sent.maxHeaderSize, 16384);
  assert.equal(sent.maxResponseBodyBytes, 1048576);
  assert.equal(sent.minTlsVersion, 'TLSv1.2');
  assert.equal(sent.rejectUnauthorized, true);
  assert.equal(sent.headers.host, 'provider.example.test:8443');
  assert.equal(sent.headers['accept-encoding'], 'identity');
  assert.equal(sent.headers['content-length'], String(Buffer.byteLength('{"amount":100}', 'utf8')));
  assert.equal(sent.headers.Authorization, 'Basic SECRET_A11');
  assert.equal(Buffer.from(sent.body).toString('utf8'), '{"amount":100}');
});

test('A11 rejects absolute/scheme-relative/root/backslash/fragment/dot traversal and base-path escape before DNS', async () => {
  requireA11();
  const invalidPaths = [
    '',
    '/transactions',
    '//attacker.example/x',
    'https://attacker.example/x',
    '..\\admin',
    '../admin',
    './transactions',
    '%2e%2e/admin',
    '%2E%2E/admin',
    'a/%2e%2e/admin',
    'transactions#fragment',
  ];
  for (const relativePath of invalidPaths) {
    const resolverCalls = [];
    const executorCalls = [];
    const transport = createActivatedTransport({
      resolver: publicResolver(['8.8.8.8'], resolverCalls),
      executor: recordingExecutor(undefined, executorCalls),
    });
    const error = await captureError(transport.send({ subject: subject(), request: request({ relativePath }) }));
    assertTransportError(error, 'request_invalid', 'pre_transmission');
    assert.deepEqual(resolverCalls, [], relativePath);
    assert.deepEqual(executorCalls, [], relativePath);
  }
});

test('A11 rejects unsupported methods, GET bodies, reserved/routing headers and CRLF before DNS', async () => {
  requireA11();
  const cases = [
    request({ method: 'PUT' }),
    request({ method: 'GET', bodyUtf8: '{}' }),
    request({ headers: { Host: 'attacker.example' } }),
    request({ headers: { 'Content-Length': '999' } }),
    request({ headers: { 'Transfer-Encoding': 'chunked' } }),
    request({ headers: { 'Proxy-Authorization': 'secret' } }),
    request({ headers: { 'X-Forwarded-Host': 'attacker.example' } }),
    request({ headers: { 'Accept-Encoding': 'gzip' } }),
    request({ headers: { Authorization: 'Basic abc\r\nX-Evil: 1' } }),
  ];
  for (const candidate of cases) {
    const resolverCalls = [];
    const transport = createActivatedTransport({ resolver: publicResolver(['8.8.8.8'], resolverCalls) });
    const error = await captureError(transport.send({ subject: subject(), request: candidate }));
    assertTransportError(error, 'request_invalid', 'pre_transmission');
    assert.deepEqual(resolverCalls, []);
  }
});

test('A11 enforces relative-path/header/body request ceilings before DNS', async () => {
  requireA11();
  const tooManyHeaders = {};
  for (let i = 0; i < 65; i += 1) tooManyHeaders[`X-H-${i}`] = 'x';
  const hugeHeaders = { 'X-Huge': 'x'.repeat(16384) };
  const cases = [
    request({ relativePath: 'x'.repeat(4097) }),
    request({ headers: tooManyHeaders }),
    request({ headers: hugeHeaders }),
    request({ bodyUtf8: 'x'.repeat(262145) }),
  ];
  for (const candidate of cases) {
    const resolverCalls = [];
    const transport = createActivatedTransport({ resolver: publicResolver(['8.8.8.8'], resolverCalls) });
    const error = await captureError(transport.send({ subject: subject(), request: candidate }));
    assertTransportError(error, 'request_invalid', 'pre_transmission');
    assert.deepEqual(resolverCalls, []);
  }
});

test('A11 DNS failure/empty/private/reserved/mixed results fail pre-transmission and never invoke HTTPS executor', async () => {
  requireA11();
  const cases = [
    { resolver: { async resolve() { throw new Error('dns secret'); } }, code: 'dns_unavailable' },
    { resolver: publicResolver([]), code: 'destination_policy' },
    { resolver: publicResolver(['127.0.0.1']), code: 'destination_policy' },
    { resolver: publicResolver(['10.0.0.1']), code: 'destination_policy' },
    { resolver: publicResolver(['192.0.2.1']), code: 'destination_policy' },
    { resolver: publicResolver(['::1']), code: 'destination_policy' },
    { resolver: publicResolver(['fc00::1']), code: 'destination_policy' },
    { resolver: publicResolver(['::ffff:127.0.0.1']), code: 'destination_policy' },
    { resolver: publicResolver(['8.8.8.8', '10.0.0.1']), code: 'destination_policy' },
  ];
  for (const { resolver, code } of cases) {
    const executorCalls = [];
    const transport = createActivatedTransport({ resolver, executor: recordingExecutor(undefined, executorCalls) });
    const error = await captureError(transport.send({ subject: subject(), request: request() }));
    assertTransportError(error, code, 'pre_transmission');
    assert.deepEqual(executorCalls, []);
  }
});

test('A11 performs exactly one executor attempt and returns 3xx/408/425/429/5xx without redirects or retry', async () => {
  requireA11();
  for (const statusCode of [301, 307, 408, 425, 429, 500, 503]) {
    const executorCalls = [];
    const transport = createActivatedTransport({
      executor: recordingExecutor({
        kind: 'response', statusCode, headers: { Location: 'https://attacker.example/x' }, body: Buffer.from('{}'),
      }, executorCalls),
    });
    const response = await transport.send({ subject: subject(), request: request() });
    assert.equal(response.statusCode, statusCode);
    assert.equal(executorCalls.length, 1, String(statusCode));
  }
});

test('A11 classifies executor timeout/network failures conservatively as transmission_unknown and attempts once', async () => {
  requireA11();
  for (const result of [{ kind: 'timeout' }, { kind: 'network_error' }]) {
    const calls = [];
    const transport = createActivatedTransport({ executor: recordingExecutor(result, calls) });
    const error = await captureError(transport.send({ subject: subject(), request: request() }));
    assertTransportError(error, result.kind, 'transmission_unknown');
    assert.equal(calls.length, 1);
  }
});

test('A11 rejects oversized and invalid UTF-8 responses as transmission_unknown without replacement decoding', async () => {
  requireA11();
  const cases = [
    {
      result: { kind: 'response', statusCode: 200, headers: {}, body: Buffer.alloc(1048577, 0x61) },
      code: 'response_too_large',
    },
    {
      result: { kind: 'response', statusCode: 200, headers: {}, body: Buffer.from([0xff, 0xfe]) },
      code: 'response_invalid_utf8',
    },
    {
      result: { kind: 'response', statusCode: 0, headers: {}, body: Buffer.from('{}') },
      code: 'response_invalid_status',
    },
  ];
  for (const { result, code } of cases) {
    const transport = createActivatedTransport({ executor: recordingExecutor(result) });
    const error = await captureError(transport.send({ subject: subject(), request: request() }));
    assertTransportError(error, code, 'transmission_unknown');
  }
});

test('A11 normalizes response header names and repeated values deterministically', async () => {
  requireA11();
  const transport = createActivatedTransport({
    executor: recordingExecutor({
      kind: 'response',
      statusCode: 200,
      headers: { 'X-Trace': ['a', 'b'], 'Content-Type': 'application/json', Empty: undefined },
      body: Buffer.from('{"ok":true}', 'utf8'),
    }),
  });
  const response = await transport.send({ subject: subject(), request: request() });
  assert.deepEqual(response, {
    statusCode: 200,
    headers: { 'x-trace': 'a, b', 'content-type': 'application/json' },
    bodyUtf8: '{"ok":true}',
  });
});

test('A11 transport errors are redaction-safe and never contain credentials or request/response bodies', async () => {
  requireA11();
  const transport = createActivatedTransport({
    executor: recordingExecutor({ kind: 'network_error', detail: 'Basic SECRET_A11 {"amount":100}' }),
  });
  const error = await captureError(transport.send({ subject: subject(), request: request() }));
  assertTransportError(error, 'network_error', 'transmission_unknown');
  const serialized = JSON.stringify(error);
  assert.equal(serialized.includes('SECRET_A11'), false);
  assert.equal(serialized.includes('amount'), false);
  assert.deepEqual(Object.keys(error).sort(), ['code', 'name', 'phase'].sort());
});

test('A11 Node resolver/executor factories expose the frozen production shape without making a PSP call', async () => {
  requireA11();
  const resolver = providers.createNodeProviderDnsResolver();
  const executor = providers.createNodeProviderHttpsExecutor();
  assert.equal(typeof resolver.resolve, 'function');
  assert.equal(typeof executor.execute, 'function');

  const source = await readFile(new URL('../../packages/providers/src/http-transport.ts', import.meta.url), 'utf8');
  for (const required of [
    "from 'node:dns/promises'",
    "from 'node:https'",
    "from 'node:net'",
    "all: true",
    "order: 'verbatim'",
    'servername:',
    'rejectUnauthorized: true',
    "minVersion: 'TLSv1.2'",
    'agent: false',
    'maxHeaderSize:',
  ]) assert.equal(source.includes(required), true, required);
  for (const forbidden of ['fetch(', 'redirect: \'follow\'', 'maxRetries', 'retry(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('A11 remains unbound from A5 retained-provider adapters and default real provider authority stays zero', async () => {
  requireA11();
  const indexSource = await readFile(new URL('../../packages/providers/src/index.ts', import.meta.url), 'utf8');
  assert.equal(indexSource.includes('createStrictProviderHttpTransport('), false);
  const parsed = providers.parseProviderActivationRegistry(providers.DEFAULT_PROVIDER_ACTIVATION_REGISTRY);
  assert.equal(parsed.ok, true);
  const authorizer = providers.createProviderOperationAuthorizer({ registry: parsed.registry });
  for (const provider of ['akkadpag', 'flevopay']) {
    const lineage = provider === 'akkadpag' ? LINEAGE : 'flevopay-legacy-app-api-v1';
    for (const environment of ['sandbox', 'production']) {
      for (const operation of [
        'pix_in_create', 'pix_in_query', 'pix_in_recover',
        'pix_out_create', 'pix_out_query', 'pix_out_recover', 'webhook_verify',
      ]) {
        assert.equal(authorizer.authorize({ provider, operation, environment, contractLineage: lineage }).kind, 'denied');
      }
    }
  }
});
