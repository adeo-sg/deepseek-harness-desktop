# Agent Note: Load the container native Loader helper from its installed path

Status: implemented

English | [中文](2026-08-15-noexec-container-native-loader.zh.md)

## Problem

The shipped Compose runtime uses a read-only root filesystem and a `noexec` in-memory `/tmp`. Cordis Loader's optional `node-addon-require-builtin` helper normally copies its native addon to the temporary directory before loading it. Linux refuses to map that copy from the `noexec` mount, Loader continues without Node's internal module loader, and the CLI's config-only HMR service then fails with the misleading diagnostic that `--expose-internals` is required. A plain `docker run` smoke does not reproduce the Compose security settings.

## Decision

The runtime image sets `NARB_DISABLE_NATIVE_CACHE=1`, so the helper loads its architecture-specific addon directly from the immutable npm installation under `/opt/dsh`. Compose retains the read-only root filesystem and `noexec` temporary mount. Kubernetes retains a read-only root and an in-memory `emptyDir`; the core `emptyDir` API has no mount-option field, so its tmpfs does not promise `noexec`. Source builds and saved-image deployments use the same direct-loading setting without depending on executable temporary storage. [Container releases from packed artifacts](../process/2026-08-15-container-release-from-packed-artifacts.md) owns the installed runtime layout; this decision owns the native-loading setting required by its hardened Compose configuration.

The container release workflow reloads the saved image and starts the packaged Compose file rather than a plain container. The smoke waits for health, requests `127.0.0.1:4080`, writes markers under `/data` and `/workspace`, recreates the service container, and requires both markers to survive. Static container validation pins the native-cache setting and the packaged-Compose smoke.

## Alternatives considered

**Allow executable files in Compose `/tmp`.** Rejected because the helper already has an installed native addon, while removing `noexec` weakens every process in the container for no application requirement.

**Launch Node with `--expose-internals`.** Rejected because it exposes an unsupported Node implementation interface to the whole application and the container entrypoint forwards extra arguments to the Web command rather than Node's `execArgv`.

**Remove the config-only HMR service.** Rejected as the container fix because live profile patch watching is an application contract, and Loader still uses the native helper to resolve installed bare plugin specifiers. A watcher implementation can evolve independently without requiring executable temporary files.

## Consequences

The image depends on the helper's supported `NARB_DISABLE_NATIVE_CACHE` switch and keeps native code in the installed package tree. In return, hardened Compose boots without executable temporary storage, Kubernetes does not depend on its temporary mount being executable, and release validation exercises the packaged deployment, port, health check, and named-volume recreation path that operators use.
