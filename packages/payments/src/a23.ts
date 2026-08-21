import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';
import type { ClaimPixAttemptResult, PixEmulator, PublicPayment } from './core.js';

export type DashboardPaymentLinkEnvironment = 'sandbox' | 'production';
export type DashboardPaymentLinkRole = 'member' | 'admin' | 'owner';
export interface DashboardPaymentLink { readonly id:string; readonly publicToken:string; readonly checkoutPath:string; readonly status:'active'|'disabled'; readonly amount:number; readonly currency:'BRL'; readonly description:string|null; readonly pixExpirationMinutes:number; readonly createdAt:string; readonly disabledAt:string|null }
export interface PublicPaymentLink { readonly merchantName:string; readonly amount:number; readonly currency:'BRL'; readonly description:string|null; readonly environment:'sandbox'; readonly pixExpirationMinutes:number }

type SessionResult = {kind:'authenticated'; principal:{userId:string}} | {kind:'invalid_session'} | {kind:'authentication_unavailable'};
type ContextResult = {kind:'authorized'; context:{membershipRole:DashboardPaymentLinkRole}} | {kind:'forbidden'|'validation_error'|'internal_error'};
type SessionVerifier = (authorization: unknown) => Promise<SessionResult>;
interface ContextStore { requireContext(input:{userId:string;merchantId:string;environment:DashboardPaymentLinkEnvironment;requiredRole:DashboardPaymentLinkRole}):Promise<ContextResult> }
interface DashboardStore {
  list(input:{userId:string;merchantId:string;environment:DashboardPaymentLinkEnvironment}):Promise<readonly DashboardPaymentLink[]>;
  create(input:{userId:string;merchantId:string;environment:DashboardPaymentLinkEnvironment;idempotencyKey:string;requestHash:string;command:Record<string,unknown>}):Promise<Record<string,unknown>>;
  disable(input:{userId:string;merchantId:string;environment:DashboardPaymentLinkEnvironment;paymentLinkId:string;idempotencyKey:string;requestHash:string;command:Record<string,unknown>}):Promise<Record<string,unknown>>;
}
type PrepareResult =
  | {kind:'prepared';merchantId:string;payment:PublicPayment;providerAttempt:{id:string;amountCents:number;expiresAt:string}}
  | {kind:'completed';httpStatus:201;payment:PublicPayment}
  | {kind:'executing';payment:PublicPayment}
  | {kind:'execution_unknown';payment:PublicPayment}
  | {kind:'not_found'} | {kind:'validation_error'} | {kind:'conflict'};
