import type { JWTPayload } from 'jose';

export type AuthEnvironment = 'sandbox' | 'production';

export interface TokenExchangeRequest {
  readonly grantType: string;
  readonly publicKey: string;
  readonly secretKey: string;
}

export interface TokenExchangeContext {
  readonly clientIp: string;
  readonly requestId: string;
}

export interface TokenExchangeSuccess {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: 900;
  readonly environment: AuthEnvironment;
}

export interface TokenExchangeFailure {
  readonly code:
    | 'validation_error'
    | 'invalid_credentials'
    | 'ip_not_allowed'
    | 'auth_rate_limit_exceeded'
    | 'internal_error';
  readonly message: string;
  readonly retryAfterSeconds?: number;
}

export type TokenExchangeResult =
  | { readonly ok: true; readonly value: TokenExchangeSuccess }
  | { readonly ok: false; readonly error: TokenExchangeFailure };

export type TokenExchangeHandler = (
  request: TokenExchangeRequest,
  context: TokenExchangeContext,
) => Promise<TokenExchangeResult>;

export interface AccessTokenClaims extends JWTPayload {
  readonly sub: string;
  readonly credential_id: string;
  readonly environment: AuthEnvironment;
  readonly secret_version: number;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
}

export class AuthNotImplementedError extends Error {
  constructor() {
    super('A1 authentication behavior not implemented');
    this.name = 'AuthNotImplementedError';
  }
}

export function createUnimplementedTokenExchangeHandler(): TokenExchangeHandler {
  return async () => {
    throw new AuthNotImplementedError();
  };
}
