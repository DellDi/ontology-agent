---
title: 'Postgres-backed durable job ledger'
type: 'feature'
created: '2026-04-28'
status: 'done'
baseline_commit: '9cc29e02d874c98d2be937cc0484c21c6a3e8c62'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/planning-artifacts/postgres-backed-job-ledger-architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Worker job 的最终事实仍保存在 Redis，Redis Streams 只能改善分发层 at-least-once，不能提供可靠的业务 ledger、状态审计和跨 Redis 重启恢复。生产路径需要把 job 状态、attempt、lease、结果、错误与 DLQ 事实迁到 Postgres。

**Approach:** 新增 Postgres-backed durable job ledger，并让 Redis 只承担唤醒/分发信号职责。保持现有 application `JobQueue` 用例调用面稳定，新增 infrastructure adapter 组合 Postgres ledger 与 Redis dispatcher，再切换 web/worker runtime wiring。

## Boundaries & Constraints

**Always:** Postgres 是 canonical source of truth；Redis stream message 只携带 `jobId`；worker 必须 claim Postgres job 成功后才执行 handler；terminal 状态必须幂等处理重复 Redis signal；Drizzle schema 与 migration 必须同步；失败路径要 fail loud 并可诊断。

**Ask First:** 如果需要改变业务 job payload 契约、analysis execution id 生成方式、部署拓扑，或需要删除现有 Redis-only queue 实现，先暂停确认。

**Never:** 不用 Redis 保存 canonical job data；不通过吞错或默认成功掩盖 Postgres/Redis 写入失败；不声称 exactly-once；不做 Redis-only in-flight job 的虚假无损迁移。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Submit job | Valid `JobSubmission` | Insert `platform.jobs` + event + outbox, publish Redis signal, return job | If Postgres insert fails, do not publish Redis; throw |
| Consume job | Redis signal exists, Postgres job is claimable | Atomically set `processing`, increment attempt, set lease, return job | If claim fails because terminal/stale, ack Redis and return null |
| Worker crash | Job is `processing` with expired `locked_until` | Recovery returns job to `queued` or redispatches so another worker can claim | Attempts exhausted marks `dead_letter` |
| Terminal duplicate | Redis redelivers completed/failed job id | Worker does not execute handler again and acks Redis | Log/metric duplicate ack path |
| Redis publish failure | Job committed to Postgres, `XADD` fails | Outbox remains pending/failed for retry | Keep real error in outbox/job event |

</frozen-after-approval>

## Code Map

- `src/domain/job-contract/models.ts` -- job status model and payload validation.
- `src/application/job/ports.ts` -- stable `JobQueue` application port.
- `src/application/job/use-cases.ts` -- submit/consume/complete/fail use cases.
- `src/infrastructure/job/redis-job-queue.ts` -- current Redis-backed queue; keep as compatibility implementation.
- `src/infrastructure/job/runtime.ts` -- web-side job service wiring.
- `src/worker/main.ts` -- worker-side job service wiring and status transitions.
- `src/infrastructure/postgres/schema/index.ts` -- schema export surface.
- `drizzle/` -- SQL migrations and journal.
- `tests/story-2-6-worker-skeleton.test.mjs` -- existing worker contract regression.
- `tests/story-2-6-redis-job-queue-real.test.mjs` -- existing Redis Streams real integration baseline.

## Tasks & Acceptance

**Execution:**
- [x] `src/infrastructure/postgres/schema/job-ledger.ts` -- add `jobs`, `job_events`, `job_dispatch_outbox` tables with indexes.
- [x] `src/infrastructure/postgres/schema/index.ts` and `drizzle/0003_postgres_job_ledger.sql` + journal -- export schema and keep migrations synchronized.
- [x] `src/infrastructure/job/postgres-job-ledger.ts` -- implement create/get/claim/complete/fail/recover/outbox operations.
- [x] `src/infrastructure/job/redis-job-dispatcher.ts` -- implement Redis Stream signal publisher/receiver/ack without storing job data.
- [x] `src/infrastructure/job/postgres-backed-job-queue.ts` -- implement existing `JobQueue` by composing ledger + dispatcher.
- [x] `src/infrastructure/job/runtime.ts` and `src/worker/main.ts` -- wire Postgres-backed queue for web and worker.
- [x] `tests/story-2-8-postgres-backed-job-ledger.test.mjs` -- cover ledger state machine using real Postgres when available or static contract checks otherwise.
- [x] `tests/story-2-8-postgres-redis-job-dispatch.test.mjs` -- cover Redis signal semantics and duplicate terminal handling.
- [x] `docs/local-infrastructure.md`, `docs/deployment.md`, `_bmad-output/implementation-artifacts/2-6-worker-skeleton-and-job-contract.md` -- update operational documentation.

