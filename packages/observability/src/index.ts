const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_NAME = /^[a-z][a-z0-9_]{0,79}$/;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const LEVELS = new Set(['info', 'warn', 'error']);
const WORKLOADS = new Set(['api', 'worker']);
const BASE_FIELDS = new Set(['level', 'event', 'workload', 'requestId', 'errorCode']);
const HTTP_FIELDS = new Set([
  'level',
  'event',
  'workload',
  'requestId',
  'method',
  'route',
  'statusCode',
  'durationMs',
]);

export type RuntimeLogLevel = 'info' | 'warn' | 'error';
export type RuntimeWorkload = 'api' | 'worker';
export type RuntimeHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface RuntimeClock {
  now(): Date;
}

export interface RuntimeLogSink {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface RuntimeEventBase {
  readonly level: RuntimeLogLevel;
  readonly event: string;
  readonly workload: RuntimeWorkload;
  readonly requestId?: string;
  readonly errorCode?: string;
}

export interface HttpRequestCompletedEvent {
  readonly level: 'info';
  readonly event: 'http_request_completed';
  readonly workload: 'api';
  readonly requestId: string;
  readonly method: RuntimeHttpMethod;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export type RuntimeEvent = RuntimeEventBase | HttpRequestCompletedEvent;

export interface SafeRuntimeLogger {
  log(event: RuntimeEvent): boolean;
}

export class RuntimeObservabilityError extends Error {
  readonly code = 'invalid_event' as const;

  constructor() {
    super('Invalid runtime observability event.');
    this.name = 'RuntimeObservabilityError';
  }
}

function invalidEvent(): never {
  throw new RuntimeObservabilityError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactFields(input: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) invalidEvent();
  }
}

function assertEventName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !EVENT_NAME.test(value)) invalidEvent();
}

function assertRequestId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) invalidEvent();
}

function validateBaseEvent(input: Record<string, unknown>): void {
  assertExactFields(input, BASE_FIELDS);
  if (typeof input.level !== 'string' || !LEVELS.has(input.level)) invalidEvent();
  assertEventName(input.event);
  if (typeof input.workload !== 'string' || !WORKLOADS.has(input.workload)) invalidEvent();
  if (input.requestId !== undefined) assertRequestId(input.requestId);
  if (input.errorCode !== undefined) assertEventName(input.errorCode);
}

function validateHttpCompletionEvent(input: Record<string, unknown>): void {
  assertExactFields(input, HTTP_FIELDS);
  if (input.level !== 'info' || input.event !== 'http_request_completed' || input.workload !== 'api') invalidEvent();
  assertRequestId(input.requestId);
  if (typeof input.method !== 'string' || !HTTP_METHODS.has(input.method)) invalidEvent();
  if (typeof input.route !== 'string') invalidEvent();
  if (Buffer.byteLength(input.route, 'utf8') > 256) invalidEvent();
  if (input.route !== '<unmatched>') {
    if (!input.route.startsWith('/')) invalidEvent();
    if (input.route.includes('?') || input.route.includes('#') || input.route.includes('://')) invalidEvent();
    if (/\r|\n/.test(input.route)) invalidEvent();
  }
  if (!Number.isSafeInteger(input.statusCode) || (input.statusCode as number) < 100 || (input.statusCode as number) > 599) invalidEvent();
  if (!Number.isSafeInteger(input.durationMs) || (input.durationMs as number) < 0 || (input.durationMs as number) > 86_400_000) invalidEvent();
}

function validatedEvent(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) invalidEvent();
  if (input.event === 'http_request_completed') validateHttpCompletionEvent(input);
  else validateBaseEvent(input);
  return input;
}

function timestampFrom(clock: RuntimeClock): string {
  let now: Date;
  try {
    now = clock.now();
  } catch {
    return invalidEvent();
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) invalidEvent();
  return now.toISOString();
}

export function serializeRuntimeEvent(
  input: RuntimeEvent,
  options: { readonly clock: RuntimeClock },
): string {
  const event = validatedEvent(input);
  const output: Record<string, unknown> = {
    timestamp: timestampFrom(options.clock),
    level: event.level,
    event: event.event,
    workload: event.workload,
  };

  if (event.requestId !== undefined) output.requestId = event.requestId;
  if (event.event === 'http_request_completed') {
    output.method = event.method;
    output.route = event.route;
    output.statusCode = event.statusCode;
    output.durationMs = event.durationMs;
  }
  if (event.errorCode !== undefined) output.errorCode = event.errorCode;

  return JSON.stringify(output);
}

const systemClock: RuntimeClock = {
  now: () => new Date(),
};

export function createSafeRuntimeLogger(input: {
  readonly sink: RuntimeLogSink;
  readonly clock?: RuntimeClock;
}): SafeRuntimeLogger {
  if (
    input === null
    || typeof input !== 'object'
    || input.sink === null
    || typeof input.sink !== 'object'
    || typeof input.sink.stdout !== 'function'
    || typeof input.sink.stderr !== 'function'
    || (input.clock !== undefined && (input.clock === null || typeof input.clock.now !== 'function'))
  ) {
    invalidEvent();
  }

  const clock = input.clock ?? systemClock;
  return Object.freeze({
    log(event: RuntimeEvent): boolean {
      const line = `${serializeRuntimeEvent(event, { clock })}\n`;
      const stream = event.level === 'error' ? input.sink.stderr : input.sink.stdout;
      try {
        stream(line);
        return true;
      } catch {
        return false;
      }
    },
  });
}
