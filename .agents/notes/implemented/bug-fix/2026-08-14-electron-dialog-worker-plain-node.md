# Agent Note: The Win32 folder dialog worker runs as plain node under Electron

Status: implemented

English | [中文](2026-08-14-electron-dialog-worker-plain-node.zh.md)

## Problem

Choosing a folder in the Electron desktop shell failed with `win32 folder dialog worker exited before reporting a result`. The native directory picker spawns a child process to host the koffi/COM `IFileOpenDialog` conversation, and the driver rejects when that child exits before sending any IPC message. In `dsh web` (a plain node process) the child ran fine; in the desktop shell it always died instantly.

## Decision

The spawner (`dsh-host-directory-picker-native`'s `win32-dialog-host.ts`) launched the child with `process.execPath` — under Electron that is the **Electron binary**, so the child booted as an Electron app (a second instance) instead of running the worker script as node, and exited without ever reaching the dialog. `spawnDialogWorker` now sets `ELECTRON_RUN_AS_NODE: '1'` unconditionally on the child env: only the Electron binary gives that variable meaning, so a plain-node host is unaffected, and under the desktop shell the child runs the worker as plain node — exactly the semantics `dsh web` always had. Both the source-plane (tsx-bootstrapped) and bundled (`lib/worker.cjs`) spawn arms share the env, so dev and packaged shells behave identically.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| Spawning with a bundled node runtime (`ELECTRON_BUNDLED_NODE`) | `ELECTRON_RUN_AS_NODE` reuses the already-running Electron binary with one env flag; bundling a second runtime doubles install size for no gain |
| Detecting Electron and choosing a different execPath | The flag is inert on plain node, so one unconditional spawn path serves both hosts without a fork |
| Running the dialog in-process (no child) | The child isolates the blocking COM conversation and its koffi surface from the main process; removing it would change the driver's abort/lifetime contract |

## Verification

- A unit spec (`tests/win32-dialog-host.spec.ts`) pins the spawn contract: `process.execPath` + the worker entry + `ELECTRON_RUN_AS_NODE: '1'` + the `ipc` stdio channel + `windowsHide`.
- A one-off Electron probe invoked `pickNativeDirectory` from the built `lib/index.js` and aborted after the dialog opened: it rejected with `native directory picker aborted` (the dialog opened and the abort service closed it) — the pre-fix run rejected with `exited before reporting a result`. The same probe against the **packaged** `resources/app` layout passed identically.
- All directory-picker, interaction/approval, sandbox/fs, connection (IPC + privileged-method pinning), and apiproxy host-domain suites pass.

## Consequences

The desktop shell's native folder picker now opens its OS dialog like the web GUI's. The cost is one environment variable on the dialog child, which is inert outside Electron. The related configuration surface is unchanged: `host.pickDirectory` remains pinned to loopback trust (the desktop IPC bridge normalizes the renderer to loopback), the picker backend selection (`directory-picker-auto` → native on a loopback win32 boot) is untouched, and `host.listDirectory`/`host.createDirectory` still require the browse capability, exactly as in the web composition.
