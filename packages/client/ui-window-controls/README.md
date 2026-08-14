# @deepseek-ai/dsh-client-ui-window-controls

English | [中文](README.zh.md)

Desktop window controls for the frameless Electron shell: a custom minimize / maximize-restore / close cluster drawn entirely in HTML and CSS (inline SVG glyphs, no icon or windowing library). Two registrations render the same cluster. The inline one occupies `conversation.session.header.utilities` at the right end of the Session header, after the Session-log utility, so the controls sit in the window's top-right corner exactly where the default title-bar chrome used to be. The floating one occupies `shell.overlay` and pins the same cluster to the window's top-right while that header is hidden — no current session, or a blank one showing the new-session hero — so the window stays closable before the first message exists. Exactly one instance renders at a time: the header occupant unmounts with the hidden header, and the floating occupant renders nothing once a real session header takes over.

The cluster is pure presentation over the preload's `windowControls` surface (`window.desktopBridge.windowControls`, an optional member of the authoritative `DesktopBridge` in `dsh-client-connection`). One-shot actions ride fire-and-forget sends; the initial toggle glyph is seeded from an `isMaximized()` query and kept current by the `onMaximizedChanged` subscription, so a keyboard snap or a double-click on the drag region flips the glyph without a stale render. Absent the surface — the web composition, fixture mode, or an accidental roster — the components render nothing.

The shell itself is frameless (`frame: false`) with no application menu. The Session header title row is the window drag region (`-webkit-app-region: drag`, inert on the web), and the cluster opts back into pointer events; the floating strip carries its own drag region. Double-clicking either drag region maximizes and restores natively. The package ships only in the `dsh-desktop-app` bundle patch, so the web composition never loads it. The [frameless window chrome Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-desktop-frameless-window-chrome.md) owns the main-process side of the contract (channels, preload, drag regions).

## Model Experience

None, as the cluster is human-only window chrome that issues no RPC, adds no session event, and reaches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Windows-first framing** — the frameless window uses `frame: false` and Electron's built-in edge resizing, which works on Windows and Linux; macOS frameless windows need their own edge-resize handling, deferred with the macOS build.
- **No Windows 11 snap-layout flyout** — the native maximize button (which hosts the flyout) is gone with the title bar; snapping still works via drag-to-top, Win+arrow keys, and the custom maximize button.
- **Drag region follows the header** — only the Session header row and the floating strip are draggable; the sidebar, details column, and hero body are not (the header row's buttons and the cluster stay clickable via `no-drag`).
