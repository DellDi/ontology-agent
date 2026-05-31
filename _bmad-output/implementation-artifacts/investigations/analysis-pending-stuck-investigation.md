# Investigation: analysis pending stuck

## Hand-off Brief

1. **What happened.** 用户看到“等待执行开始”，但对应 `analysis-execution` job 已完成并产生 snapshot；执行本体未失败，页面状态链路未连续接上结果。
2. **Where the case stands.** Status: Active. 已确认 job/session/snapshot owner 与 session 均匹配，排除 worker 未消费、snapshot 未落库、owner 不匹配三个方向。
3. **What's needed next.** 下一步应把自动执行提交后的页面状态链路改为显式 execution lifecycle，而不是依赖一次客户端 form redirect + 静态 pending UI。

## Case Info

| Field | Value |
| --- | --- |
| Ticket | N/A |
| Date opened | 2026-05-31 |
| Status | Active |
| System | Windows / Next.js workspace / local Postgres + worker |
| Evidence sources | worker log excerpt, local Postgres query, source trace |

## Problem Statement

用户提问“丰和园小区项目的物业费收缴率是多少？”后，页面停在“等待执行开始”。用户要求明确根因，不接受只做兜底。

## Evidence Inventory

| Source | Status | Notes |
| --- | --- | --- |
| Worker log | Available | `worker.job_started` and `worker.job_completed` for `ccac8f55-741a-4f19-bbe0-bb71e792983e` |
| Postgres job/snapshot query | Available | job completed; snapshot completed; 11 step results; conclusion exists |
| Page source | Available | page only enters live shell when `resolvedExecutionId && executionStreamReadModel` |
| Browser navigation trace | Missing | Need capture actual URL and network redirect around auto-submit |

## Timeline of Events

| Time | Event | Source | Confidence |
| --- | --- | --- | --- |
| 2026-05-31T03:55:38Z | Worker started job `ccac8f55-741a-4f19-bbe0-bb71e792983e` | user worker log | Confirmed |
| 2026-05-31T03:56:01Z | Worker completed job | user worker log + PG query | Confirmed |
| 2026-05-31T03:56:01Z | Snapshot saved with 11 steps and conclusion | PG query | Confirmed |

## Confirmed Findings

### Finding 1: The execution itself completed

**Evidence:** PG query on `platform.jobs` and `platform.analysis_execution_snapshots`.

**Detail:** Job `ccac8f55-741a-4f19-bbe0-bb71e792983e` is `completed`; snapshot is `completed`, same owner `2`, same session `a918e392-671d-4930-b5d2-69c60c28e9ab`, 11 step results, conclusion exists.

### Finding 2: The page can only render the live/result shell after it has an execution id plus a read model

**Evidence:** `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx:480`.

**Detail:** If `resolvedExecutionId && executionStreamReadModel` is false, the page falls into pending UI.

### Finding 3: Initial auto execution is client-side and deduped by sessionStorage

**Evidence:** `src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-auto-execute-gate.tsx:76` and `:96`.

**Detail:** The first request renders before there is an execution id; a client effect later submits the form. If that redirect is not observed by the page, or a previous attempt key exists, the server-rendered page has no live stream to follow.

## Deduced Conclusions

### Deduction 1: The observed stuck state is not caused by worker non-consumption

**Based on:** Finding 1.

**Reasoning:** Worker completed and snapshot exists with conclusion. A worker-consumption failure would leave job pending/processing or failed without completed snapshot.

**Conclusion:** The broken part is UI state continuation after submission/result, not the execution runtime itself.

### Deduction 2: The previous UI refactor introduced an unproductive pending state

**Based on:** Finding 2 and Finding 3.

**Reasoning:** The page had a pending branch when there is no execution read model, while auto-submit happens later in a client effect. That pending branch had no live subscription, no refresh, and hid blocker/plan details.

**Conclusion:** The code path is structurally capable of showing a permanent “waiting” screen even when execution has already completed elsewhere.

## Hypothesized Paths

### Hypothesis 1: Browser did not land on the redirected URL with executionId

**Status:** Open

**Theory:** Auto-submitted form created the job and the server returned a 303 with `executionId`, but the browser tab observed by the user stayed on the pre-submit page or later returned to a URL without `executionId`.

**Would confirm:** Browser network trace or URL history showing POST `/execute` -> 303 but final URL lacks `executionId`.

