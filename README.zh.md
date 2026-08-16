# DSH Desktop

[English](README.md) | 中文

<p align="center"><img src="apps/desktop/assets/icon.png" alt="DSH Desktop 图标" width="160"></p>

DSH Desktop 是一个独立维护的跨平台桌面应用，基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 源代码开发。它在经过安全加固的 Electron 窗口中运行上游 `dsh web` profile。发布流程可为 Apple 芯片 macOS 和 Windows x64 构建包含完整运行环境的未签名安装包；源码模式支持 macOS、Linux 和 Windows。

本仓库不是 DeepSeek 官方发行版。源代码保留 DeepSeek Harness 产品名称、`@deepseek-ai` 包命名空间与现有版权声明，用于标明上游来源并保持兼容性。

## 开发者预览

DSH Desktop 目前处于开发者预览阶段，可能发生破坏兼容性的变更。安装包支持 Apple 芯片 macOS 和 Windows x64；源码模式支持 macOS、Linux 和 Windows。

## 运行

### 构建 macOS DMG

请安装 Node.js `^22.19.0` 或 `>=24.0.0` 以及 Corepack，然后运行：

```sh
git clone https://github.com/tangf-ai/dsh-desktop.git
cd dsh-desktop
corepack enable
pnpm install
pnpm desktop:dmg
```

该命令生成 `apps/desktop/release/DeepSeek-Harness-<version>-arm64.dmg`。应用包含 Node 运行时和生产依赖，因此安装后无需 Node、pnpm 或仓库检出即可运行。安装与验证细节见[桌面应用参考](apps/desktop/README.md)。

### 构建 Windows 安装包

在 Windows x64 上完成相同的仓库检出和依赖安装后，运行：

```powershell
pnpm desktop:exe
```

该命令生成 `apps/desktop/release/DeepSeek-Harness-Setup-<version>-x64.exe`。安装包包含 Windows Electron 应用、Node 运行时和生产依赖。

### 从源码运行

安装依赖后，请在 macOS、Linux 或 Windows 上构建仓库并启动桌面应用：

```sh
pnpm run build
pnpm desktop
```

桌面应用与 `dsh web` 使用相同的本地 Harness profile、会话数据、工具和 Web UI。

## 与 DeepSeek Harness 的关系

本仓库保留完整的 DeepSeek Harness monorepo 和 Git 历史，因为 `apps/desktop` 直接使用其中的 workspace 包。桌面应用专属源码位于 [`apps/desktop`](apps/desktop/README.md)；相关集成改动让现有 CLI、Web profile、构建、文档与运行时依赖图保持一致。

DeepSeek Harness 提供 agent harness（智能体框架）、CLI（命令行界面）、Web UI、插件架构与 `@deepseek-ai` 包。DSH Desktop 增加跨平台 Electron 进程管理、应用资源、原生安装包组装和已打包应用验证，不分叉 Harness 运行时或 Web 组合。

## 安全与限制

macOS 镜像没有 Developer ID 证书签名，也未经过公证，因此 Gatekeeper 可能要求按住 Control 点击已安装应用并选择“打开”。Windows 安装包没有 Authenticode 签名，因此 Microsoft Defender SmartScreen 可能要求明确允许。当前应用使用操作系统分配的回环 HTTP/WebSocket 端口，不包含自动更新或崩溃报告服务。仓库不发布 Intel macOS、Windows arm64 或 Linux 安装包。[桌面应用参考](apps/desktop/README.md)说明 renderer 安全设置与进程生命周期。

## 社区与支持

- 请通过本仓库的 [GitHub Issues](https://github.com/tangf-ai/dsh-desktop/issues) 报告 DSH Desktop bug 或提交功能需求。
- 与底层 Harness 项目有关的问题，请使用上游 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

本仓库采用 [MIT 许可证](LICENSE)。DeepSeek Harness 原始代码保留 DeepSeek 版权声明，DSH Desktop 修改内容采用相同许可证发布。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
