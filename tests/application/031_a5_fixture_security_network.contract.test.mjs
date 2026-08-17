import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'tests/application/provider-fixtures');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out.sort();
}

test('A5 fixture manifests are explicit synthetic fixture-only evidence and block production activation', async () => {
  for (const provider of ['akkadpag', 'flevopay']) {
    const manifest = JSON.parse(await readFile(path.join(FIXTURES, provider, 'manifest.json'), 'utf8'));
    assert.equal(manifest.provider, provider);
    assert.equal(manifest.evidence_classification, 'proven_legacy');
    assert.equal(manifest.contains_real_secrets, false);
    assert.equal(manifest.contains_real_pii, false);
    assert.equal(manifest.production_activation, 'blocked');
    assert.ok(Array.isArray(manifest.source_artifacts) && manifest.source_artifacts.length >= 4);
  }
});

test('A5 frozen fixture inventory is complete and every fixture parses as JSON', async () => {
  const expected = {
    akkadpag: [
      'manifest.json',
      'payout-create-completed.json',
      'payout-create-processing.json',
      'payout-unknown-status.json',
      'pix-create-ambiguous-4xx.json',
      'pix-create-ambiguous-5xx.json',
      'pix-create-malformed-2xx.json',
      'pix-create-success.json',
      'pix-query-paid.json',
      'pix-query-pending.json',
      'pix-query-unknown-status.json',
      'webhook-known-status.json',
      'webhook-unknown-status.json',
    ],
    flevopay: [
      'manifest.json',
      'pix-create-ambiguous-4xx.json',
      'pix-create-ambiguous-5xx.json',
      'pix-create-malformed-2xx.json',
      'pix-create-success.json',
      'pix-query-paid.json',
      'pix-query-pending.json',
      'pix-query-unknown-status.json',
      'webhook-known-status.json',
      'webhook-unknown-status.json',
    ],
  };
  for (const [provider, names] of Object.entries(expected)) {
    const actual = (await readdir(path.join(FIXTURES, provider))).sort();
    assert.deepEqual(actual, names);
    for (const name of actual) {
      JSON.parse(await readFile(path.join(FIXTURES, provider, name), 'utf8'));
    }
  }
});

test('A5 fixture corpus uses reserved synthetic domains and contains no production activation marker', async () => {
  const files = await walk(FIXTURES);
  const corpus = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  assert.match(corpus, /example\.invalid/);
  assert.doesNotMatch(corpus, /production_activation"\s*:\s*"enabled"/i);
  assert.doesNotMatch(corpus, /"contains_real_secrets"\s*:\s*true/i);
  assert.doesNotMatch(corpus, /"contains_real_pii"\s*:\s*true/i);
});

test('A5 retained adapters remain network-free while A11 is the only provider-package Node network boundary', async () => {
  const sourceDir = path.join(ROOT, 'packages/providers/src');
  try {
    await access(sourceDir, constants.R_OK);
  } catch {
    return;
  }
  const files = (await walk(sourceDir)).filter((file) => /\.(?:ts|mts|js|mjs)$/.test(file));
  const sources = await Promise.all(files.map(async (file) => ({
    file,
    source: await readFile(file, 'utf8'),
  })));
  const networkBoundaryFiles = sources
    .filter(({ source }) => /node:(?:http|https|dns|net|tls)/.test(source) || /\bfetch\s*\(/.test(source))
    .map(({ file }) => path.relative(sourceDir, file).replaceAll(path.sep, '/'));
  assert.deepEqual(networkBoundaryFiles, ['http-transport.ts']);

  const retainedAdapterSource = sources
    .filter(({ file }) => path.basename(file) !== 'http-transport.ts')
    .map(({ source }) => source)
    .join('\n');
  assert.doesNotMatch(retainedAdapterSource, /node:(?:http|https|dns|net|tls)/);
  assert.doesNotMatch(retainedAdapterSource, /\bfetch\s*\(/);

  const source = sources.map(({ source: value }) => value).join('\n');
  assert.doesNotMatch(source, /\bAKKADPAG_(?:API|SECRET|TOKEN|KEY)/);
  assert.doesNotMatch(source, /\bFLEVOPAY_(?:API|SECRET|TOKEN|KEY)/);
});
