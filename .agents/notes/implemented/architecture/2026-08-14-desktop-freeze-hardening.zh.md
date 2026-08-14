# Agent Note: 桌面卡死加固——history 分页预算、解码分片与崩溃恢复

Status: implemented

[English](2026-08-14-desktop-freeze-hardening.md) | 中文

## Problem

打包后的桌面壳层会间歇性卡死：整个窗口显示「未响应」光标，数秒后才恢复。对真实用户数据的会话日志诊断暴露了机制。打开会话会发起 `session.history`，其按消息边界分页的算法统计 `user/message` + `assistant/message` 事件；单个消息组可能携带数万个流式 `assistant/chunk` 事件（实测最坏会话：100 条消息 → 72,965 个事件、15 MB 响应）。宿主随后序列化该页（JSON.stringify）、经 IPC 传输，渲染端解析（15 MB 的 JSON.parse ≈ 190 ms）并 fold 全部 72,965 个事件——其中每一步都是所在进程主线程上的同步块，因此打开 transcript 会同时冻结主进程与渲染进程。第二个较小的卡点在持久化层的 `readRaw`（export/tracing 使用）：它在一个循环里同步解码冷日志的数千个 zstd 帧，不像会话打开路径的 `readZstdPrefix` 已经分片让出。

## Decision

三处改动限制了同步工作并让壳层可以自我恢复：

- **history 分页事件预算**（`packages/host/apiproxy` 的 `paginate`）：一页现在还受 12,000 事件上限约束。反向扫描仍按消息组计数，但精确累加每个组新覆盖的事件（用二分查找保持压缩遮蔽下的 O(n log n)），并在越过消息配额或预算的第一条消息组处切页。始终保留完整消息组——绝不从消息中间切断，因此压缩 `compaction/summary` 同页保证与渲染端按页增量 fold 均不变。实测最坏页从 72,965 事件 / 15 MB 降到 ≈12,000 / 2.5 MB，history RPC 从 ≈330 ms 降到 ≈90 ms；渲染端 JSON.parse 从 ≈190 ms 降到 ≈30 ms。
- **`readRaw` 解码分片**（`packages/session/session-persistence-jsonl`）：冷日志解码循环现在按与 `readZstdPrefix` 相同的节奏让出事件循环（每 500 ms 解码 `scheduler.yield`），并在中止路径显式调用 `iterator.return()` 以确保解码器自己的 `close()` 仍然执行。export/tracing 读取不再让宿主为整个解码过程卡住。
- **崩溃恢复与诊断**（`apps/desktop` 主进程）：`render-process-gone`（GPU/utility 故障或 OOM 被杀）时重载壳层页面而不是留下空白窗口——宿主树住在主进程里，因此 UI 会在同一批会话上恢复。`child-process-gone` 记录 GPU/Utility 故障——这是合成器崩溃冻结窗口而 Electron 正在重启它之后唯一的痕迹。

## Alternatives considered

| 被否决方案 | 一句话理由 |
|---|---|
| chunk/流式 history 传输 | RPC 契约是 unary；流式会触及 wire schema、渲染端分页拼接与所有消费方——预算在同一源头（页大小）解决问题 |
| 把读+解析+fold 移到 worker 线程 | 打开路径已经分片（`readZstdPrefix`）；worker 会为仅 export 使用的 `readRaw` 路径引入生命周期与构建复杂度（第二个 bundle 入口） |
| 全部走异步 zstd API | 2.4 万+ 帧每帧一次 libuv 线程池往返使冷打开慢数秒，而卡顿来自*连续*块——分片正好消除它 |
| 让渲染端自己分片 fold | fold 成本随页大小伸缩；限制页大小就限制了 fold，且渲染端 fold 本就按页增量 |

## Consequences

打开大 transcript 不再冻结壳层：页预算约束了每次请求的序列化、IPC 传输、JSON.parse 与 fold，渲染端滚动时照旧多拉几页。`readRaw` 消费方（会话导出、tracing）不再卡住宿主。渲染进程崩溃自动恢复而不是留下死窗口，GPU 故障会被记录。代价：一页携带的消息数可能少于 `maxMessages` 请求值（预算优先），因此回滚浏览会多加载几页；`paginate` 从 O(n) 变为 O(n log n)；大于预算的单个消息组（极端单消息 transcript）仍整组传输，因为在消息中间切断会破坏 surface——预算只是上限，不是保证。