**Would refute:** Browser trace showing final URL includes `executionId` while page still renders pending.

### Hypothesis 2: The page rendered before execution stream/snapshot existed and never refreshed

**Status:** Confirmed as a design defect, exact trigger still open

**Theory:** The pre-execution page was static from the user's perspective; after job completion there was no active stream or server refresh path to promote it to result view.

**Would confirm:** Repro where initial page lacks `executionId`, auto-submit creates job, and page remains unchanged until manual refresh.

**Would refute:** Repro consistently redirects into live shell immediately.

## Missing Evidence

| Gap | Impact | How to Obtain |
| --- | --- | --- |
| Browser network trace for the original stuck attempt | Determines whether redirect was missed or URL was later lost | Capture Network panel / Playwright trace during submit |
| Screenshot URL at stuck moment | Determines whether page had `executionId` | Inspect current address bar or browser state |

## Source Code Trace

| Element | Detail |
| --- | --- |
| Error origin | `src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx:480` pending/live branch |
| Trigger | Session page renders without usable execution read model |
| Condition | auto execution is client-side; page has no server push/refresh while no execution id is present |
| Related files | `analysis-auto-execute-gate.tsx`, `execute/route.ts`, `analysis-execution-display.ts` |

## Conclusion

**Confidence:** Medium

The execution runtime did not directly fail. The confirmed failure is a UI lifecycle defect: the refactored main chat page allowed a pre-execution server-rendered pending state to remain visible without a guaranteed transition into live/result state. The exact browser-level trigger for the original stuck page still requires URL/network evidence, but worker failure and snapshot persistence failure are refuted by local data.

## Recommended Next Steps

### Fix direction

Replace implicit client-side auto form submit as the primary lifecycle with an explicit execution lifecycle model: submitted job id should become canonical UI state immediately, and pending UI should subscribe/poll by session for a latest job/snapshot until it enters live/result/failed state. Pending should never be a passive static branch.

### Diagnostic

Capture a Playwright trace for one new question: initial session URL, POST `/execute`, 303 target, final URL, EventSource `/stream`, snapshot promotion.

## Reproduction Plan

1. Clear sessionStorage key `analysis-auto-execute-attempted:{sessionId}:root`.
2. Create a new analysis session.
3. Observe whether POST `/execute` returns 303 with `executionId`.
4. Observe whether final page opens `AnalysisExecutionLiveShell` before worker completion.
5. Wait for worker completion and verify result appears without manual refresh.

## Follow-up: 2026-05-31

### New Evidence

- Execution `5abb8e04-466e-442e-b5df-657661025010` completed in worker and saved a completed snapshot.
- Snapshot `result_blocks` contained both final metric table and operational render blocks: `执行状态`, `执行进度`, `当前步骤`, `阶段状态`, `阶段结果`.
- Job payload context misparsed `丰和园小区项目本年的物业费收缴率是多少？` as entity `项目 本年的物业费收缴率是多少`; `timeRange` was missing.
- Direct Cube query with explicit `project-name=丰和园小区项目` returned only `丰和园小区项目`, confirming the query layer can honor the scope when input is correct.

### Additional Findings

- The main conversation projection allowed operational blocks from stage progress/result events to render as primary result blocks.
- `extractEntity` did not handle project names immediately followed by `本年`.
- `TIME_RANGE_RULES` did not recognize `本年`.
- `formatDate` used `toISOString().slice(0, 10)`, causing local dates such as Jan 1 in Asia/Shanghai to serialize as the previous UTC date.

### Updated Hypotheses

- Hypothesis 2 remains confirmed as a UI lifecycle defect.
- New confirmed cause: context extraction and tool input construction failed to preserve explicit project scope for this user question shape.

### Backlog Changes

- Done: hide operational execution blocks from the primary result area.
- Done: recognize `本年` as `今年`.
- Done: extract `丰和园小区项目` when followed by `本年`.
- Done: pass explicit project constraints into Cube `project-name` filters.
- Done: format local date ranges without UTC day rollback.

### Updated Conclusion

The visible “执行中” was stale operational evidence rendered in the primary answer lane, not an active worker state. The incorrect business result was caused by context extraction losing the project name and by Cube input lacking a project-name filter; both defects are now fixed in code and covered by regression tests.
