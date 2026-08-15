# Agent Note：Web 与桌面启动器使用同一运行时数据根

Status: implemented

[English](2026-08-15-shared-runtime-data-root.md) | 中文

## Problem

Web 启动器与 Electron 启动器使用相同的 base 和 Web bundle，但 desktop 自己复制了一套 profile 组装逻辑。desktop 通过模块相对的包锚点解析 bundle，不保持 profile 和 home patch 实时更新，而且可测试的数据根覆盖没有传递给 `settings.yaml`、凭据和其他 `dshHomePath()` 表达式，因此配置中心写入的配置可能被另一套运行时读取，或在 patch 编辑后保持旧值。

## Decision

`dsh-app-boot` 接受启动器提供的可选 `homePath` 解析器。desktop host 把已解析的 Harness home 传给 boot 和环境层发现逻辑，base 组合显式把同一个解析器传给 settings provider、凭据 provider 和 shell 环境。默认行为仍是 `$DSH_HOME` 或 `~/.dsh`，因此 `npx @deepseek-ai/dsh web` 的行为不变。

desktop 使用 Electron 传入的实际安装锚点解析 profile（打包时是 `resources/app/package.json`，开发时是 `apps/desktop/package.json`）。它在 Loader 应用 patch 前复制初始 patch 列表。bare 插件解析以当前 Web profile manifest 为锚点：Node internal loader 可用时直接使用该 URL 解析，嵌入式运行时则从同一锚点按 ESM `import` 条件解析包入口，再执行导入。因此 profile-local 插件会选择与 Web 相同的条件导出，安装内置插件仍可通过修复后的 `profiles/node_modules` fallback 使用。`watchUserPatches` 在启动器暴露 Node loader internals 时使用 Cordis HMR，否则使用精确路径文件 watcher，因此 Electron 无需 `--expose-internals` 也能保持配置实时更新。profile 和 home patch watcher 都会重新读取完整层级，移除覆盖后恢复 bundle 默认值。

两个启动器都加载 `$DSH_HOME/profiles/web` 下的标准 `web` profile，包括其中的有序组合包列表、安装在 profile 内的依赖和 `cordis.patch.yml`。Electron 随后在 profile 与 home patch 层之后，把安装自有的 `dsh-desktop-app` 组合包作为运行时覆盖层应用。该覆盖层绝不会写入 Web profile manifest，因此插件管理只有一个目标，同时 Web 启动器不会收到桌面专用载体行。

## Consequences

Web 与 desktop 的配置中心在同一个 Harness home 下使用同一个 `settings.yaml`、`.credentials.yaml`、`.env`、会话根目录、存储根目录、shell 可见的 `DSH_HOME`、profile 组合包、安装在 profile 内的插件、profile patch 和 home patch。嵌入式 desktop host 可以使用自定义 home，并把所有持久化文件保持在该目录中，无需修改进程级环境变量。desktop 仍使用自己的 carrier 和 IPC 传输，但该覆盖层之下的共享插件组合与配置优先级保持一致。

## Verification

本变更由 app-boot home resolver 与 ESM 条件导出测试、加载真实 profile-local 插件、Web profile patch 和显式 home `.env` 的 desktop host 测试、源码组合与随附 preset 字节一致性测试、Host 库与 Web 前端构建、desktop 打包、依赖闭包校验，以及会请求全部已声明客户端组合包并加载条件导出 profile 插件的打包启动探针覆盖。

## Alternatives considered

不采用在 Electron 内修改 `DSH_HOME`，因为这会修改进程全局状态，使子进程行为依赖启动顺序。不采用独立的 `desktop` profile，因为每次插件安装和 profile-local patch 都需要重复写入，并可能偏离 `npx @deepseek-ai/dsh web`；也不把 desktop 组合包持久化到 Web profile，因为这会把 Electron 专用行发送给 Web 启动器。
