# 部署 Web UI

[English](deployment.md) | 中文

本指南将 Web profile 部署到 Docker 或 Kubernetes。npx/本地运行器仍使用默认的 `http://127.0.0.1:3080`；容器部署使用 `4080`，因此两种模式可以在同一台机器上运行而不会端口冲突。

## 端口与信任

Web 服务器默认绑定 `127.0.0.1:3080`。对外网络部署必须设置 `DSH_WEB_HOST=0.0.0.0`、`DSH_WEB_PORT=4080` 和 `DSH_ALLOW_NON_LOOPBACK=1`；容器入口会将它们转换成 `--host 0.0.0.0 --port 4080 --allow-non-loopback`。

`DSH_TRUSTED_HOSTS` 是逗号分隔的浏览器 `Host` authority 列表，例如 `app.example.com` 或 `app.example.com:8443`。它保护 `/api` 浏览器信任围栏，但不提供认证、TLS 或 origin 策略。请将服务放在具备认证且终止 TLS 的反向代理或 Ingress 后面。

## Docker

### 构建镜像

请在仓库根目录构建。多阶段镜像会编译并打包工作区，将发布校验使用的同一组 npm tarball 安装到普通 npm 消费方中，校验已安装的 CLI 和当前架构对应的 Landlock 启动器，安装 bubblewrap 以及 `dsh plugin` 使用的固定 pnpm 版本，并以 UID 10001 运行。包管理器的数据和缓存位于可写的 `/data` 卷下。

```sh
docker build -t ghcr.io/sdkwork-ai/deepseek-harness:local .
```

### 使用 Compose 运行

在 shell 中设置 `DEEPSEEK_API_KEY`，并可在启动 Compose 前设置 `DSH_TRUSTED_HOSTS`。直接监听地址默认为 `127.0.0.1:4080`；只有在宿主机已有进程占用该端口时才修改 `DSH_PUBLISH_PORT`。除非已发布的监听地址受到具备身份验证的反向代理保护，否则应让 `DSH_PUBLISH_HOST` 保持在环回地址。

```sh
DEEPSEEK_API_KEY=your-key DSH_TRUSTED_HOSTS=localhost,127.0.0.1 docker compose up -d --build
```

上述命令从源码 checkout 构建。`dsh-container-<version>.tar.gz` 发布包包含仅用于部署的 Compose 文件：其中已移除构建部分，并将默认镜像固定为生成该发布包的仓库和版本。解压后可直接拉取并运行镜像；也可通过 `DSH_IMAGE` 覆盖该固定值。

```sh
tar -xzf dsh-container-<version>.tar.gz
cd dsh-container-<version>
docker compose pull
DEEPSEEK_API_KEY=your-key docker compose up -d
```

打开 `http://127.0.0.1:4080`。命名卷 `dsh-data` 保存 `$DSH_HOME`；`dsh-workspace` 保存默认 agent（智能体）的工作区。镜像健康检查请求 `/`，Web profile 挂载完成后该路径才会提供服务。

## Kubernetes

清单会创建一个副本、两个 `ReadWriteOnce` PVC、一个 ClusterIP Service、一个 NetworkPolicy，以及 HTTP 启动、就绪和存活探针。应用 Kustomization 之前先创建 API key Secret。

```sh
kubectl create secret generic dsh-credentials \
  --from-literal=DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"
kubectl apply -k deploy/kubernetes
kubectl port-forward svc/dsh 4080:4080
```

端口转发就绪后打开 `http://127.0.0.1:4080`。端口转发使用 `4080`；npx/本地运行器仍使用 `3080`。

如果需要外部 URL，请编辑 `deploy/kubernetes/configmap.yaml`，让 `DSH_TRUSTED_HOSTS` 包含 Ingress 的精确 authority。可选的 NGINX `ingress.example.yaml` 需要 `dsh-basic-auth` Secret，其中 `auth` 键包含 htpasswd 文件；它还需要 `dsh-tls` TLS Secret。请先创建二者，再应用该示例并重启 Deployment。其他 Ingress controller 必须提供等效的身份验证和 TLS。Ingress 必须保留 `/api` 下行连接所需的 WebSocket upgrade。

## 持久化数据

将 `/data` 挂载为 `$DSH_HOME`，将 `/workspace` 挂载为工作区根目录。数据 PVC 包含会话、附件、settings、凭据、存储投影、profiles 和 agent presets。不要把凭据写入镜像或 ConfigMap；请通过 Secret 或环境变量注入 `DEEPSEEK_API_KEY`。

Deployment 使用 `Recreate`，因为 JSONL 会话与存储文件属于单个副本的本地数据。扩容需要共享存储和应用级所有权设计；这些清单不提供该协调机制。

## 安全与运维

Web 载体没有内置 TLS 或认证。对可信网络之外开放前，请使用 Ingress 或反向代理提供认证、TLS、请求限制和访问策略。保持 `DSH_PERMISSION_MODE=workspace-write`；`danger-full-access` 会移除文件效果限制，不是容器加固设置。

除 `/data`、`/workspace` 和内存中的 `/tmp` 外，镜像根文件系统为只读。镜像包含 `bash`、bubblewrap 和对应的 Landlock 启动器；沙箱会选择可用且能强制执行的后端。如果宿主既不支持 bubblewrap user namespace，也不支持 Landlock，shell 工具会安全失败。不要挂载 ServiceAccount token，也不要为了绕过该失败而添加 Linux capability。

探针使用 `GET /`，因为 Web 服务器没有无需认证的健康 endpoint。非 200 响应表示前端或 profile 尚未挂载；请先检查 `docker compose logs` 或 `kubectl logs`，再调整探针时间。

## 发布镜像

容器工作流只会从 `dsh-v<version>` 标签发布 `ghcr.io/<repository-owner>/deepseek-harness:<version>` 和不可变的 commit 标签。手动运行工作流只会构建镜像、执行健康检查并保留部署输出，不会写入 registry 标签。对应的 GitHub Release 会长期保留 `dsh-container-<version>.tar.gz` 及其 `.sha256` 文件作为部署包；工作流还会将完整输出作为保留 30 天的 Actions artifact 保存。GHCR 首次推送时可能将包创建为 `private`；组织或包管理员必须在 GitHub 包设置中将 `deepseek-harness` 设为 `public`。工作流会校验该设置并执行匿名拉取；镜像不是 `public` 时会报告所需修正并失败。现有 npm 发布工作流独立运行；`pnpm run release:pack` 不包含 Docker 镜像。生产环境请固定已发布的镜像标签或 digest，并在应用版本变更时一并更新 Kustomize 镜像覆盖值。

## 排错

- **容器在监听前退出**：当 `DSH_WEB_HOST=0.0.0.0` 时检查 `DSH_ALLOW_NON_LOOPBACK=1`，并确认 `DSH_WEB_PORT` 是 1 到 65535 的整数。
- **页面能打开但 `/api` 返回 403**：将浏览器的精确 `Host` authority 加入 `DSH_TRUSTED_HOSTS`；不能用转发的 host header 替代它。
- **Pod 已就绪但 shell 工具失败**：检查沙箱日志和工作节点的 user namespace 策略；当 `bubblewrap` 或所需内核功能不可用时，镜像会安全失败。
- **重启后数据消失**：确认 `dsh-data` 和 `dsh-workspace` 都已挂载，并且 PVC 已绑定。
