# Agent Note: Native desktop release artifact matrix

Status: implemented

English | [中文](2026-08-14-desktop-release-artifact-matrix.zh.md)

## Problem

The desktop release workflow must provide a consistent portable format, distribution packages for Linux, coverage for each supported CPU architecture, and a machine-checkable manifest of the published bytes.

## Decision

The workflow packages every supported desktop target on a native GitHub-hosted runner. The matrix contains Windows x64 and arm64, macOS x64 and arm64, and Linux x64 and arm64. Windows emits an NSIS installer and a ZIP archive; macOS emits a DMG and a ZIP archive; Linux emits an AppImage, DEB, RPM, and `tar.gz` archive. The builder names each file with the product, version, operating system, and architecture so assets remain unambiguous after they are merged into one release. macOS publishes separate architecture-specific artifacts because the packaged application contains native modules that cannot be merged reliably by the universal builder on the hosted ARM runner.

The release job downloads all matrix artifacts, fails when an expected file is missing, writes a sorted `SHA256SUMS` file, and marks prerelease tags as prereleases while leaving stable tags eligible to become the latest release. Native runners are required because the packaged application contains platform-specific dependencies that cannot be proven by an x64 cross-build. Code signing and macOS notarization remain deployment inputs: the workflow disables automatic certificate discovery for unsigned CI builds and does not claim that an unsigned artifact is notarized.

## Alternatives considered

**Cross-building arm64 targets from x64 runners.** Rejected because optional native dependencies and Electron platform binaries can be selected for the host rather than the requested target; a green build would not prove that the delivered application starts on arm64.

**Publishing one universal macOS artifact from the ARM runner.** Rejected because the x64 staging app inherits ARM native modules from the workspace install, and `@electron/universal` rejects the duplicate Mach-O files. Separate x64 and arm64 artifacts preserve the correct native module for each target.

**Keeping one installer target per operating system.** Rejected because a single format does not cover both managed installation and download-and-run workflows, and Linux users commonly need both a self-contained AppImage and a distribution package.

**Adding signing and notarization credentials to this change.** Rejected because certificates, notarization credentials, and the organization's trust policy are deployment secrets rather than repository defaults. The artifact matrix is deterministic and ready to consume those secrets in a later release policy change.

**Separate workflows for every platform.** Rejected because duplicated release and checksum logic would allow the platform lanes to drift; one matrix keeps target coverage and publication rules reviewable in one place.

## Consequences

Each tagged release carries six architecture-labelled target combinations, installable and portable assets for Windows, macOS, and Linux, plus a checksum file. Matrix execution takes longer and depends on the availability of native hosted runner labels, but it makes platform-specific failures visible before publication. The published files are unsigned unless release infrastructure supplies signing and notarization configuration, so commercial distribution must add those credentials and verify the resulting trust metadata before treating a build as notarized.
