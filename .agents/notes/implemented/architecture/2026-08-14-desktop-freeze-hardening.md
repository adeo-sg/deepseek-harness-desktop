# Agent Note: Desktop freeze hardening — history page budget, decode slicing, and crash recovery

Status: implemented

English | [中文](2026-08-14-desktop-freeze-hardening.zh.md)

## Problem

The packaged desktop shell intermittently froze: the whole window showed the "not responding" cursor and only recovered after seconds. A session-log diagnosis on the real user data showed the mechanism. Opening a session issues `session.history`, whose message-boundary pagination counts `user/message` + `assistant/message` events; one message group can carry tens of thousands of stream `assistant/chunk` events (the measured worst session: 100 messages → 72,965 events, a 15 MB response). The host then serialized that page (JSON.stringify), shipped it over IPC, and the renderer parsed it (JSON.parse of 15 MB ≈ 190 ms) and folded all 72,965 events — every one of those steps is a synchronous block on its process's main thread, so opening the transcript froze both the main process and the renderer. A second smaller stall sat in the persistence layer's `readRaw` (used by export/tracing), which decoded a cold log's thousands of zstd frames synchronously in one loop, unlike the session-open path's `readZstdPrefix`, which already slices and yields.

## Decision

Three changes bound the synchronous work and make the shell self-recovering:

- **History page event budget** (`packages/host/apiproxy`, `paginate`): a page now also respects a 12,000-event cap. The walk still counts message groups backwards, but accumulates exactly the events each group newly covers (a binary search keeps it O(n log n) under compaction shadowing) and cuts at the first group that crosses either the message quota or the budget. Whole message groups are always preserved — a page never cuts mid-message, so the compaction `compaction/summary` same-page guarantee and the renderer's per-page incremental fold are unchanged. The measured worst page dropped from 72,965 events / 15 MB to ≈12,000 / 2.5 MB, and the history RPC from ≈330 ms to ≈90 ms; the renderer's JSON.parse dropped from ≈190 ms to ≈30 ms.
- **`readRaw` decode slicing** (`packages/session/session-persistence-jsonl`): the cold-log decode loop now yields the event loop at the same cadence as `readZstdPrefix` (`scheduler.yield` every 500 ms of decode), with an explicit `iterator.return()` on the abort path so the decoder's own `close()` still runs. The export/tracing read can no longer stall the host for the whole decode.
- **Crash recovery and diagnostics** (`apps/desktop` main process): `render-process-gone` (a GPU/utility fault or OOM kill) reloads the shell page instead of leaving a blank window — the host tree lives in the main process, so the UI recovers over the same sessions. `child-process-gone` logs GPU/Utility faults, the only after-the-fact record of a compositor crash that freezes the window while Electron restarts it.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Chunked/streamed history transport | The RPC contract is unary; streaming would touch the wire schemas, the renderer's page-stitching, and every consumer — the budget solves the same problem at the source (page size) |
| Offloading read+parse+fold to a worker thread | The open path already slices (`readZstdPrefix`); a worker would add lifecycle and build complexity (a second bundle entry) for the export-only `readRaw` path |
| Pushing the whole decode through the async zstd API | 24k+ frames × one libuv thread-pool round trip each made cold opens seconds slower while the freeze came from the *contiguous* block, which slicing removes |
| Letting the renderer slice its own fold | The fold cost scales with page size; bounding the page bounds the fold, and the renderer's fold is already incremental per page |

## Consequences

Opening large transcripts no longer freezes the shell: the page budget bounds serialization, IPC transfer, JSON.parse, and fold per request, and the renderer pulls more pages on scroll exactly as before. `readRaw` consumers (session export, tracing) no longer stall the host. A crashed renderer recovers automatically instead of leaving a dead window, and GPU faults are logged. Costs: a page may carry fewer messages than `maxMessages` asked for (the budget wins), so scroll-back loads slightly more pages; the `paginate` walk is O(n log n) instead of O(n); a single message group larger than the budget (an extreme single-message transcript) still ships whole, because cutting mid-message would corrupt the surface — the budget is a ceiling, not a guarantee.
