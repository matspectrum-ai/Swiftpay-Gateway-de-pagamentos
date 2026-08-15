import {
  createSandboxPaidEvidenceStore,
  verifyRuntimeBoundary,
  type SandboxPaidEvidenceDatabaseStore,
} from '@swiftpay/db';

type WorkerRuntimePool = Parameters<typeof verifyRuntimeBoundary>[0];

export interface WorkerRuntimeServices {
  readonly readinessProbe: () => Promise<void>;
  readonly sandboxPaidEvidence: SandboxPaidEvidenceDatabaseStore;
}

export function createWorkerRuntimeServices(
  pool: WorkerRuntimePool,
): WorkerRuntimeServices {
  return {
    readinessProbe: () => verifyRuntimeBoundary(pool, 'worker'),
    sandboxPaidEvidence: createSandboxPaidEvidenceStore(pool),
  };
}
