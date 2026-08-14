# Agent Note: Keep the Win32 folder dialog IPC channel open until the result

Status: implemented

English | [中文](2026-08-14-win32-dialog-ipc-lifecycle.zh.md)

## Problem

The Win32 folder dialog protocol emits a `showing` notice before the child enters the blocking native `Show` call, then emits one `done` or `error` result. Closing the child IPC channel after the notice makes the child exit through its disconnect handler before the result can reach the driver, which reports `win32 folder dialog worker exited before reporting a result`.

## Decision

The worker keeps its IPC channel open after the intermediate notice and closes it only from the send callback for the terminal result. The parent-disconnect handler remains the cleanup path when a caller abandons the pick. The Electron executable selection and `ELECTRON_RUN_AS_NODE` setting remain owned by the [plain-node worker decision](2026-08-14-electron-dialog-worker-plain-node.md).

## Alternatives considered

**Disconnect after `showing`.** Rejected because `showing` is an intermediate notice and the native call has not produced a result; disconnecting triggers the child cleanup handler and loses the result.

**Remove the disconnect handler.** Rejected because a closed renderer or aborted host could leave a native dialog process alive after its owner disappears.

**Create a second channel for the final result.** Rejected because one persistent IPC channel already preserves ordering and gives the driver one lifecycle to observe; another channel would add process coordination without changing the failure mode.

## Consequences

The driver receives the `showing` notice, can close the dialog through its thread id, and then receives the final selection or cancellation. A parent that disconnects still terminates the child, and a completed child closes its IPC channel only after the terminal message is queued.

## Testing

The worker-boundary spec records whether `process.send` receives a callback and requires it only for the terminal message, preventing a future intermediate send-site from closing the channel. The driver spec retains the real Win32 abort smoke, which exercises the showing-to-result sequence on Windows; the focused directory-picker suite passes on POSIX through the injected boundary.
