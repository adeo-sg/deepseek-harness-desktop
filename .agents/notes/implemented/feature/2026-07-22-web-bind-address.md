# Agent Note: Explicit web bind address

Status: implemented

English | [中文](2026-07-22-web-bind-address.zh.md)

## Problem

`dsh web` binds every network interface even when its browser runs on the same machine. Local use therefore exposes an unauthenticated development server without an explicit operator choice, while remote-container and LAN-browser use still needs a supported way to accept non-loopback connections.

The HTTP carrier also hides the bind address inside `startWebServer()`, so alternate shells cannot state their own network policy at the package boundary.

## Decision

`dsh web` binds `127.0.0.1` by default. The CLI accepts `--host 0.0.0.0` as the explicit all-interface mode and rejects other values so its network modes remain a small, deliberate contract. The CLI's all-interface mode is additionally gated by `--allow-non-loopback`; the [explicit non-loopback Web deployment opt-in](2026-08-15-explicit-non-loopback-web-opt-in.md) owns that deployment decision. All-interface mode keeps printing the loopback URL and, when available, the first external IPv4 URL.

`WebServerOptions.host` is required. The HTTP carrier passes that value to `node:http` without supplying a fallback, leaving each shell responsible for its bind policy. Programmatic carrier consumers may select another hostname or address directly.

## Alternatives considered

**Keep `0.0.0.0` as the default.** Rejected because ordinary same-machine use does not need network-wide reachability and should not acquire it implicitly.

**Use a boolean exposure flag.** Initially rejected because `--host 0.0.0.0` names the resulting socket behavior directly and matches the underlying server option without introducing a second term. The later deployment requirement supersedes that part of the decision: `--allow-non-loopback` now gates this host mode; the [explicit non-loopback Web deployment opt-in](2026-08-15-explicit-non-loopback-web-opt-in.md) records why.

**Default inside `startWebServer()`.** Rejected because the carrier has multiple possible shells and no basis for choosing their deployment policy. Requiring `host` makes the choice visible at every assembly call.

## Consequences

Local `dsh web` starts remain reachable at `http://127.0.0.1:3080`; a browser on another machine must opt in with `dsh web --host 0.0.0.0 --allow-non-loopback` and provide an authenticated deployment boundary. The CLI does not yet expose custom interface addresses or IPv6 modes, while programmatic carrier consumers retain that flexibility. Server tests pin both loopback and all-interface forwarding into the Node listen boundary, and startup tests cover the explicit opt-in.
