import { randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { SignJWT, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { normalizeCanonicalIp } from '../../abuse/dist/index.js';

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

export interface TokenCredentialRecord {
  readonly credentialId: string;
  readonly merchantId: string;
  readonly environment: AuthEnvironment;
  readonly credentialStatus: string;
  readonly secretVerifier: string;
  readonly secretVersion: number;
  readonly ipAllowlist: unknown;
  readonly merchantLifecycleStatus: string;
}

export interface TokenIssuanceResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface TokenAuthStore {
  lookupCredentialForToken(publicKey: string): Promise<TokenCredentialRecord | null>;
  consumeTokenIssuance(credentialId: string): Promise<TokenIssuanceResult>;
}

export interface CredentialAuthState {
  readonly credentialId: string;
  readonly merchantId: string;
  readonly environment: AuthEnvironment;
  readonly credentialStatus: string;
  readonly secretVersion: number;
  readonly merchantLifecycleStatus: string;
}

export interface BearerAuthStore {
  getCredentialAuthState(credentialId: string): Promise<CredentialAuthState | null>;
}

export interface MachinePrincipal {
  readonly merchantId: string;
  readonly credentialId: string;
  readonly environment: AuthEnvironment;
  readonly secretVersion: number;
  readonly tokenId: string;
}

export interface AccessTokenSigningKeyEntry {
  readonly id: string;
  readonly secret: string;
}

export interface AccessTokenSigningAuthorityInput {
  readonly activeKeyId: string;
  readonly keys: readonly AccessTokenSigningKeyEntry[];
  readonly legacyNoKidKey?: string;
}

export interface AccessTokenSigningAuthority {
  readonly activeKeyId: string;
}

export interface TokenExchangeServiceOptions {
  readonly signingAuthority: AccessTokenSigningAuthority;
  readonly nowSeconds?: () => number;
  readonly jti?: () => string;
}

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
const MAX_SIGNING_KEYS = 4;
const KEY_ID_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_SHAPE = /^[A-Za-z0-9_-]+$/;

interface AccessTokenSigningAuthorityState {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
  readonly legacyNoKidKey?: Buffer;
}

const signingAuthorityState = new WeakMap<object, AccessTokenSigningAuthorityState>();

const VALIDATION_FAILURE: TokenExchangeResult = {
  ok: false,
  error: { code: 'validation_error', message: 'Invalid token request.' },
};
const INVALID_CREDENTIALS_FAILURE: TokenExchangeResult = {
  ok: false,
  error: { code: 'invalid_credentials', message: 'Invalid credentials.' },
};
const IP_NOT_ALLOWED_FAILURE: TokenExchangeResult = {
  ok: false,
  error: { code: 'ip_not_allowed', message: 'IP address is not allowed.' },
};
const INTERNAL_FAILURE: TokenExchangeResult = {
  ok: false,
  error: { code: 'internal_error', message: 'Authentication is unavailable.' },
};

export class SigningKeyError extends Error {
  constructor(message = 'Invalid access-token signing authority.') {
    super(message);
    this.name = 'SigningKeyError';
  }
}

function signingKeyBytes(signingKey: string): Buffer {
  if (typeof signingKey !== 'string') throw new SigningKeyError();
  const bytes = Buffer.from(signingKey, 'utf8');
  if (bytes.byteLength < MIN_SIGNING_KEY_BYTES) throw new SigningKeyError();
  return bytes;
}

function hasExactFields(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((field, index) => field === wanted[index]);
}

export function createAccessTokenSigningAuthority(
  input: AccessTokenSigningAuthorityInput,
): AccessTokenSigningAuthority {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new SigningKeyError();
  const allowedInputFields = input.legacyNoKidKey === undefined
    ? ['activeKeyId', 'keys']
    : ['activeKeyId', 'keys', 'legacyNoKidKey'];
  if (!hasExactFields(input, allowedInputFields)) throw new SigningKeyError();
  if (typeof input.activeKeyId !== 'string' || !KEY_ID_SHAPE.test(input.activeKeyId)) throw new SigningKeyError();
  if (!Array.isArray(input.keys) || input.keys.length < 1 || input.keys.length > MAX_SIGNING_KEYS) {
    throw new SigningKeyError();
  }

  const keys = new Map<string, Buffer>();
  const secrets = new Set<string>();
  for (const entry of input.keys) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !hasExactFields(entry, ['id', 'secret'])) {
      throw new SigningKeyError();
    }
    if (typeof entry.id !== 'string' || !KEY_ID_SHAPE.test(entry.id) || keys.has(entry.id)) throw new SigningKeyError();
    if (typeof entry.secret !== 'string' || secrets.has(entry.secret)) throw new SigningKeyError();
    const key = signingKeyBytes(entry.secret);
    secrets.add(entry.secret);
    keys.set(entry.id, Buffer.from(key));
  }
  if (!keys.has(input.activeKeyId)) throw new SigningKeyError();

  const legacyNoKidKey = input.legacyNoKidKey === undefined
    ? undefined
    : Buffer.from(signingKeyBytes(input.legacyNoKidKey));
  const authority = Object.freeze({ activeKeyId: input.activeKeyId });
  signingAuthorityState.set(authority, {
    activeKeyId: input.activeKeyId,
    keys,
    ...(legacyNoKidKey === undefined ? {} : { legacyNoKidKey }),
  });
  return authority;
}

