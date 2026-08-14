# @deepseek-ai/dsh-client-ui-window-controls

English | [中文](README.zh.md)

Desktop window controls for the frameless Electron shell: a custom minimize / maximize-restore / close cluster drawn entirely in HTML and CSS (inline SVG glyphs, no icon or windowing library). Two registrations coordinate one interactive cluster. The `shell.overlay` occupant pins that cluster to the frame's top-right across the new-session hero, Session header, and details-panel states. The `conversation.session.header.utilities` occupant reserves the same platform footprint after the Session-log utility without mounting another set of buttons. Details-column width therefore cannot move the controls, and the header utilities remain clear of the overlay. The details header consumes the overlay's `--dsh-window-controls-details-right` inset so its close action also stays clear.

Platform metrics are explicit: Windows uses 45x32px full-bleed hit targets with a 12px glyph; Linux uses 34px GNOME-style controls with 16px symbolic glyphs, 3px spacing, a 6px top inset, and a 7px trailing inset; macOS uses 28px compact controls with a 12px glyph and 12px top/trailing insets; unknown hosts use the compact 12px glyph and 8px insets. The right-side placement is product-owned; native macOS traffic lights and zoom semantics remain outside this Windows-first UI.

The cluster is pure presentation over the preload's `windowControls` surface (`window.desktopBridge.windowControls`, an optional member of the authoritative `DesktopBridge` in `dsh-client-connection`). One-shot actions ride fire-and-forget sends; the initial toggle glyph is seeded from an `isMaximized()` query and kept current by the `onMaximizedChanged` subscription, so a keyboard snap or a double-click on the drag region flips the glyph without a stale render. Absent the surface — the web composition, fixture mode, or an accidental roster — the components render nothing.

The shell itself is frameless (`frame: false`) with no application menu. The Session header title row is the window drag region (`-webkit-app-region: drag`, inert on the web), and the cluster opts back into pointer events; the overlay strip carries its own drag region. Double-clicking either drag region maximizes and restores natively. The package ships only in the `dsh-desktop-app` bundle patch, so the web composition never loads it. The [frameless window chrome Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-desktop-frameless-window-chrome.md) owns the main-process side of the contract (channels, preload, drag regions).

## Model Experience

None, as the cluster is human-only window chrome that issues no RPC, adds no session event, and reaches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Windows-first framing** — the frameless window uses `frame: false` and Electron's built-in edge resizing, which works on Windows and Linux; macOS frameless windows need their own edge-resize handling, deferred with the macOS build.
- **No Windows 11 snap-layout flyout** — the native maximize button (which hosts the flyout) is gone with the title bar; snapping still works via drag-to-top, Win+arrow keys, and the custom maximize button.
- **Drag region follows the header** — only the Session header row and the overlay strip are draggable; the sidebar, details column, and hero body are not (the header row's buttons and the cluster stay clickable via `no-drag`).
