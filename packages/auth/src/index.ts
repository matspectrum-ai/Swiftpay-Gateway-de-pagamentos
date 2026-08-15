import { scrypt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

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

export interface AccessTokenInput {
  readonly merchantId: string;
  readonly credentialId: string;
  readonly environment: AuthEnvironment;
  readonly secretVersion: number;
  readonly jti: string;
  readonly nowSeconds: number;
}

const SCRYPT_VERSION = 'scrypt-v1';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_DERIVED_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY_BYTES = 64 * 1024 * 1024;

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'swiftpay';
const JWT_AUDIENCE = 'swiftpay-api';
const JWT_TTL_SECONDS = 900;
const MIN_SIGNING_KEY_BYTES = 32;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_SHAPE = /^[A-Za-z0-9_-]+$/;

export class SigningKeyError extends Error {
  constructor() {
    super(`Access-token signing key must contain at least ${MIN_SIGNING_KEY_BYTES} UTF-8 bytes`);
    this.name = 'SigningKeyError';
  }
}

function signingKeyBytes(signingKey: string): Buffer {
  const bytes = Buffer.from(signingKey, 'utf8');
  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES) {
    throw new SigningKeyError();
  }
  return bytes;
}

function decodeCanonicalBase64Url(value: string, expectedBytes: number): Buffer | null {
  if (!BASE64URL_SHAPE.test(value)) return null;

  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.byteLength !== expectedBytes) return null;
    if (decoded.toString('base64url') !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}

function deriveScryptKey(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      secret,
      salt,
      SCRYPT_DERIVED_KEY_BYTES,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY_BYTES,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function verifyCredentialSecret(secret: string, verifier: string): Promise<boolean> {
  if (typeof secret !== 'string' || typeof verifier !== 'string') return false;

  const parts = verifier.split('$');
  if (parts.length !== 6) return false;

  const [version, n, r, p, encodedSalt, encodedDerivedKey] = parts;
  if (
    version !== SCRYPT_VERSION
    || n !== String(SCRYPT_N)
    || r !== String(SCRYPT_R)
    || p !== String(SCRYPT_P)
    || encodedSalt === undefined
    || encodedDerivedKey === undefined
  ) {
    return false;
  }

  const salt = decodeCanonicalBase64Url(encodedSalt, SCRYPT_SALT_BYTES);
  const expectedKey = decodeCanonicalBase64Url(encodedDerivedKey, SCRYPT_DERIVED_KEY_BYTES);
  if (salt === null || expectedKey === null) return false;

  try {
    const actualKey = await deriveScryptKey(secret, salt);
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

export function evaluateExactIpAllowlist(clientIp: string, allowlist: unknown): boolean {
  if (typeof clientIp !== 'string' || isIP(clientIp) === 0) return false;
  if (allowlist === null) return true;
  if (!Array.isArray(allowlist)) return false;
  if (allowlist.length === 0) return true;

  for (const entry of allowlist) {
    if (typeof entry !== 'string' || isIP(entry) === 0) return false;
  }

  return allowlist.includes(clientIp);
}

export async function issueAccessToken(input: AccessTokenInput, signingKey: string): Promise<string> {
  const key = signingKeyBytes(signingKey);

  return new SignJWT({
    credential_id: input.credentialId,
    environment: input.environment,
    secret_version: input.secretVersion,
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(input.merchantId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setJti(input.jti)
    .setIssuedAt(input.nowSeconds)
    .setExpirationTime(input.nowSeconds + JWT_TTL_SECONDS)
    .sign(key);
}

function hasCanonicalAccessTokenClaims(payload: JWTPayload): payload is AccessTokenClaims {
  return (
    typeof payload.sub === 'string'
    && UUID_SHAPE.test(payload.sub)
    && typeof payload.credential_id === 'string'
    && UUID_SHAPE.test(payload.credential_id)
    && (payload.environment === 'sandbox' || payload.environment === 'production')
    && typeof payload.secret_version === 'number'
    && Number.isSafeInteger(payload.secret_version)
    && payload.secret_version > 0
    && typeof payload.jti === 'string'
    && UUID_SHAPE.test(payload.jti)
    && typeof payload.iat === 'number'
    && Number.isSafeInteger(payload.iat)
    && typeof payload.exp === 'number'
    && Number.isSafeInteger(payload.exp)
    && payload.exp - payload.iat === JWT_TTL_SECONDS
    && payload.iss === JWT_ISSUER
    && payload.aud === JWT_AUDIENCE
  );
}

export async function verifyAccessToken(
  token: string,
  signingKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AccessTokenClaims | null> {
  const key = signingKeyBytes(signingKey);

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      currentDate: new Date(nowSeconds * 1000),
      clockTolerance: 0,
    });

    return hasCanonicalAccessTokenClaims(payload) ? payload : null;
  } catch {
    return null;
  }
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
