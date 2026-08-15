# Agent Note: 以 GitHub Release 资产发布容器镜像

Status: implemented

[English](2026-08-15-container-images-as-github-release-assets.md) | 中文

## 问题

容器发布需要提供可运行的打包字节，而不依赖官方镜像 registry。在 amd64 健康检查后通过 QEMU 为第二种架构重新构建完整工作区，会增加一次耗时很长的重复构建；仅包含部署文件的归档则必须依赖仓库源码或单独分发的镜像才能运行。

## 决策

[容器发布工作流](../../../../.github/workflows/container-release.yml)直接驱动 Buildx 构建一个标记为 `localhost/deepseek-harness:<version>` 的原生 `linux/amd64` 镜像，并将其写为 Docker 归档，而不加载或发布镜像。工作流使用 gzip 压缩归档，写入并校验 SHA-256 文件，再加载压缩归档进行验证。它还会校验部署归档的摘要，删除打包器的暂存目录，解压归档，根据内部 manifest 校验每个文件，并针对恢复后的镜像运行解压后 Compose 的健康与持久化冒烟测试。该顺序验证的是附加到 Release 的四个文件，而不是另一份构建结果或暂存输出。[从打包产物构造容器发布](2026-08-15-container-release-from-packed-artifacts.md)负责构造可运行镜像与部署包，本决策负责通过 GitHub Release 传输这些产物。

`dsh-v<version>` 标签会创建包含四个资产的 GitHub Release：镜像归档及其校验文件、部署归档及其校验文件。打包 job 最多执行 25 分钟，不使用镜像发布 action、不请求 package 写权限、不向镜像 registry 认证，也不推送 registry 标签。手动运行不会创建 Release，而是将相同文件保留为 30 天的 Actions artifact。

[部署打包器](../../../../scripts/release/pack-container.ts)包含 Compose、Kubernetes 清单和部署指南。Dockerfile 与入口文件所需的源码构建上下文不在部署归档中，因此打包器会排除它们。Compose 和 Kubernetes 引用 `docker load` 恢复的版本化本地镜像；运维人员需要将该镜像预加载到每个集群节点，或重新标记并推送到自己控制的 registry，再覆盖 Kustomize 镜像。

## 曾考虑的替代方案

**向 GHCR 发布多平台镜像。** 不予采纳，因为本发布不需要官方托管镜像，registry 发布会增加凭据和包可见性管理，而且在 amd64 构建已经通过后，QEMU 会为 arm64 重复执行完整工作区构建。

**只发布部署模板。** 不予采纳，因为 Compose 和 Kubernetes 文件本身不包含应用，所以所宣传的发布仍需要源码 checkout 或未明确指定的外部镜像。

**将保存的镜像嵌入部署归档。** 不予采纳，因为分离资产可让 Docker 用户只下载镜像、保持逐文件校验简单，并避免部署打包器在生成内部 manifest 时将大型镜像读入内存。

## 后果

同时使用四个资产时，GitHub Release 可以独立部署，并且不依赖 registry 可用性或可见性。构建只在原生 amd64 上执行一次，因此 arm64 运维人员需要从源码构建或发布自己的特定架构镜像。压缩镜像必须低于 GitHub 的单资产大小限制；Kubernetes 部署必须在每个节点预加载镜像，或使用运维人员自己的 registry。