function requiredSigningAuthorityState(authority: AccessTokenSigningAuthority): AccessTokenSigningAuthorityState {
  if (authority === null || typeof authority !== 'object') throw new SigningKeyError();
  const state = signingAuthorityState.get(authority);
  if (state === undefined) throw new SigningKeyError();
  return state;
}

function optionalSigningAuthorityState(authority: AccessTokenSigningAuthority): AccessTokenSigningAuthorityState | null {
  if (authority === null || typeof authority !== 'object') return null;
  return signingAuthorityState.get(authority) ?? null;
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
  const canonicalClientIp = normalizeCanonicalIp(clientIp);
  if (canonicalClientIp === null) return false;
  if (allowlist === null) return true;
  if (!Array.isArray(allowlist)) return false;
  if (allowlist.length === 0) return true;

  const canonicalAllowlist: string[] = [];
  for (const entry of allowlist) {
    if (typeof entry !== 'string') return false;
    const canonicalEntry = normalizeCanonicalIp(entry);
    if (canonicalEntry === null) return false;
    canonicalAllowlist.push(canonicalEntry);
  }

  return canonicalAllowlist.includes(canonicalClientIp);
}

export async function issueAccessToken(
  input: AccessTokenInput,
  authority: AccessTokenSigningAuthority,
): Promise<string> {
  const state = requiredSigningAuthorityState(authority);
  const key = state.keys.get(state.activeKeyId);
  if (key === undefined) throw new SigningKeyError();

  return new SignJWT({
    credential_id: input.credentialId,
    environment: input.environment,
    secret_version: input.secretVersion,
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM, kid: state.activeKeyId })
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

function selectedVerificationKey(
  token: string,
  state: AccessTokenSigningAuthorityState,
): Buffer | null {
  try {
    const header = decodeProtectedHeader(token);
    if (header.kid === undefined) {
      if (!hasExactFields(header, ['alg']) || header.alg !== JWT_ALGORITHM) return null;
      return state.legacyNoKidKey ?? null;
    }
    if (
      !hasExactFields(header, ['alg', 'kid'])
      || header.alg !== JWT_ALGORITHM
      || typeof header.kid !== 'string'
      || !KEY_ID_SHAPE.test(header.kid)
    ) {
      return null;
    }
    return state.keys.get(header.kid) ?? null;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(
  token: string,
  authority: AccessTokenSigningAuthority,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AccessTokenClaims | null> {
  const state = optionalSigningAuthorityState(authority);
  if (state === null) return null;
  const key = selectedVerificationKey(token, state);
  if (key === null) return null;

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

export async function authenticateAccessToken(
  token: string,
  authority: AccessTokenSigningAuthority,
  store: BearerAuthStore,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MachinePrincipal | null> {
  const claims = await verifyAccessToken(token, authority, nowSeconds);
  if (claims === null) return null;

  const state = await store.getCredentialAuthState(claims.credential_id);
  if (
    state === null
    || state.credentialStatus !== 'active'
    || state.merchantLifecycleStatus !== 'active'
    || state.credentialId !== claims.credential_id
    || state.merchantId !== claims.sub
    || state.environment !== claims.environment
    || state.secretVersion !== claims.secret_version
  ) {
    return null;
  }

  return {
    merchantId: claims.sub,
    credentialId: claims.credential_id,
    environment: claims.environment,
    secretVersion: claims.secret_version,
    tokenId: claims.jti,
  };
}

function normalizeTokenExchangeRequest(request: TokenExchangeRequest): TokenExchangeRequest | null {
  if (
    request === null
    || typeof request !== 'object'
    || request.grantType !== 'client_credentials'
    || typeof request.publicKey !== 'string'
    || typeof request.secretKey !== 'string'
    || request.publicKey.length > 160
    || request.secretKey.length === 0
    || request.secretKey.length > 512
  ) {
    return null;
  }

  const publicKey = request.publicKey.trim();
  if (publicKey.length === 0) return null;

  return {
    grantType: 'client_credentials',
    publicKey,
    secretKey: request.secretKey,
  };
}

function credentialCanAuthenticate(record: TokenCredentialRecord): boolean {
  return record.credentialStatus === 'active' && record.merchantLifecycleStatus === 'active';
}

export function createTokenExchangeHandler(
  store: TokenAuthStore,
  options: TokenExchangeServiceOptions,
): TokenExchangeHandler {
  requiredSigningAuthorityState(options.signingAuthority);
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const createJti = options.jti ?? randomUUID;

  return async (request, context) => {
    const normalizedRequest = normalizeTokenExchangeRequest(request);
    if (normalizedRequest === null) return VALIDATION_FAILURE;

    try {
      const credential = await store.lookupCredentialForToken(normalizedRequest.publicKey);
      if (credential === null || !credentialCanAuthenticate(credential)) {
        return INVALID_CREDENTIALS_FAILURE;
      }

      const secretMatches = await verifyCredentialSecret(
        normalizedRequest.secretKey,
        credential.secretVerifier,
      );
      if (!secretMatches) return INVALID_CREDENTIALS_FAILURE;

      if (!evaluateExactIpAllowlist(context.clientIp, credential.ipAllowlist)) {
        return IP_NOT_ALLOWED_FAILURE;
      }

      const quota = await store.consumeTokenIssuance(credential.credentialId);
      if (!quota.allowed) {
        if (!Number.isSafeInteger(quota.retryAfterSeconds) || quota.retryAfterSeconds < 1) {
          return INTERNAL_FAILURE;
        }
        return {
          ok: false,
          error: {
            code: 'auth_rate_limit_exceeded',
            message: 'Token issuance rate limit exceeded.',
            retryAfterSeconds: quota.retryAfterSeconds,
          },
        };
      }

      const accessToken = await issueAccessToken({
        merchantId: credential.merchantId,
        credentialId: credential.credentialId,
        environment: credential.environment,
        secretVersion: credential.secretVersion,
        jti: createJti(),
        nowSeconds: nowSeconds(),
      }, options.signingAuthority);

      return {
        ok: true,
        value: {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: JWT_TTL_SECONDS,
          environment: credential.environment,
        },
      };
    } catch {
      return INTERNAL_FAILURE;
    }
  };
}

import {
  createDashboardAuthorizationService as createDashboardAuthorizationServiceImpl,
  createSupabaseDashboardSessionVerifier as createSupabaseDashboardSessionVerifierImpl,
} from './dashboard.js';

export const createSupabaseDashboardSessionVerifier = createSupabaseDashboardSessionVerifierImpl;
export const createDashboardAuthorizationService = createDashboardAuthorizationServiceImpl;
export type {
  DashboardAuthTransport,
  DashboardAuthTransportRequest,
  DashboardAuthTransportResponse,
  DashboardAuthorizationInput,
  DashboardAuthorizationResult,
  DashboardAuthorizationService,
  DashboardMerchantContext,
  DashboardMerchantContextInput,
  DashboardMerchantContextResult,
  DashboardMerchantContextStore,
  DashboardSessionVerificationResult,
  DashboardSessionVerifier,
  DashboardSessionVerifierOptions,
  DashboardUserPrincipal,
} from './dashboard.js';

export * from './dashboard-context-discovery.js';
export * from './a8.js';
