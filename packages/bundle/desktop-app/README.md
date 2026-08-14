# @deepseek-ai/dsh-desktop-app

English | [中文](README.zh.md)

The dsh desktop-surface bundle: the Electron patch layer over `dsh-base` + `dsh-web-app`, plus the desktop surface prompt glue (default-exported runtime glue `@deepseek-ai/dsh-desktop-app`, bundle patch declared by the `dsh.bundle.patch` manifest). Applied after the web bundle, the patch swaps the browser carrier without changing the harness tree: the HTTP `webserver` row is disabled and the [`dsh-host-desktop-carrier`](../../host/desktop-carrier/README.md) row provides the same `webServer` service driven by the shell's `app://` protocol handler, the `web-runtime` row keeps mounting the frontend dist through the carrier's fallback seat but prints no URL and registers no web-surface prompt (a desktop shell has no URL), the `connection` row stays mounted — its HTTP route registrations are inert over the desktop carrier, and the row is what carries the connection browser half into the `__DSH_BOOT__` graph — and the [`dsh-client-connection`'s `/desktop` node half](../../client/connection/README.md) provides the `desktopBridge` host service (unary/respond fetch handler + mux/host event streams) the Electron main process wires to IPC. The shared module-reload HMR row stays disabled; client-plugin HMR in the desktop shell is a later milestone.

The runtime glue registers the harness-source prompt section (shared with the web runtime) and the `app:desktop-surface` section that orients sessions running inside the desktop shell — the web bundle's URL-based surface text is disabled because the shell has no server URL.

The desktop profile is `base + web-app + desktop-app`; the `apps/desktop` shell boots it through `dsh-app-boot` with zero network ports.

## Model Experience

### Desktop-surface prompt section

#### What the model sees

For sessions created through the desktop shell, the `harness:source` section identifies the on-disk Harness implementation and the `app:desktop-surface` global section (order −98) orients the model to the Electron window: the "this window" referent, the absence of a server URL and browser, and the rebuild-and-reload client-plugin contract. The web bundle's URL-based `app:web-surface` section is disabled by the patch, so no URL or browser fact reaches the model.

#### Token effect

One source line and one prompt paragraph per session; constant per process.

#### KV Cache effect

The section sits near the system prompt's head and is stable for the life of the process, so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **No client-plugin HMR** — the shared HMR row is disabled; rebuilding and reloading the window is the current dev loop.
- **No remote access** — the desktop shell is intentionally zero-port; remote access is a later milestone.
