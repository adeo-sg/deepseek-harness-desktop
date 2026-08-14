# Agent Note: The frameless desktop window — custom window controls and drag regions

Status: implemented

English | [中文](2026-08-14-desktop-frameless-window-chrome.zh.md)

## Problem

The [desktop shell note](2026-08-14-desktop-shell-ipc-carrier.md) delivered the Electron window with the native frame: the OS title bar, the default Electron application menu (File/Edit/View/…), and the system window controls. The shell works, but the chrome does not match a modern desktop application: the menu row consumes vertical space the app never uses, the title bar is inert, and the controls sit where every other window's do — none of it part of the product's own design language. The request was to draw the window chrome in the product UI: remove the default menu and the system title bar, and render custom minimize/maximize/close controls in the app's top-right corner, right of the Session-log utility, implemented natively (no windowing or icon library).

## Decision

The desktop window is frameless and menu-less, and the renderer owns the top-right chrome:

- **`apps/desktop` main process**: `Menu.setApplicationMenu(null)` removes the default menu for every window; the `BrowserWindow` uses `frame: false` (Windows edge resizing stays native — Electron handles the invisible resize borders), keeping `sandbox: true` / `contextIsolation: true` / `nodeIntegration: false`. `maximize`/`unmaximize` events forward the live state to the renderer on `dsh:window-maximized` so the toggle glyph never goes stale (keyboard snap, drag-region double-click).
- **Window IPC** (new channels beside the RPC channels): `dsh:window-action` (renderer → main, fire-and-forget: `minimize` | `toggle-maximize` | `close`, routed via `BrowserWindow.fromWebContents(event.sender)`), `dsh:window-state` (invoke → `{ maximized }`), and `dsh:window-maximized` (main → renderer, boolean). The preload exposes `window.desktopBridge.windowControls` — `minimize` / `toggleMaximize` / `close` / `isMaximized` / `onMaximizedChanged` — as an **optional** member of the authoritative `DesktopBridge` type in `dsh-client-connection` (mirrored structurally in the app's own `bridge-types.ts`).
- **The client plugin** (`packages/client/ui-window-controls`, `@deepseek-ai/dsh-client-ui-window-controls`): a pure-presentation cluster (three buttons, inline-SVG glyphs, tokens-only CSS, Chinese aria labels) registered twice, both through `slots.inject` on their declaring entries:
  - `conversation.session.header.utilities` (order 100, right of the Session-log utility) — the inline occupant, at the right end of the Session header, which is the window's top-right corner;
  - `shell.overlay` — a floating occupant pinned to the window's top-right that renders **only while the Session header is hidden** (no current session, or a blank one in the new-session hero), so the window stays closable before the first message exists. Exactly one instance renders at a time; the row lives only in the `dsh-desktop-app` bundle patch (plus the bundle's and the app's dependency closures), so the web composition never loads the plugin, and the components additionally render nothing when the preload surface is absent (fixture mode, accidental roster).
- **Drag regions**: the Session header's title row is the window drag region (`-webkit-app-region: drag` on `.titleRow`, `no-drag` on its buttons/links/inputs in `ui-conversation`'s module CSS — inert on the web, which ignores the property); the floating strip carries its own drag region with the cluster opting out. Double-click on either drag region maximizes/restores natively.

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| `titleBarStyle: 'hidden'` + native `titleBarOverlay` | The overlay draws the OS's own controls; the request was explicitly for custom (self-drawn) controls, and a native overlay cannot be restyled or placed beside Session log |
| Keeping the default application menu with `autoHideMenuBar` | It still flashes the menu row (Alt toggles it) and offers nothing the product UI uses; the request was to remove the menu entirely |
| One always-present title-bar strip above the header | The requested placement is *right of Session log*, in the same row; a separate strip would sit above it, and the header already ends at the window's top-right corner |
| Rendering the controls only in the header | The header is hidden on the hero (no session / blank session); the window would be unclosable before the first message — hence the floating `shell.overlay` fallback |

## Consequences

The desktop shell now looks like the product, not like a default Electron window: no menu row, no system title bar, custom controls integrated with the Session header and always reachable (floating fallback on the hero). The web GUI is untouched — the drag-region CSS is inert there and the plugin never loads. The main process gains three IPC channels and a preload surface; `dsh-client-connection`'s `DesktopBridge` gains one optional member (the connection plugin and its tests are unaffected). Costs and deferred work: Windows 11 snap-layout flyout is lost with the native maximize button (snapping still works via drag-to-top, Win+arrows, and the custom button); macOS frameless edge resizing is deferred with the macOS build; the drag region follows the header row, so the sidebar, details column, and hero body are not draggable; the packaged app must be rebuilt for the new client bundle (`lib/client.js` is served by client-modules and must exist).
