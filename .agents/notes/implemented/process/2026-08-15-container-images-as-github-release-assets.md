# Agent Note: Container images as GitHub Release assets

Status: implemented

English | [中文](2026-08-15-container-images-as-github-release-assets.zh.md)

## Problem

The container release needs to provide runnable packaged bytes without depending on an official image registry. Rebuilding the complete workspace under QEMU for a second architecture after an amd64 health check adds a long, duplicate build, while a deployment-only archive cannot run without either repository source or a separately distributed image.

## Decision

The [container release workflow](../../../../.github/workflows/container-release.yml) drives Buildx directly to build one native `linux/amd64` image tagged `localhost/deepseek-harness:<version>` and write it as a Docker archive without loading or publishing it. The workflow gzip-compresses that archive, writes and verifies its SHA-256 file, and loads the compressed archive for validation. It also verifies the deployment archive checksum, removes the packer's staging directory, extracts the archive, validates every file against the internal manifest, and runs the extracted Compose health and persistence smoke against the restored image. This sequence verifies the four files attached to the release rather than separate build or staging output. [Container releases from packed artifacts](2026-08-15-container-release-from-packed-artifacts.md) owns how the runnable image and deployment bundle are constructed; this decision owns their GitHub Release transport.

A `dsh-v<version>` tag creates a GitHub Release with four assets: the image archive, its checksum, the deployment archive, and its checksum. The packaging job has a 25-minute timeout and does not use an image-publishing action, request package-write permission, authenticate to an image registry, or push registry tags. A manual run retains the same files as a 30-day Actions artifact without creating a Release.

The [deployment packer](../../../../scripts/release/pack-container.ts) includes Compose, Kubernetes manifests, and the deployment guide. It excludes the Dockerfile and entrypoint because their source build context is not present in the deployment archive. Compose and Kubernetes reference the versioned local image restored by `docker load`; operators either preload that image into every cluster node or retag and push it to a registry they control before overriding the Kustomize image.

## Alternatives considered

**Publish a multi-platform image to GHCR.** Rejected because the release does not require an official hosted image, registry publication adds credentials and package-visibility administration, and QEMU repeats the full workspace build for arm64 after the amd64 build already passed.

**Publish only deployment templates.** Rejected because Compose and Kubernetes files alone do not contain the application, so the advertised release would still require a source checkout or an unspecified external image.

**Embed the saved image inside the deployment archive.** Rejected because separate assets let Docker users download only the image, keep per-file checksums simple, and avoid making the deployment packer read a large image into memory while generating its internal manifest.

## Consequences

The GitHub Release is self-contained when its four assets are used together and has no registry availability or visibility dependency. The build runs once on native amd64, so arm64 operators build from source or publish their own architecture-specific image. The compressed image must remain below GitHub's per-asset size limit, and Kubernetes deployments must preload the image on every node or use an operator-owned registry.
