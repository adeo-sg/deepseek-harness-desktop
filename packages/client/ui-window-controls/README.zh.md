# @deepseek-ai/dsh-client-ui-window-controls

[English](README.md) | 中文

无边框 Electron 外壳的自绘窗口控件：完全用 HTML 与 CSS 绘制的最小化 / 最大化-还原 / 关闭按钮簇（内联 SVG 字形，不依赖任何图标或窗口库）。两处注册共同安排唯一的可交互按钮簇。`shell.overlay` 占位者在新建会话 hero、会话页头和详情面板等状态下都把按钮簇钉在窗口右上角。`conversation.session.header.utilities` 占位者只在 Session-log 工具之后保留对应平台所需的宽度，不再挂载另一组按钮。因此详情列宽度不会移动窗口控件，页头工具也不会进入 overlay 区域。详情页头读取 overlay 提供的 `--dsh-window-controls-details-right` 留白，使自己的关闭操作同样避开窗口控件。

平台尺寸明确区分：Windows 使用 45x32px、贴合右上边缘的命中区与 12px 字形；Linux 使用 34px 的 GNOME 风格控件、16px 符号字形、3px 组间距、顶部 6px 与右侧 7px 留白；macOS 使用 28px 紧凑控件、12px 字形以及顶部和右侧 12px 留白；未知宿主使用 12px 字形和 8px 留白。右侧定位属于产品自身约定；原生 macOS traffic lights 与缩放语义不属于这个以 Windows 为先的 UI。

按钮簇是 preload 的 `windowControls` 表面（`window.desktopBridge.windowControls`，权威 `DesktopBridge` 在 `dsh-client-connection` 中的可选成员）之上的纯展示。一次性动作走即发即弃的 send；初始切换字形由 `isMaximized()` 查询播种，并由 `onMaximizedChanged` 订阅持续更新，因此键盘吸附或双击拖拽区翻转字形时不会渲染出陈旧状态。表面缺失时——web 组合、fixture 模式或意外的名单——组件什么都不渲染。

外壳本身无边框（`frame: false`）且没有应用程序菜单。会话页头的标题行就是窗口拖拽区（`-webkit-app-region: drag`，在 web 上无效果），按钮簇重新回到指针事件；overlay 条带自带拖拽区。双击任一拖拽区都会原生最大化与还原。本包只随 `dsh-desktop-app` bundle 补丁发布，因此 web 组合永远不会加载它。[无边框窗口 chrome Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-desktop-frameless-window-chrome.md) 持有该契约的主进程侧（通道、preload、拖拽区）。

## 模型体验

无，因为按钮簇只是人类使用的窗口 chrome：不发任何 RPC，不新增会话事件，不触及 prompt、消息、schema、流或工具结果。模型对窗口的认知仍属于桌面表面 prompt 段。

#### KV Cache effect

无；本包从不组装或发送 provider 请求。

## 已知限制与暂缓事项

- **以 Windows 为先的外框** —— 无边框窗口使用 `frame: false` 与 Electron 内置的边缘缩放，这在 Windows 与 Linux 上可用；macOS 无边框窗口需要自己的边缘缩放处理，随 macOS 构建一并推迟。
- **没有 Windows 11 吸附布局浮层** —— 承载该浮层的原生最大化按钮随标题栏一起消失；吸附仍可通过拖到顶部、Win+方向键与自定义最大化按钮完成。
- **拖拽区跟随页头** —— 只有会话页头行与 overlay 条带可拖拽；侧栏、详情列与 hero 主体不可（页头行内的按钮与按钮簇通过 `no-drag` 保持可点击）。
