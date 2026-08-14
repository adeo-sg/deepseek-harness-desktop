# Agent Note: Decode Win32 folder paths without Electron external buffers

Status: implemented

English | [中文](2026-08-14-win32-dialog-path-decoder.zh.md)

## Problem

`IFileOpenDialog` returns the selected filesystem path as a COM-owned `PWSTR`. Electron's Node runtime rejects Koffi external-buffer views, so reading that pointer with `koffi.view()` can terminate the dialog worker after the user selects a folder and before the terminal IPC message arrives. Source-boundary tests with fake pointers do not exercise this runtime restriction.

## Decision

The Win32 binding reads the path with Koffi's `decode.string16()` helper, which copies a NUL-terminated UTF-16 string without creating an external buffer. `CoTaskMemFree` runs in a `finally` block after every successful `GetDisplayName` call, including decoder failures. The child-process IPC lifecycle remains the owner of worker completion and parent-abort cleanup.

## Alternatives considered

**Keep the external-buffer view and widen Electron settings.** Rejected because Electron controls the external-buffer restriction and changing process settings would broaden native-memory exposure without fixing the decoder contract.

**Move the entire Windows chooser to Electron's dialog API.** Rejected because the native provider also serves non-Electron hosts; keeping the COM conversation in its isolated child preserves one cross-host provider and keeps blocking native calls off the host event loop.

**Decode through a manually sized byte buffer.** Rejected because it requires another native copy and length policy for a NUL-terminated COM allocation; Koffi already owns the UTF-16 decoder needed here.

## Consequences

Folder selection returns the path through the same IPC result protocol on packaged Electron builds, including paths containing non-ASCII characters. A decoder failure still rejects the pick, but it releases the COM allocation and leaves the parent able to report the error instead of observing an unexplained worker exit.

## Testing

The binding suite uses a fake environment whose external-buffer API is absent and covers selection, decoder failure, COM release, and memory release. A packaged Electron probe runs Koffi's UTF-16 decoder against a native Windows pointer; the desktop packaged-boot smoke remains the assembled first-run check.
