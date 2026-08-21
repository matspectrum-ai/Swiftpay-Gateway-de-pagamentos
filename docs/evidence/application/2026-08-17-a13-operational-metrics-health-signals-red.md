# A13 — Operational Metrics & Health Signals — RED Evidence

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`

## Frozen authority before RED

- Problem Analysis: `docs/design/a13-operational-metrics-health-signals-problem-analysis.md`
- Spec: `docs/specs/operational-metrics-health-signals-v0.yaml`
- Contract: `docs/contracts/operational-metrics-health-signals-v0.md`
- RED test: `tests/application/053_a13_operational_metrics_health_signals.contract.test.mjs`
- RED commit: `26ff9d37d932168ffb41bea3e063e5853c207203`

No A13 implementation existed when the RED test was committed.

## Application RED proof

Application workflow: `32093185987`  
Application-contracts job: `95579326788`

Pre-test gates:

- frozen dependency install: PASS
- TypeScript typecheck: PASS
- TypeScript build: PASS

Test result:

- total tests: **288**
- prior A1-A12/K7 application contracts: **276 PASS**
- A13 fail-first contracts: **12 FAIL**
- unrelated prior failures: **0**

The 12 A13 failures were attributable only to the frozen missing behavior: no `@swiftpay/metrics` package/registry, no API/worker metric wiring, no workload metrics-port configuration and no loopback OpenMetrics scrape boundary. Existing application behavior remained GREEN.

## Runtime/database non-regression proof on the same RED commit

The runtime-database-acceptance job `95579326835` in Application workflow `32093185987` completed GREEN:

- K7 real runtime database acceptance: PASS
- A1 real token authentication acceptance: PASS
- A2 real Pix acceptance: PASS
- A3 paid transition / ledger / balance acceptance: PASS
- A4 merchant webhook delivery acceptance: PASS
- A6 dashboard authorization acceptance: PASS
- A7 webhook endpoint management acceptance: PASS
- A8 API credential management acceptance: PASS
- A9 merchant transaction read acceptance: PASS

Database workflow `32093185988` also completed GREEN:

- K5 deterministic sandbox fixtures: PASS
- K6 runtime topology: PASS
- pgTAP: PASS using the unchanged **40 files / 1292 assertions** baseline

## RED conclusion

A13 is a clean TDD RED checkpoint. Only the explicitly frozen operational-metrics capabilities were missing. Database schema, financial behavior, provider authority, retained-provider traffic and all prior application/runtime contracts remained unchanged.

Minimal A13 implementation was therefore authorized after this checkpoint.
