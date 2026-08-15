# Agent Note: Unified native release assets

Status: implemented

English | [中文](2026-08-15-unified-native-release-assets.zh.md)

## Problem

Desktop and container packaging used independent tag triggers and release jobs. A product version could therefore create two GitHub Releases or expose a partial asset set while another workflow was still building. Six Desktop runners also produce update metadata with overlapping filenames, so flattening their artifacts can silently replace one architecture's records. A deployment-only archive is not runnable without source or a separately distributed image, and an amd64-only image does not cover supported arm64 deployment hosts.

## Decision

The [dsh artifact workflow](../../../../.github/workflows/container-release.yml) is the only `dsh-v<version>` GitHub Release publisher. It calls the [Desktop package matrix](../../../../.github/workflows/desktop-release.yml), which remains reusable and manually runnable but has no tag-triggered release job. The same tagged run builds the Compose and Kubernetes deployment bundle and native `linux/amd64` and `linux/arm64` images. Each image is saved, removed, loaded from its compressed archive, and health-checked; amd64 also runs the packaged Compose definition and verifies both persistent volumes across container replacement.

The [release assembler](../../../../scripts/release/assemble-github-release.ts) accepts one artifact directory for each expected Desktop target, the deployment bundle, and both container images. It rejects version mismatches, missing or extra artifact directories and files, invalid archive checksums, and update metadata whose SHA-512 values do not match the installers. It parses update YAML as structured data and writes canonical files: Windows and macOS metadata contains both x64 and arm64 entries, while Linux retains `latest-linux.yml` for x64 and `latest-linux-arm64.yml` for arm64. Linux asset validation preserves electron-builder's format-specific architecture names (`x86_64`/`amd64`/`x64` for x64 packages and `aarch64` for an arm64 RPM). macOS ZIP blockmaps remain architecture-specific assets.

The assembled Release contains exactly 31 assets: 16 Desktop installers and portable archives, four macOS blockmaps, four update metadata files, the deployment archive and checksum, two image archives and their checksums, and one `SHA256SUMS` covering the other 30 files. Uploads remain in a draft until the workflow verifies exact asset names, every remote size, every GitHub-reported SHA-256 digest against `SHA256SUMS` or the local checksum-file digest, and downloaded copies of `SHA256SUMS` and updater metadata. It then publishes the verified draft as a regular GitHub Release, including when the tag contains a prerelease segment. The version string remains the release-maturity indicator.

The Release job uses one repository-wide concurrency group. Before publication, the [Latest selector](../../../../scripts/release/select-github-latest.ts) ranks every non-draft `dsh-v<semver>` or legacy `v<semver>` Release and includes the current draft because the same PATCH publishes it. Semantic-version precedence places a stable version above prereleases with the same release numbers, and the canonical `dsh-v` tag wins an equal-precedence tie. The workflow sends `make_latest=true` only when the current tag is the selected highest version; an older tag receives `make_latest=false`. It polls `/releases/latest` up to five times at two-second intervals and requires the selected highest tag.

Existing-release lookup treats only zero matching tags as absence, so an API failure aborts before upload. A retry replaces only an incomplete draft. An existing public Release keeps its assets read-only and must match the verified collection; after verification, the workflow reapplies published and non-prerelease metadata without allowing an older tag to replace a higher Latest version.

Container images are sibling Release assets rather than registry publications or members of the deployment archive. The deployment archive omits the source-build-only Dockerfile and entrypoint because their required workspace build context is absent. Compose and Kubernetes reference the versioned local image restored by `docker load`; an operator preloads it on each cluster node or retags it into an operator-owned registry. The workflow never authenticates to an image registry, requests package-write permission, or pushes an image tag.

The private `apps/desktop` manifest is a dsh version member but not an npm publish member. `release:dsh` updates it with the workspace family, while release verification, packing, and npm publication operate only on publishable package manifests.

## Alternatives considered

**Let Desktop and container workflows update the same GitHub Release independently.** Neither workflow can prove the other's complete output, concurrent uploads expose an intermediate asset set, and a retry cannot reject stale files as one exact collection.

**Rename each architecture's metadata to a custom channel file.** Electron-updater defines the platform channel filenames. Windows and macOS select architecture-specific URLs from one file, while Linux uses the architecture suffix in the channel filename.

**Build arm64 through QEMU on the amd64 runner.** A full workspace build is expensive under emulation, and a successful cross-build does not prove that the saved image starts. Native runners verify the restored archive on its target architecture.

**Publish a multi-platform registry manifest.** The offline release intentionally has no dependency on registry credentials, package visibility, or hosted-image retention. Operators retain the option to publish the loaded image to a registry they control.

**Publish only deployment templates.** Compose and Kubernetes files do not contain the application, so that release would still require a source checkout or an unspecified external image.

**Embed both images in the deployment archive.** Separate architecture assets let operators download only the image they need, preserve simple per-file checksums, and keep the deployment packer from buffering large image archives.

**Mark release-candidate tags as GitHub prereleases.** GitHub excludes prereleases from the Latest pointer, which leaves an older product version as the default Release download. The `-rc` version segment continues to identify release maturity, while npm publication and its dist-tags remain a separate sequence.

## Consequences

A `dsh-v<version>` run publishes only after all six Desktop targets, both native container images, the deployment bundle, canonical updater metadata, and checksum generation succeed. Manual workflow runs retain Actions artifacts without creating a GitHub Release. After a successful publication, GitHub's Latest link resolves to the highest public dsh semantic version regardless of tag-run completion or retry order; a stable version outranks prereleases with the same release numbers. A release-candidate tag appears as a regular GitHub Release, so consumers read its `-rc` version segment to determine maturity. The complete build consumes eight native runner lanes and uploads large offline images, but every advertised architecture is executed before publication and one fail-loud asset inventory owns the Release. Kubernetes operators must preload the selected image on every node or use their own registry, and each compressed image must remain below GitHub's per-asset size limit.
