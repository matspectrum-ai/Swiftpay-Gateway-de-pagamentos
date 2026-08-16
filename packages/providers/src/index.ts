export interface ProviderTransport {
  send(request: unknown): Promise<unknown>;
}

export interface ProviderAdapterOptions {
  transport: ProviderTransport;
}

export class ProviderTransportError extends Error {
  readonly kind: string;
  readonly code: string | undefined;

  constructor(kind: string, code?: string) {
    super('Provider transport failed.');
    this.name = 'ProviderTransportError';
    this.kind = kind;
    this.code = code;
  }
}

export const PROVIDER_CAPABILITIES = Object.freeze({});

function createUnimplementedAdapter(_options: ProviderAdapterOptions) {
  return {
    async createPixCharge(_input: unknown) {
      return { kind: 'not_implemented' as const };
    },
    async queryPixCharge(_input: unknown) {
      return { kind: 'not_implemented' as const };
    },
    async createPixPayout(_input: unknown) {
      return { kind: 'not_implemented' as const };
    },
    async createRefund(_input: unknown) {
      return { kind: 'not_implemented' as const };
    },
    async verifyWebhook(_input: unknown) {
      return { kind: 'not_implemented' as const, trusted: false as const };
    },
  };
}

export function createAkkadPagAdapter(options: ProviderAdapterOptions) {
  return createUnimplementedAdapter(options);
}

export function createFlevoPayAdapter(options: ProviderAdapterOptions) {
  return createUnimplementedAdapter(options);
}
