# Agent Note: Unsigned Windows desktop distribution

Status: implemented

English | [中文](2026-08-15-unsigned-windows-desktop-distribution.zh.md)

## Problem

The [Electron desktop preview](2026-08-15-electron-desktop-preview.md) runs from source on Windows, but a distributable application cannot depend on a repository checkout, the user's Node installation, or workspace links. Windows also needs an installer built from Windows Electron files and native dependencies, plus executable verification on the same operating system. A cross-compiled artifact would not prove that the bundled CLI starts, the renderer loads, or `taskkill` closes the packaged process tree.

## Decision

`pnpm desktop:exe` builds the repository on Windows x64 and produces `apps/desktop/release/DeepSeek-Harness-Setup-<version>-x64.exe`. The assisted per-user NSIS installer creates Start menu and desktop shortcuts and permits a custom installation directory. It contains a Windows Electron application, a Windows x64 `node.exe`, and the same production-only `@deepseek-ai/dsh` dependency closure as the parallel [unsigned macOS distribution](2026-08-15-unsigned-macos-desktop-distribution.md). The packaged main process selects `runtime/bin/node.exe` on Windows.

The shared packaging module validates the native Node version, runs the deployed CLI, materializes the two workspace override packages inside the bundle, probes package-level entries under `node_modules` for Windows junction targets before copying them (including junctions that `lstat` reports as non-directories), removes unsupported Landlock links, and rejects every remaining dependency link that escapes the runtime. Electron Builder creates both the unpacked application used for verification and the NSIS installer. Neither the application executable nor the installer carries an Authenticode signature.

The `Desktop Windows distribution` workflow builds on a native `windows-2025` runner for `main`, relevant pull requests, manual runs, and release tags. A release tag must equal `v` plus the desktop package version. After unit tests, native package assembly, and packaged smoke pass, a tag run creates a draft GitHub Release containing the Windows installer. Public release remains a separate reviewed action after the macOS artifact and release notes are present.

## Verification

`desktop:smoke:win` runs the bundled CLI with the copied `node.exe`, rejects an unexpected Authenticode signature on the application or installer, and launches the unpacked packaged executable with an isolated Harness home. It verifies packaged mode, application identity, resource location, loopback navigation, context isolation, renderer sandboxing, disabled Node integration, and Web security, then captures a screenshot. Closing Electron must stop the Harness process tree and make the assigned URL unreachable.

## Alternatives considered

**Cross-build the installer on macOS.** Electron Builder can assemble some Windows targets from another host, but the product ships a native Node sidecar and native npm dependencies. A foreign-host build cannot execute those bytes or exercise Windows tree cleanup, so it cannot provide the required release evidence.

**Publish a portable ZIP instead of an installer.** A ZIP avoids NSIS but gives up installation-directory selection, Start menu integration, desktop shortcuts, and ordinary uninstall behavior. The assisted per-user installer supplies those expected Windows workflows without requiring administrator installation.

**Require Authenticode signing for the preview.** A signed public channel requires release-owned certificate or Trusted Signing credentials, timestamping, publisher continuity, and protected secret handling. The preview states the missing signature and verifies its absence rather than implying an identity it does not own.

## Consequences

**Bought:** Windows x64 users can install and launch the desktop preview without development tools; the packaged CLI uses a native validated Node and self-contained dependencies; a real Windows runner verifies the same application bytes placed in the installer; GitHub receives only an artifact whose unit, package, and lifecycle checks passed.

**Paid:** the installer is large, supports only Windows x64, and may trigger Microsoft Defender SmartScreen because it has no recognized publisher. The package has no auto-update or crash reporting. Process-tree cleanup still depends on `taskkill` while the CLI root exists; a future Job Object owner remains the stronger abrupt-exit design.
