# Agent Note: 原生桌面发布产物矩阵

Status: implemented

[English](2026-08-14-desktop-release-artifact-matrix.md) | 中文

## Problem

桌面发布 workflow 必须提供一致的便携格式、Linux 发行版安装包、每种受支持 CPU 架构的覆盖，以及一份可由机器校验的已发布字节清单。

## Decision

workflow 在原生 GitHub 托管 runner 上为每个支持的桌面目标打包。矩阵包含 Windows x64 与 arm64、macOS x64 与 arm64，以及 Linux x64 与 arm64。Windows 生成 NSIS 安装程序和 ZIP 压缩包；macOS 生成 DMG 和 ZIP 压缩包；Linux 生成 AppImage、DEB、RPM 和 `tar.gz` 压缩包。builder 将产品、版本、操作系统和架构写入每个文件名，因此产物合并到一个 release 后仍然不会产生歧义。macOS 发布分别对应架构的产物，因为打包应用含有 native 模块，托管 ARM runner 上的 universal builder 无法可靠合并这些模块。

release job 下载矩阵的全部产物，在缺少预期文件时失败，写出排序后的 `SHA256SUMS` 文件，并将预发布 tag 标记为 prerelease，同时让稳定 tag 具备成为 latest release 的资格。必须使用原生 runner，因为打包应用含有平台相关依赖，x64 交叉构建无法证明 arm64 产物能启动。代码签名和 macOS notarization 仍属于部署输入：workflow 会关闭无证书 CI 构建的自动证书发现，也不会声称未签名产物已经 notarize。

## Alternatives considered

**在 x64 runner 上交叉构建 arm64 目标。** 不采用，因为可选的 native 依赖和 Electron 平台二进制可能按宿主机而不是目标架构选择；构建显示成功也不能证明交付的应用能在 arm64 上启动。

**从 ARM runner 发布一个 universal macOS 产物。** 不采用，因为 x64 暂存应用会继承 workspace 安装中的 ARM native 模块，`@electron/universal` 会拒绝重复的 Mach-O 文件。分别发布 x64 与 arm64 产物可以保留每个目标所需的正确 native 模块。

**每个操作系统只保留一种安装格式。** 不采用，因为单一格式不能同时覆盖受管控安装和下载即运行的场景，而 Linux 用户通常需要自包含的 AppImage 与发行版安装包两者。

**在这次改动中加入签名和 notarization 凭据。** 不采用，因为证书、notarization 凭据和组织信任策略属于部署密钥，不是仓库默认值。产物矩阵保持确定性，后续发行策略变更可以在此基础上接入这些密钥。

**为每个平台拆成独立 workflow。** 不采用，因为重复的发布和 checksum 逻辑会让平台 lane 逐渐漂移；单一矩阵把覆盖范围和发布规则集中在一个位置，便于审查。

## Consequences

每个 tag release 都会携带六种带架构标识的目标组合、Windows、macOS 和 Linux 安装及便携产物，并附带 checksum 文件。矩阵执行时间更长，也依赖原生托管 runner 标签的可用性，但平台特有的失败会在发布前暴露。若发行基础设施没有提供签名和 notarization 配置，发布文件仍然是未签名的；商业化交付在把构建视为已 notarize 之前，必须补充这些凭据并校验最终信任元数据。