**Acceptance Criteria:**
- Given a submitted job, when Redis data keys are unavailable, then `getJob` still returns the canonical job from Postgres.
- Given a worker consumes a Redis signal, when Postgres claim returns no claimable row because the job is terminal, then the worker does not execute the handler again.
- Given a worker crashes after claim, when lease expires and recovery runs, then another worker can process or dead-letter the job according to attempts.
- Given Redis publish fails after Postgres commit, when outbox retry runs, then the job can still be dispatched without losing the ledger row.

## Spec Change Log

## Design Notes

The first implementation should keep the application `JobQueue` port stable to reduce blast radius. Internally split durable state (`PostgresJobLedger`) from wakeup transport (`RedisJobDispatcher`) so Redis cannot accidentally become a second facts database again.

## Verification

**Commands:**
- `node --test tests/story-2-8-postgres-backed-job-ledger.test.mjs` -- expected: ledger behavior passes or clearly skips only when DATABASE_URL is unavailable.
- `node --test tests/story-2-8-postgres-redis-job-dispatch.test.mjs` -- expected: dispatcher behavior passes or clearly skips only when Redis/Postgres are unavailable.
- `node --test tests/story-2-6-worker-skeleton.test.mjs` -- expected: worker contract remains valid.
- `pnpm exec tsc --noEmit --pretty false` -- expected: TypeScript passes.
- `pnpm lint` -- expected: ESLint passes.
- `git diff --check` -- expected: no whitespace errors.

## Suggested Review Order

**Architecture Entry Point**

- Start here to see how ledger and dispatcher compose behind the existing port.
  [`postgres-backed-job-queue.ts:32`](../../src/infrastructure/job/postgres-backed-job-queue.ts#L32)

- Runtime wiring now selects Postgres-backed queue for web submissions.
  [`runtime.ts:21`](../../src/infrastructure/job/runtime.ts#L21)

- Worker consumes through the same Postgres-backed queue boundary.
  [`main.ts:42`](../../src/worker/main.ts#L42)

**Durable Ledger**

- Schema defines canonical job, event, and outbox facts.
  [`job-ledger.ts:12`](../../src/infrastructure/postgres/schema/job-ledger.ts#L12)

- Create path writes job, event, and dispatch outbox in one transaction.
  [`postgres-job-ledger.ts:98`](../../src/infrastructure/job/postgres-job-ledger.ts#L98)

- Claim path enforces lease, attempt, and terminal-state boundaries.
  [`postgres-job-ledger.ts:269`](../../src/infrastructure/job/postgres-job-ledger.ts#L269)

- Recovery requeues expired leases and writes a fresh outbox signal.
  [`postgres-job-ledger.ts:472`](../../src/infrastructure/job/postgres-job-ledger.ts#L472)

**Redis Signal Layer**

- Dispatcher publishes only `jobId` and owns stream ack mechanics.
  [`redis-job-dispatcher.ts:87`](../../src/infrastructure/job/redis-job-dispatcher.ts#L87)

- Terminal duplicate signals are acked without re-running handlers.
  [`postgres-backed-job-queue.ts:119`](../../src/infrastructure/job/postgres-backed-job-queue.ts#L119)

**Tests And Operations**

- Ledger test covers lease reclaim, recovery outbox, terminal, and DLQ.
  [`story-2-8-postgres-backed-job-ledger.test.mjs:69`](../../tests/story-2-8-postgres-backed-job-ledger.test.mjs#L69)

- Redis/Postgres test proves Redis no longer stores canonical job data.
  [`story-2-8-postgres-redis-job-dispatch.test.mjs:95`](../../tests/story-2-8-postgres-redis-job-dispatch.test.mjs#L95)

- Local docs describe the new operational queue semantics.
  [`local-infrastructure.md:157`](../../docs/local-infrastructure.md#L157)
