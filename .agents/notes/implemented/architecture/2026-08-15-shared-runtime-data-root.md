# Agent Note: One runtime data root for Web and desktop launchers

Status: implemented

English | [中文](2026-08-15-shared-runtime-data-root.zh.md)

## Problem

The Web launcher and the Electron launcher compose the same base and Web bundles, but desktop boot owned a second copy of profile assembly. Desktop resolved bundles from a module-relative package anchor, did not keep profile and home patch layers live, and its testable data-root override did not reach `settings.yaml`, credentials, or other `dshHomePath()` expressions. A configuration written through the settings center could therefore be read from a different runtime root or remain stale after a patch edit.

## Decision

`dsh-app-boot` accepts an optional launcher-owned `homePath` resolver. The desktop host passes the resolved Harness home into boot and environment-layer discovery, and the base composition gives the settings provider, credential provider, and shell environment that same resolver explicitly. The default remains `$DSH_HOME` or `~/.dsh`, so `npx @deepseek-ai/dsh web` keeps its existing behavior.

Desktop resolves its profile from the actual installation anchor supplied by Electron (`resources/app/package.json` in a package and `apps/desktop/package.json` in development). It clones the initial patch list before Loader applies it. Its bare-plugin resolution anchor is the active Web profile manifest: Node internal loader resolution uses that URL when available, while embedded runtimes resolve the package entry from the same anchor with ESM `import` conditions before importing it. Profile-local plugins therefore select the same conditional export as Web, and installation plugins remain available through the healed `profiles/node_modules` fallback. `watchUserPatches` uses Cordis HMR when the launcher exposes Node loader internals and an exact-path file watcher otherwise, so Electron keeps live configuration without requiring `--expose-internals`. Both profile and home patch watchers re-read the complete layer stack and preserve bundle defaults when an override is removed.

Both launchers load the canonical `web` profile under `$DSH_HOME/profiles/web`, including its ordered bundle list, profile-installed dependencies, and `cordis.patch.yml`. Electron then applies the installation-owned `dsh-desktop-app` bundle as a runtime overlay after the profile and home patch layers. The overlay is never persisted in the Web profile manifest, so plugin management has one target and the Web launcher cannot receive desktop-only carrier rows.

## Consequences

The Web and desktop settings center uses the same `settings.yaml`, `.credentials.yaml`, `.env`, session roots, storage roots, shell-visible `DSH_HOME`, profile bundles, profile-installed plugins, profile patch, and home patch under one Harness home. A desktop caller embedding the host with a custom home can keep all persistent files inside that root without changing process-wide environment variables. Desktop still uses its carrier and IPC transport, while the shared plugin composition and configuration precedence remain identical below that overlay.

## Verification

The change is covered by the app-boot home-resolver and ESM conditional-export tests, a desktop host test that loads a real profile-local plugin, Web profile patch, and explicit-home `.env`, source composition and shipped-preset byte parity, Host library and Web frontend builds, desktop packaging, dependency-closure validation, and a packaged boot probe that fetches every advertised client bundle and loads a conditional-export profile plugin.

## Alternatives considered

Changing `DSH_HOME` inside Electron was rejected because it mutates process-global state and would make child-process behavior depend on startup order. A separate `desktop` profile was rejected because every plugin installation and profile-local patch would need duplicate writes and could drift from `npx @deepseek-ai/dsh web`; persisting the desktop bundle in the Web profile was rejected because it would send Electron-only rows to the Web launcher.
