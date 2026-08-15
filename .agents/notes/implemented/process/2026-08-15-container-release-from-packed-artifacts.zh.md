# Agent Note: 从打包产物构造容器发布

Status: implemented

[English](2026-08-15-container-release-from-packed-artifacts.md) | 中文

## 问题

Web profile 需要可复现的 Docker 与 Kubernetes 发行方式，但工作区部署闭包不一定包含已安装 CLI 在运行时解析的全部对等依赖和 profile 裸插件。部署归档不包含仓库源码时，也不能原样复用需要源码构建的 Compose 定义。

## 决策

签入的 [Dockerfile](../../../../Dockerfile) 会构建完整工作区，打包 `dsh` 与 `vendor` 发布 family 以及 Landlock 入口包，并将全部 tarball 作为普通 npm 消费方的直接依赖安装。npm 会解析该入口针对目标 Linux 架构的公开可选依赖；构建阶段要求该启动器可执行，然后才运行已安装 CLI 的 `--version` 路径。运行时阶段会将该消费方复制到 `/opt/dsh`。镜像提供 Node.js、bash、bubblewrap、Landlock 启动器、git 以及 `dsh plugin` 使用的固定 pnpm；进程以 UID 10001 运行，包管理器数据位于可写的 `/data` 卷下。

容器部署监听 `4080`，而 npx 和本地 Web 运行器仍使用 `127.0.0.1:3080`。容器入口不经过 shell，而是将环境配置转换为 argv，并要求与 CLI 相同的显式非回环选择。

[容器发布工作流](../../../../.github/workflows/container-release.yml)会在标签和手动运行时启动 amd64 镜像并执行健康检查，但只有 `dsh-v<版本>` 标签可以向 GHCR 发布 amd64 与 arm64 镜像或创建 GitHub Release。随后它会要求 GHCR 包为 `public` 并验证匿名拉取；GitHub Packages API 不提供可见性更新，因此包可见性是由管理员负责的发布前提。[部署打包器](../../../../scripts/release/pack-container.ts)会复制部署资产，从打包后的 Compose 文件中移除只用于源码的 `build` 部分，将 Compose 和 Kubernetes 固定到执行发布的镜像仓库与版本，记录逐文件哈希，并为归档生成 SHA-256 校验和。标签对应的 GitHub Release 会长期保留归档及其校验文件；Actions artifact 还会将完整输出保留 30 天。

Compose 默认只在 `127.0.0.1` 发布直接监听地址。Kubernetes Deployment 不挂载 ServiceAccount token，其可选 NGINX Ingress 示例同时要求 TLS 和身份验证 Secret。这些默认值会让未经身份验证的 Web API 远离不可信网络，同时仍允许显式配置的具备身份验证的反向代理访问它。

## 曾考虑的替代方案

**使用 `pnpm deploy` 构建运行时。** 不予采纳，因为部署闭包可能遗漏工作区对等依赖以及只由组合后 profile 命名的插件，导致镜像虽然构建成功，却无法启动 Web profile。

**将构建后的 monorepo 复制到运行时镜像。** 不予采纳，因为这种方式会混合源码工作区布局与安装后的发行布局，保留仅开发时使用的文件和依赖，也不会验证发布流程实际发布的 npm 包集合。

**原样打包用于源码构建的 Compose 文件。** 不予采纳，因为其构建上下文需要部署归档没有携带的仓库源码。发布归档改为拉取固定镜像，并仍可通过 `DSH_IMAGE` 或 Kustomize 镜像覆盖进行替换。

## 后果

镜像构建会执行完整工作区构建和包安装，包括一个公开的平台包，因此成本高于复制现有工作区输出。相应地，运行时布局与 npm 发布产物一致，两个 Linux 沙箱后端都存在，部署归档无需仓库源码即可运行，并且本地端口和容器端口能够并存。静态校验会固定构建顺序、环回端口映射、Kubernetes 身份与网络策略、探针以及需要身份验证的 Ingress 示例，发布工作流则负责 Linux 上真实的 Docker 构建和健康冒烟测试。
