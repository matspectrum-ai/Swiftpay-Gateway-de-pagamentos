import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function text(path) {
  return readFile(path, 'utf8');
}

const requiredFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'apps/api/package.json',
  'apps/api/src/app.ts',
  'apps/api/src/index.ts',
  'apps/worker/package.json',
  'apps/worker/src/index.ts',
  'packages/config/package.json',
  'packages/config/src/index.ts',
  'packages/db/package.json',
  'packages/db/src/index.ts',
];

test('K7 workspace files exist', async () => {
  const missing = [];
  for (const path of requiredFiles) {
    if (!(await exists(path))) missing.push(path);
  }
  assert.deepEqual(missing, [], `missing K7 runtime files: ${missing.join(', ')}`);
});

test('root manifest freezes pnpm workspace semantics', async () => {
  assert.equal(await exists('package.json'), true, 'package.json must exist');
  const manifest = JSON.parse(await text('package.json'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.packageManager, 'pnpm@11.17.0');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.engines?.node, '>=24 <25');
  assert.equal(typeof manifest.scripts?.typecheck, 'string');
  assert.equal(typeof manifest.scripts?.test, 'string');
});

test('workspace includes apps and packages only', async () => {
  assert.equal(await exists('pnpm-workspace.yaml'), true, 'pnpm-workspace.yaml must exist');
  const workspace = await text('pnpm-workspace.yaml');
  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
});

test('bootstrap source names only workload-specific database URLs', async () => {
  const candidatePaths = [
    'apps/api/src/app.ts',
    'apps/api/src/index.ts',
    'apps/worker/src/index.ts',
    'packages/config/src/index.ts',
    'packages/db/src/index.ts',
  ];
  const source = (await Promise.all(candidatePaths.map(async (path) => (await exists(path)) ? text(path) : ''))).join('\n');

  assert.match(source, /SWIFTPAY_API_DATABASE_URL/);
  assert.match(source, /SWIFTPAY_WORKER_DATABASE_URL/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /AKKAD.*(SECRET|KEY)|FLEVO.*(SECRET|KEY)/i);
});

test('API source declares distinct liveness and readiness routes', async () => {
  assert.equal(await exists('apps/api/src/app.ts'), true, 'API app source must exist');
  const source = await text('apps/api/src/app.ts');
  assert.match(source, /\/health\/live/);
  assert.match(source, /\/health\/ready/);
  assert.match(source, /status:\s*['"]live['"]/);
  assert.match(source, /workload:\s*['"]api['"]/);
});

test('worker exposes deterministic one-shot check mode', async () => {
  assert.equal(await exists('apps/worker/src/index.ts'), true, 'worker source must exist');
  const source = await text('apps/worker/src/index.ts');
  assert.match(source, /--check/);
  assert.match(source, /worker/i);
});
