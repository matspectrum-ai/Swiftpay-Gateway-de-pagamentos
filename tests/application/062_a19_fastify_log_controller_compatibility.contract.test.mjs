import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP_SOURCE = path.join(ROOT, 'apps/api/src/app.ts');

async function buildTokenApp(extra = {}) {
  const api = await import('../../apps/api/dist/app.js');
  return api.buildApp({
    readinessProbe: async () => {},
    tokenExchange: async () => ({
      ok: false,
      error: { code: 'validation_error', message: 'Invalid token request.' },
    }),
    ...extra,
  });
}

function captureLogger() {
  const events = [];
  return {
    events,
    logger: {
      log(event) {
        events.push(structuredClone(event));
        return true;
      },
    },
  };
}

test('A19 Fastify construction uses stock LogController instead of deprecated top-level disableRequestLogging', async () => {
  const source = await readFile(APP_SOURCE, 'utf8');

  assert.match(source, /import\s+Fastify,[\s\S]*\bLogController\b[\s\S]*from\s+['"]fastify['"]/);
  assert.match(
    source,
    /logController:\s*new\s+LogController\(\{\s*disableRequestLogging:\s*true,?\s*\}\)/s,
  );
  assert.doesNotMatch(
    source,
    /Fastify\(\{\s*logger:\s*false,\s*disableRequestLogging:/s,
  );
  assert.match(source, /Fastify\(\{\s*logger:\s*false,/s);
  assert.match(source, /requestIdHeader:\s*false/);
  assert.match(source, /genReqId:\s*\(\)\s*=>\s*randomUUID\(\)/);
});

test('A19 uses no custom LogController subclass, override or deprecation suppression', async () => {
  const [source, packageJson, workflow] = await Promise.all([
    readFile(APP_SOURCE, 'utf8'),
    readFile(path.join(ROOT, 'apps/api/package.json'), 'utf8'),
    readFile(path.join(ROOT, '.github/workflows/application-contracts.yml'), 'utf8'),
  ]);
  const combined = `${source}\n${packageJson}\n${workflow}`;

  assert.doesNotMatch(source, /class\s+\w+\s+extends\s+LogController/);
  assert.doesNotMatch(source, /\.incomingRequest\s*=|\.requestCompleted\s*=|isLogDisabled\s*\(/);
  assert.doesNotMatch(combined, /NODE_NO_WARNINGS|--no-warnings|--no-deprecation|FSTDEP023.*(?:ignore|filter|suppress)/i);
  assert.doesNotMatch(source, /logger:\s*true|loggerInstance\s*:/);
});

test('A19 buildApp emits no FSTDEP023 in an isolated Node process', () => {
  const appModuleUrl = pathToFileURL(path.join(ROOT, 'apps/api/dist/app.js')).href;
  const program = `
    const { buildApp } = await import(${JSON.stringify(appModuleUrl)});
    const app = buildApp({ readinessProbe: async () => {} });
    await app.close();
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });

  assert.equal(
    result.status,
    0,
    `buildApp child process failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stderr, /FSTDEP023|disableRequestLogging.*deprecated/i);
});

test('A19 preserves A12 server-owned request correlation and exactly-one safe completion event', async () => {
  const captured = captureLogger();
  let now = 100;
  const app = await buildTokenApp({
    runtimeLogger: captured.logger,
    monotonicNow: () => {
      const current = now;
      now = 117;
      return current;
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/token?private=must-not-log',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'caller-controlled-request-id',
      },
      payload: { grantType: 'bad', secretKey: 'body-secret-canary' },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(captured.events.length, 1);
    assert.deepEqual(captured.events[0], {
      level: 'info',
      event: 'http_request_completed',
      workload: 'api',
      requestId: response.headers['x-request-id'],
      method: 'POST',
      route: '/v1/auth/token',
      statusCode: 400,
      durationMs: 17,
    });
    assert.notEqual(response.headers['x-request-id'], 'caller-controlled-request-id');
    assert.doesNotMatch(JSON.stringify(captured.events), /must-not-log|body-secret-canary|caller-controlled-request-id/);
  } finally {
    await app.close();
  }
});

test('A19 has no database, worker, provider or monetary implementation surface', async () => {
  const [apiSource, workerSource] = await Promise.all([
    readFile(APP_SOURCE, 'utf8'),
    readFile(path.join(ROOT, 'apps/worker/src/index.ts'), 'utf8'),
  ]);

  assert.doesNotMatch(apiSource, /FSTDEP023/);
  assert.doesNotMatch(workerSource, /LogController|disableRequestLogging|FSTDEP023/);
});
