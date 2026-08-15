# Agent Note: 统一的原生发布产物

Status: implemented

[English](2026-08-15-unified-native-release-assets.md) | 中文

## 问题

Desktop 与容器打包使用独立的 tag 触发器和 Release job。同一产品版本可能因此创建两个 GitHub Release，或在另一条工作流仍在构建时暴露不完整的资产集合。六个 Desktop runner 还会生成文件名重叠的更新元数据，扁平化这些 artifact 会静默替换其中一种架构的记录。仅包含部署文件的归档无法脱离源码或另行分发的镜像运行，而仅有 amd64 的镜像也无法覆盖受支持的 arm64 部署宿主。

## 决策

[dsh 产物工作流](../../../../.github/workflows/container-release.yml)是唯一发布 `dsh-v<version>` GitHub Release 的工作流。它调用 [Desktop 打包矩阵](../../../../.github/workflows/desktop-release.yml)；后者仍可复用和手动运行，但没有 tag 触发的 Release job。同一次 tag 运行会构建 Compose 与 Kubernetes 部署包，以及原生 `linux/amd64` 和 `linux/arm64` 镜像。每个镜像都会被保存、删除、从压缩归档加载并通过健康检查；amd64 还会运行打包后的 Compose 定义，并验证容器替换前后两个持久卷的数据。

[Release 汇总器](../../../../scripts/release/assemble-github-release.ts)为每个预期 Desktop 目标、部署包和两个容器镜像接收一个 artifact 目录。版本不匹配、artifact 目录或文件缺失和多余、归档 checksum 无效，以及更新元数据中的 SHA-512 与安装包不一致都会被拒绝。汇总器将更新 YAML 解析为结构化数据并写出规范文件：Windows 与 macOS 元数据同时包含 x64 和 arm64 条目；Linux 为 x64 保留 `latest-linux.yml`，为 arm64 保留 `latest-linux-arm64.yml`。Linux 资产校验保留 electron-builder 按格式使用的架构名（x64 包使用 `x86_64`/`amd64`/`x64`，arm64 RPM 使用 `aarch64`）。macOS ZIP blockmap 仍是架构特定资产。

汇总后的 Release 恰好包含 31 个资产：16 个 Desktop 安装包和便携归档、四个 macOS blockmap、四个更新元数据文件、部署归档及其 checksum、两个镜像归档及其 checksum，以及一个覆盖其余 30 个文件的 `SHA256SUMS`。上传内容会保留在草稿中，直到工作流校验精确的资产名称、每个远端文件的大小、GitHub 报告的每个 SHA-256 摘要与 `SHA256SUMS` 或本地 checksum 文件摘要一致，以及下载后的 `SHA256SUMS` 与 updater 元数据副本，随后才将已校验的草稿发布为普通 GitHub Release；tag 即使包含预发布段也采用相同行为。版本字符串继续表示 Release 的成熟度。

Release job 使用一个覆盖整个仓库的 concurrency group。发布前，[Latest 选择器](../../../../scripts/release/select-github-latest.ts)会对所有非草稿 `dsh-v<semver>` 或旧版 `v<semver>` Release 排序；当前草稿也会参与，因为同一个 PATCH 会将其公开。语义版本优先级会把稳定版排在相同版本号的预发布版之上；优先级相同时，规范的 `dsh-v` tag 排在旧版 tag 之前。只有当前 tag 是选出的最高版本时，工作流才发送 `make_latest=true`；旧 tag 会收到 `make_latest=false`。工作流最多以两秒间隔查询 `/releases/latest` 五次，并要求其指向选出的最高 tag。

查找现有 Release 时，只有 tag 匹配数为零才视为不存在，因此 API 失败会在上传前中止。重试只替换未完成的草稿。已公开 Release 的资产保持只读，并且必须与已校验集合一致；校验完成后，工作流会重新应用已发布和非 prerelease 元数据，但不允许旧 tag 替换更高版本的 Latest。

容器镜像是独立的 Release 资产，不发布到 registry，也不嵌入部署归档。部署归档不包含仅用于源码构建的 Dockerfile 和 entrypoint，因为归档中没有它们所需的 workspace 构建上下文。Compose 和 Kubernetes 引用由 `docker load` 恢复的版本化本地镜像；运维人员需要在每个集群节点预加载镜像，或重新标记并推送到自己控制的 registry。工作流不会向镜像 registry 认证、请求 package 写权限或推送镜像 tag。

私有的 `apps/desktop` manifest 是 dsh 版本成员，但不是 npm 发布成员。`release:dsh` 会随 workspace family 更新它，而发布校验、打包和 npm 发布只处理可发布 package manifest。

## 备选方案

**让 Desktop 与容器工作流分别更新同一个 GitHub Release。** 任何一条工作流都无法证明另一条的完整输出，并发上传会暴露中间资产集合，重试也无法把陈旧文件作为一个精确集合拒绝。

**将每种架构的元数据改名为自定义 channel 文件。** Electron-updater 定义了平台 channel 文件名。Windows 和 macOS 从同一个文件选择架构特定 URL，而 Linux 在 channel 文件名中使用架构后缀。

**在 amd64 runner 上通过 QEMU 构建 arm64。** 完整 workspace 构建在模拟环境中成本很高，交叉构建成功也不能证明保存的镜像可以启动。原生 runner 会在目标架构上验证恢复后的归档。

**发布多平台 registry manifest。** 离线发布刻意不依赖 registry 凭据、包可见性或托管镜像保留策略。运维人员仍可把加载后的镜像发布到自己控制的 registry。

**只发布部署模板。** Compose 与 Kubernetes 文件本身不包含应用，因此该发布仍需要源码 checkout 或未明确指定的外部镜像。

**把两个镜像嵌入部署归档。** 分离架构资产让运维人员只下载所需镜像、保留简单的逐文件 checksum，并避免部署打包器缓存大型镜像归档。

**将候选版本 tag 标记为 GitHub prerelease。** GitHub 会从 Latest 指针中排除 prerelease，导致默认 Release 下载仍指向较旧的产品版本。版本中的 `-rc` 段继续表示 Release 的成熟度；npm 发布及其 dist-tag 使用独立流程。

## 后果

一次 `dsh-v<version>` 运行只有在六个 Desktop 目标、两个原生容器镜像、部署包、规范 updater 元数据和 checksum 生成全部成功后才会发布。手动工作流运行只保留 Actions artifact，不创建 GitHub Release。发布成功后，无论 tag 工作流的完成或重试顺序如何，GitHub 的 Latest 链接都会解析到公开 dsh Release 中语义版本最高的一项；相同版本号下，稳定版高于预发布版。候选版本 tag 会显示为普通 GitHub Release，因此使用者需要通过版本中的 `-rc` 段判断成熟度。完整构建会占用八条原生 runner lane 并上传大型离线镜像，但每种公开支持的架构都会在发布前真实执行，且 Release 由一份快速失败的资产清单统一管理。Kubernetes 运维人员必须在每个节点预加载选定镜像，或使用自己的 registry；每个压缩镜像还必须低于 GitHub 的单资产大小限制。
