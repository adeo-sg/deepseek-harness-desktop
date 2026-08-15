# Agent Note: Container releases from packed artifacts

Status: implemented

English | [中文](2026-08-15-container-release-from-packed-artifacts.zh.md)

## Problem

The Web profile needs a reproducible Docker and Kubernetes distribution, but a workspace deployment closure does not necessarily contain every peer dependency and bare profile plugin that the installed CLI resolves at runtime. A deployment archive also cannot reuse a source-build Compose definition unchanged when the archive does not contain the repository source.

## Decision

The checked-in [Dockerfile](../../../../Dockerfile) builds the complete workspace, packs the dsh and vendor release families plus the Landlock entry package, and installs every tarball as a direct dependency of an ordinary npm consumer. npm resolves the entry's public optional dependency for the target Linux architecture, and the builder requires that launcher to be executable before it runs the installed CLI's `--version` path. The runtime stage copies that consumer to `/opt/dsh`. The image supplies Node.js, bash, bubblewrap, the Landlock launcher, git, and the pinned pnpm used by `dsh plugin`; it runs as UID 10001 with package-manager data under the writable `/data` volume.

Container deployments listen on `4080`, while the npx and local Web runner retains `127.0.0.1:3080`. The container entrypoint converts environment configuration into argv without a shell and requires the same explicit non-loopback opt-in as the CLI.

The [container release workflow](../../../../.github/workflows/container-release.yml) starts and health-checks an amd64 image on tag and manual runs, but only a `dsh-v<version>` tag may publish amd64 and arm64 images to GHCR or create a GitHub Release. It then requires the GHCR package to be public and proves anonymous pull access; GitHub package visibility is an administrator-owned prerequisite because the Packages API does not expose a visibility update. The [deployment packer](../../../../scripts/release/pack-container.ts) copies the deployment assets, removes the source-only `build` section from the packaged Compose file, pins Compose and Kubernetes to the releasing image repository and version, records per-file hashes, and emits a SHA-256 checksum for the archive. The tag's GitHub Release retains the archive and its checksum; the Actions artifact additionally retains the complete output for 30 days.

Compose publishes the direct listener on `127.0.0.1` by default. The Kubernetes Deployment does not mount a ServiceAccount token, and its optional NGINX Ingress example requires both TLS and an authentication Secret. These defaults keep the unauthenticated Web API off untrusted networks while still allowing an explicitly authenticated reverse proxy to reach it.

## Alternatives considered

**Build the runtime with `pnpm deploy`.** Rejected because the deployed closure can omit workspace peer dependencies and plugins named only by the composed profile, producing an image that builds successfully but cannot boot the Web profile.

**Copy the built monorepo into the runtime image.** Rejected because it mixes source-workspace layout with the installed distribution, retains development-only files and dependencies, and does not exercise the npm package set that the release process publishes.

**Package the source-build Compose file unchanged.** Rejected because its build context requires repository source that the deployment archive does not carry. The release archive instead pulls its pinned image and remains overridable through `DSH_IMAGE` or a Kustomize image override.

## Consequences

Image builds perform the full workspace build and package installation, including one public platform package, so they cost more than copying existing workspace output. In return, the runtime layout matches the npm release artifacts, both Linux sandbox backends are present, the deployment archive runs without repository source, and the local and container ports can coexist. Static validation pins the build order, loopback port mapping, Kubernetes identity and network policy, probes, and authenticated Ingress example, while the release workflow owns the real Docker build and health smoke on Linux.