interface CheckoutStore { getLink(token:string):Promise<PublicPaymentLink|null>; preparePayment(input:{publicToken:string;idempotencyKey:string;requestHash:string}):Promise<PrepareResult> }
interface PixStore {
  claimPixAttempt(input:{merchantId:string;environment:'sandbox';paymentId:string;providerAttemptId:string}):Promise<ClaimPixAttemptResult>;
  resolvePixAttempt(input:{merchantId:string;environment:'sandbox';paymentId:string;providerAttemptId:string;executionToken:string;resolution:unknown}):Promise<PublicPayment>;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN=/^plink_sandbox_[A-Za-z0-9_-]{32}$/;
const CREATE_KEYS=new Set(['amount','currency','description','pixExpirationMinutes']);
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const hash=(ns:string,v:readonly unknown[])=>createHash('sha256').update(`${ns}\n${JSON.stringify(v)}`,'utf8').digest('hex');
const key=(v:unknown)=>typeof v==='string'&&v.trim().length>=1&&v.trim().length<=160?v.trim():null;
const env=(v:string):DashboardPaymentLinkEnvironment|null=>v==='sandbox'||v==='production'?v:null;
const resultKind=(v:unknown)=>record(v)&&typeof v.kind==='string'?v.kind:'internal_error';

export function generatePaymentLinkPublicToken(randomBytes:(size:number)=>Buffer=cryptoRandomBytes):string {
  const bytes=randomBytes(24);
  if(!Buffer.isBuffer(bytes)||bytes.length!==24) throw new Error('Invalid payment-link token generator.');
  return `plink_sandbox_${bytes.toString('base64url')}`;
}

async function authorize(verifier:SessionVerifier,contexts:ContextStore,input:{authorization?:string|undefined;merchantId:string;environment:string;requiredRole:DashboardPaymentLinkRole}) {
  const environment=env(input.environment);
  if(!UUID.test(input.merchantId)||environment===null) return {kind:'validation_error'} as const;
  const session=await verifier(input.authorization);
  if(session.kind!=='authenticated') return session;
  const context=await contexts.requireContext({userId:session.principal.userId,merchantId:input.merchantId,environment,requiredRole:input.requiredRole});
  if(context.kind!=='authorized') return context;
  return {kind:'authorized' as const,userId:session.principal.userId,environment};
}

function createRequest(v:unknown):{amount:number;currency:'BRL';description:string|null;pixExpirationMinutes:number}|null {
  if(!record(v)||Object.keys(v).some(k=>!CREATE_KEYS.has(k))||typeof v.amount!=='number'||!Number.isSafeInteger(v.amount)||v.amount<1||v.currency!=='BRL') return null;
  if('description' in v&&typeof v.description!=='string') return null;
  const expiration='pixExpirationMinutes' in v?v.pixExpirationMinutes:60;
  if(typeof expiration!=='number'||!Number.isSafeInteger(expiration)||expiration<5||expiration>1440) return null;
  return {amount:v.amount,currency:'BRL',description:typeof v.description==='string'?v.description:null,pixExpirationMinutes:expiration};
}

export function createDashboardPaymentLinksService(options:{sessionVerifier:SessionVerifier;contextStore:ContextStore;store:DashboardStore;randomBytes?:((size:number)=>Buffer)|undefined}) {
  return Object.freeze({
    async list(input:{authorization?:string|undefined;merchantId:string;environment:string}):Promise<Record<string,unknown>> {
      try {
        const auth=await authorize(options.sessionVerifier,options.contextStore,{...input,requiredRole:'member'});
        if(auth.kind!=='authorized') return auth;
        return {kind:'ok',data:await options.store.list({userId:auth.userId,merchantId:input.merchantId,environment:auth.environment})};
      } catch { return {kind:'internal_error'}; }
    },
    async create(input:{authorization?:string|undefined;merchantId:string;environment:string;idempotencyKey?:string|undefined;request:unknown}):Promise<Record<string,unknown>> {
      try {
        const auth=await authorize(options.sessionVerifier,options.contextStore,{authorization:input.authorization,merchantId:input.merchantId,environment:input.environment,requiredRole:'admin'});
        if(auth.kind!=='authorized') return auth;
        if(auth.environment==='production') return {kind:'forbidden'};
        const idempotencyKey=key(input.idempotencyKey), request=createRequest(input.request);
        if(idempotencyKey===null||request===null) return {kind:'validation_error'};
        const requestHash=hash('a23-dashboard-payment-link-create-v0',[input.merchantId.toLowerCase(),auth.environment,request.amount,request.currency,request.description,request.pixExpirationMinutes]);
        const command:Record<string,unknown>={...request};
        let result=await options.store.create({userId:auth.userId,merchantId:input.merchantId,environment:auth.environment,idempotencyKey,requestHash,command});
        if(resultKind(result)!=='token_required') return result;
        for(let i=0;i<3;i+=1){
          const publicToken=generatePaymentLinkPublicToken(options.randomBytes);
          result=await options.store.create({userId:auth.userId,merchantId:input.merchantId,environment:auth.environment,idempotencyKey,requestHash,command:{...command,publicToken}});
          if(resultKind(result)!=='token_collision') return result;
        }
        return {kind:'internal_error'};
      } catch { return {kind:'internal_error'}; }
    },
    async disable(input:{authorization?:string|undefined;merchantId:string;environment:string;paymentLinkId:string;idempotencyKey?:string|undefined;request:unknown}):Promise<Record<string,unknown>> {
      try {
        const auth=await authorize(options.sessionVerifier,options.contextStore,{authorization:input.authorization,merchantId:input.merchantId,environment:input.environment,requiredRole:'admin'});
        if(auth.kind!=='authorized') return auth;
        if(auth.environment==='production') return {kind:'forbidden'};
        const idempotencyKey=key(input.idempotencyKey);
        if(idempotencyKey===null||!UUID.test(input.paymentLinkId)||!record(input.request)||Object.keys(input.request).length!==0) return {kind:'validation_error'};
        const requestHash=hash('a23-dashboard-payment-link-disable-v0',[input.merchantId.toLowerCase(),auth.environment,input.paymentLinkId.toLowerCase()]);
        return await options.store.disable({userId:auth.userId,merchantId:input.merchantId,environment:auth.environment,paymentLinkId:input.paymentLinkId,idempotencyKey,requestHash,command:{}});
      } catch { return {kind:'internal_error'}; }
    },
  });
}

export function createHostedCheckoutService(options:{store:CheckoutStore;pixStore:PixStore;emulator:PixEmulator}) {
  return Object.freeze({
    async getLink(publicToken:string):Promise<{kind:'ok';link:PublicPaymentLink}|{kind:'not_found'|'internal_error'}> {
      if(!TOKEN.test(publicToken)) return {kind:'not_found'};
      try { const link=await options.store.getLink(publicToken); return link===null?{kind:'not_found'}:{kind:'ok',link}; }
      catch { return {kind:'internal_error'}; }
    },
    async createPayment(input:{publicToken:string;idempotencyKey:unknown;request:unknown}):Promise<{kind:'ok';httpStatus:201|202;payment:PublicPayment;replayed:boolean}|{kind:'not_found'|'validation_error'|'idempotency_conflict'|'internal_error'}> {
      if(!TOKEN.test(input.publicToken)) return {kind:'not_found'};
      if(!record(input.request)||Object.keys(input.request).length!==0) return {kind:'validation_error'};
      const idempotencyKey=key(input.idempotencyKey); if(idempotencyKey===null) return {kind:'validation_error'};
      try {
        const prepared=await options.store.preparePayment({publicToken:input.publicToken,idempotencyKey,requestHash:hash('a23-checkout-create-payment-v0',[input.publicToken,{}])});
        if(prepared.kind==='not_found') return {kind:'not_found'};
        if(prepared.kind==='validation_error') return {kind:'validation_error'};
        if(prepared.kind==='conflict') return {kind:'idempotency_conflict'};
        if(prepared.kind==='completed') return {kind:'ok',httpStatus:201,payment:prepared.payment,replayed:true};
        if(prepared.kind==='executing'||prepared.kind==='execution_unknown') return {kind:'ok',httpStatus:202,payment:prepared.payment,replayed:true};
        const claim=await options.pixStore.claimPixAttempt({merchantId:prepared.merchantId,environment:'sandbox',paymentId:prepared.payment.id,providerAttemptId:prepared.providerAttempt.id});
        if(!claim.claimed) return {kind:'ok',httpStatus:202,payment:prepared.payment,replayed:true};
        const resolution=await options.emulator.createPixCharge({providerAttemptId:prepared.providerAttempt.id,amountCents:prepared.providerAttempt.amountCents,expiresAt:prepared.providerAttempt.expiresAt});
        const payment=await options.pixStore.resolvePixAttempt({merchantId:prepared.merchantId,environment:'sandbox',paymentId:prepared.payment.id,providerAttemptId:prepared.providerAttempt.id,executionToken:claim.executionToken,resolution});
        return {kind:'ok',httpStatus:resolution.certainty==='execution_unknown'?202:201,payment,replayed:false};
      } catch { return {kind:'internal_error'}; }
    },
  });
}
