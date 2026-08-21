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

const EVENT_NAME = /^[a-z][a-z0-9_]{0,79}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP_METHODS = new Set<RuntimeHttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);
const BASE_FIELDS = new Set(['level', 'event', 'workload', 'requestId', 'errorCode']);
const HTTP_COMPLETION_FIELDS = new Set([
  'level',
  'event',
  'workload',
  'requestId',
  'method',
  'route',
  'statusCode',
  'durationMs',
]);

const systemClock: RuntimeClock = {
  now: () => new Date(),
};

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

function asRecord(input: RuntimeEvent): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalidEvent();
  }
  return input as unknown as Record<string, unknown>;
}

function assertAllowedFields(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalidEvent();
  }
}

function assertBaseFields(record: Record<string, unknown>): void {
  if (record.level !== 'info' && record.level !== 'warn' && record.level !== 'error') invalidEvent();
  if (typeof record.event !== 'string' || !EVENT_NAME.test(record.event)) invalidEvent();
  if (record.workload !== 'api' && record.workload !== 'worker') invalidEvent();
  if (record.requestId !== undefined) {
    if (typeof record.requestId !== 'string' || !UUID_V4.test(record.requestId)) invalidEvent();
  }
  if (record.errorCode !== undefined) {
    if (typeof record.errorCode !== 'string' || !EVENT_NAME.test(record.errorCode)) invalidEvent();
  }
}

function assertHttpCompletion(record: Record<string, unknown>): void {
  assertAllowedFields(record, HTTP_COMPLETION_FIELDS);
  assertBaseFields(record);
  if (record.level !== 'info' || record.workload !== 'api') invalidEvent();
  if (typeof record.requestId !== 'string' || !UUID_V4.test(record.requestId)) invalidEvent();
  if (typeof record.method !== 'string' || !HTTP_METHODS.has(record.method as RuntimeHttpMethod)) invalidEvent();
  if (typeof record.route !== 'string' || record.route.length === 0) invalidEvent();
  if (Buffer.byteLength(record.route, 'utf8') > 256) invalidEvent();
  if (record.route.includes('?') || record.route.includes('#')) invalidEvent();
  if (!Number.isInteger(record.statusCode) || (record.statusCode as number) < 100 || (record.statusCode as number) > 599) {
    invalidEvent();
  }
  if (!Number.isInteger(record.durationMs) || (record.durationMs as number) < 0 || (record.durationMs as number) > 86_400_000) {
    invalidEvent();
  }
}

function validatedRecord(input: RuntimeEvent): Record<string, unknown> {
  const record = asRecord(input);
  if (record.event === 'http_request_completed') {
    assertHttpCompletion(record);
    return record;
  }
  assertAllowedFields(record, BASE_FIELDS);
  assertBaseFields(record);
  return record;
}

function timestampFrom(clock: RuntimeClock): string {
  try {
    const value = clock.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalidEvent();
    return value.toISOString();
  } catch (error) {
    if (error instanceof RuntimeObservabilityError) throw error;
    return invalidEvent();
  }
}

export function serializeRuntimeEvent(
  input: RuntimeEvent,
  options: { clock: RuntimeClock },
): string {
  const record = validatedRecord(input);
  const output: Record<string, string | number> = {
    timestamp: timestampFrom(options.clock),
    level: record.level as RuntimeLogLevel,
    event: record.event as string,
    workload: record.workload as RuntimeWorkload,
  };

  if (record.requestId !== undefined) output.requestId = record.requestId as string;
  if (record.method !== undefined) output.method = record.method as RuntimeHttpMethod;
  if (record.route !== undefined) output.route = record.route as string;
  if (record.statusCode !== undefined) output.statusCode = record.statusCode as number;
  if (record.durationMs !== undefined) output.durationMs = record.durationMs as number;
  if (record.errorCode !== undefined) output.errorCode = record.errorCode as string;

  return JSON.stringify(output);
}

export function createSafeRuntimeLogger(input: {
  sink: RuntimeLogSink;
  clock?: RuntimeClock;
}): SafeRuntimeLogger {
  const clock = input.clock ?? systemClock;

  return {
    log(event) {
      const serialized = serializeRuntimeEvent(event, { clock });
      const line = `${serialized}\n`;
      try {
        if (event.level === 'error') {
          input.sink.stderr(line);
        } else {
          input.sink.stdout(line);
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}
