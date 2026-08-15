import assert from 'node:assert/strict';
import { createRuntimePool } from '../../../packages/db/dist/index.js';
import { createWorkerRuntimeServices } from '../../../apps/worker/dist/runtime.js';

const databaseUrl = process.env.SWIFTPAY_WORKER_DATABASE_URL;
assert.equal(typeof databaseUrl, 'string');
assert.ok(databaseUrl.length > 0);
assert.equal(process.argv.length, 3, 'expected one JSON paid-evidence argument');

const input = JSON.parse(process.argv[2]);
const pool = createRuntimePool({ databaseUrl, workload: 'worker' });

try {
  const services = createWorkerRuntimeServices(pool);
  await services.readinessProbe();
  const result = await services.sandboxPaidEvidence.applyPaidEvidence(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
