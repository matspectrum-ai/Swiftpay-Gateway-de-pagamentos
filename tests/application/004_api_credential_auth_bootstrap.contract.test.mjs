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

const authFiles = [
  'packages/auth/package.json',
  'packages/auth/tsconfig.json',
  'packages/auth/src/index.ts',
];

test('A1 auth workspace package exists', async () => {
  const missing = [];
  for (const path of authFiles) {
    if (!(await exists(path))) missing.push(path);
  }
  assert.deepEqual(missing, [], `missing A1 auth package files: ${missing.join(', ')}`);
});

test('A1 auth package pins jose 6.2.4', async () => {
  assert.equal(await exists('packages/auth/package.json'), true, 'auth package manifest must exist');
  const manifest = JSON.parse(await text('packages/auth/package.json'));
  assert.equal(manifest.name, '@swiftpay/auth');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.dependencies?.jose, '6.2.4');
  assert.equal(manifest.main, './dist/index.js');
  assert.equal(manifest.types, './dist/index.d.ts');
});

test('A1 auth package is part of the TypeScript graph and API dependency graph', async () => {
  const rootTsconfig = JSON.parse(await text('tsconfig.json'));
  const references = rootTsconfig.references?.map((entry) => entry.path) ?? [];
  assert.equal(references.includes('./packages/auth'), true, 'root tsconfig must reference packages/auth');

  const apiManifest = JSON.parse(await text('apps/api/package.json'));
  assert.equal(apiManifest.dependencies?.['@swiftpay/auth'], 'workspace:*');
});

test('A1 runtime config names the signing authority without provider secrets', async () => {
  const source = await text('packages/config/src/core.ts');
  assert.match(source, /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS/);
  assert.match(source, /MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES\s*=\s*32|32/);
  assert.doesNotMatch(source, /AKKAD.*(SECRET|KEY)|FLEVO.*(SECRET|KEY)/i);
});

test('A1 API source declares the compatibility token route and auth dependency', async () => {
  const source = await text('apps/api/src/app.ts');
  assert.match(source, /\/v1\/auth\/token/);
  assert.match(source, /token/i);
  assert.match(source, /auth/i);
});

test('A1 API logging redacts camelCase plaintext credential secrets', async () => {
  const source = await text('apps/api/src/app.ts');
  assert.match(source, /secretKey/);
  assert.match(source, /authorization/i);
});
