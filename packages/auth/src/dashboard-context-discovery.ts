import type { DashboardSessionVerifier } from './dashboard.js';

export type DashboardContextLifecycleStatus = 'draft' | 'active' | 'suspended' | 'closed';
export type DashboardContextMembershipRole = 'member' | 'admin' | 'owner';

export interface DashboardContextDiscoveryItem {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly lifecycleStatus: DashboardContextLifecycleStatus;
  readonly membershipRole: DashboardContextMembershipRole;
  readonly environments: readonly ['sandbox', 'production'];
}

export interface DashboardContextDiscoveryStorePort {
  listForUser(userId: string): Promise<readonly DashboardContextDiscoveryItem[]>;
}

export type DashboardContextDiscoveryResult =
  | { readonly kind: 'ok'; readonly contexts: readonly DashboardContextDiscoveryItem[] }
  | { readonly kind: 'invalid_session' }
  | { readonly kind: 'authentication_unavailable' }
  | { readonly kind: 'internal_error' };

export interface DashboardContextDiscoveryService {
  list(authorization: unknown): Promise<DashboardContextDiscoveryResult>;
}

export function createDashboardContextDiscoveryService(options: {
  readonly sessionVerifier: DashboardSessionVerifier;
  readonly store: DashboardContextDiscoveryStorePort;
}): DashboardContextDiscoveryService {
  return {
    async list(authorization) {
      let verification;
      try {
        verification = await options.sessionVerifier(authorization);
      } catch {
        return { kind: 'internal_error' };
      }

      if (verification.kind !== 'authenticated') return verification;

      try {
        const contexts = await options.store.listForUser(verification.principal.userId);
        return { kind: 'ok', contexts };
      } catch {
        return { kind: 'internal_error' };
      }
    },
  };
}
