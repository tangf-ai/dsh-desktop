# Agent Note: Electron 桌面预览版

Status: implemented

[English](2026-08-15-electron-desktop-preview.md) | 中文

## Problem

GUI 协议架构为 Electron client 预留了位置，但用户只能体验浏览器应用。完整的 `file://` 与 IPC 实现还需要新增 connection provider 选择、可取消的双流 IPC、独立于服务器的 client module 清单、bundle 执行、下载行为与 renderer 丢失后的清理。在任何桌面工作流拥有消费方之前先构建这些机制，会推迟反馈，并让首个改动扩散到共享 GUI 栈。

## Decision

`apps/desktop` 下的 `@deepseek-ai/dsh-desktop` 是桌面预览应用，不是新的能力包。源码模式下，Node 启动器运行 Electron，并把同一个 Node 可执行文件传入主进程；打包模式下，主进程使用应用资源目录内的 Node 运行时与 `@deepseek-ai/dsh` CLI。两种形式都会将该 CLI 作为子进程监督，以 `--host 127.0.0.1 --port 0` 启动完整 Web profile，等待 Loader 停稳后的 URL 行，再用加固的 `BrowserWindow` 加载该 origin。每棵 Harness 进程树使用同一个 Node 可执行文件，可保持原生模块 ABI。该设计也保留 [GUI 分层与 RPC 协议](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md)：预览版不分叉 Agent、Session、API、Client 插件或 Web 组合。

Electron 主进程拥有一棵隔离的 Harness 进程树和一个应用窗口的生命周期。Host 启动期间显示品牌加载页；顶层导航不得离开分配到的回环 origin；普通外部链接在系统浏览器中打开；启动与意外退出诊断会明确呈现。POSIX 关闭流程对整个进程组执行有界的 SIGTERM 至 SIGKILL 阶梯并等待进程组退出；Windows 使用 `taskkill /T /F`。源码模式的 Node 启动器还拥有独立且有界的 Electron 信号阶梯。源码模式默认以调用目录作为 Harness 工作目录，从 Finder 启动的打包应用默认使用用户 home，`DSH_DESKTOP_CWD` 与 `DSH_DESKTOP_STARTUP_TIMEOUT_MS` 则暴露两项随部署变化的启动值。

专用 IPC 载体仍未实现。预览版使用本地 socket 是明确的交付取舍，而不是第二套桌面协议：当 renderer connection provider 与 client module 清单具备独立于传输的 provider 后，未来的无端口发行版可以替换这一应用自有载体。在真实需求出现前，Web 仍是唯一组装后的 GUI 行为。[未签名 macOS 发行版](2026-08-15-unsigned-macos-desktop-distribution.md)和[未签名 Windows 发行版](2026-08-15-unsigned-windows-desktop-distribution.md)会打包该应用及其现有 CLI sidecar，而不改变载体决策。

## Testing

单元覆盖会启动真实子进程，钉住分段就绪行、回环 URL 校验、可配置工作目录与时限解析、超时诊断、就绪后的意外退出、孙进程忽略 SIGTERM 时的整树清理，以及 Electron 忽略首个信号时有界的启动器升级。无 API Key 的 `desktop:smoke` 入口会用隔离的 Harness home 启动已构建 Electron 应用，等待完整 Web profile 与 Client 插件 frame，读取 renderer 的实际安全参数，检查 viewport 溢出，捕获截图，关闭 Electron，并确认其回环 URL 已停止响应。

## Alternatives considered

**在首个桌面版本中实现 IPC。** 底层协议支持这种实现，但生产 connection 插件、双事件流、通用 Remote channel、module manifest、bundle 投递、HMR、下载与 renderer 拆除仍选择 Web 专用载体。一次性引入所有 provider 点，会让桌面实验在产品工作流得到验证之前先负责共享 GUI 架构。

**在 Electron 主进程中运行 Cordis 树。** CLI 已经拥有分层环境加载、profile 修复、进程信号、fail-loud 行为与有界关闭。在窗口进程中重新实现这些义务，会耦合 renderer 与运行时故障，并复制启动器约定。

**连接固定端口或独立启动的服务器。** 固定端口会产生冲突与陈旧服务器歧义；要求单独启动服务器则失去单应用所有权。端口零配合就绪行解析，让每个应用实例只拥有一个可识别的子进程与 origin。

**使用带 Node sidecar 的 Tauri。** 它保留相同的 sidecar 与生命周期义务，同时增加 Rust 应用层。Electron 已经提供该预览版所需的 Node 兼容进程与 Web 运行时。

## Consequences

**收益：**用户可以在桌面窗口中运行完整 Harness GUI，不复制核心或 UI 代码；应用通过消费普通 CLI 与 Web profile 跟随 `master`；启动、崩溃、导航、单实例与关闭所有权明确；操作系统分配端口可避免冲突。

**代价：**预览版仍打开回环 HTTP／WebSocket 监听，并继承 Web 载体缺少本地进程认证的限制。源码模式首次启动时需要下载 Electron；macOS DMG 未签名且未公证，Windows 安装包没有 Authenticode 签名。所有形式都没有自动更新、Electron 原生 provider 或运行时重启。Windows 进程树清理依赖 CLI 根进程仍存在时成功执行 `taskkill`；预览版没有可在根进程突然退出后证明清理完成的 Job Object，因此失败会明确报出。这些限制保留在应用 README 中。
