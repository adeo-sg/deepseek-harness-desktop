# Agent Note: Reduce desktop installer file work and use direct ZIP extraction

Status: implemented

English | [中文](2026-08-14-desktop-installer-payload-and-zip-extraction.zh.md)

## Problem

The desktop package must keep `asar` disabled because profile module fallback links target real package directories. Electron-builder therefore copies the workspace dependency closure as ordinary files. Development sources, source maps, and compiler metadata contributed roughly 14,000 files to `resources/app`, and NSIS's differential 7z path extracted to a temporary directory before copying into the install directory.

## Decision

The desktop file set excludes source maps, TypeScript-family sources, and TypeScript build metadata after retaining the runtime `lib`, frontend configuration, and package manifests. The NSIS target sets `differentialPackage: false` and `useZip: true`, so the installer extracts the remaining payload directly into the destination. No automatic updater consumes differential package metadata in this application.

## Alternatives considered

**Enable `asar` and keep the existing fallback links.** Rejected because an asar archive is a file and cannot be the target of the profile's real-directory junctions.

**Keep the differential 7z payload.** Rejected for the desktop first-install path: it is smaller, but its temporary extraction and copy work is the dominant installer cost for this file-heavy package.

**Set `useZip` without disabling differential packaging.** Rejected because electron-builder keeps the 7z format whenever differential packaging remains enabled, so the setting would not change installation behavior.

## Consequences

The packaged app retains its runtime dependency closure while dropping non-runtime files. The `resources/app` payload falls from about 27,000 files and 199 MB to about 13,000 files and 113 MB in the measured Windows build. The ZIP installer is larger than the old 7z installer, but direct extraction substantially reduces first-install file operations; differential update artifacts are not produced.

## Testing

The optimized unpacked layout passes the packaged carrier, bridge, frontend bundle, and first-run session smoke. A Windows silent-install probe times the old and optimized installers into fresh per-user directories: the old layout (27,361 files, differential 7z) installs in about 129 s, the optimized layout (12,934 files, direct ZIP extraction) in about 22 s. An intermediate build that kept the differential 7z payload alongside the exclusions failed to decompress at install time, which confirms that `useZip` only changes extraction when `differentialPackage` is also disabled. The native worker artifact remains present after filtering.
