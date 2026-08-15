# Agent Note: Electron desktop preview

Status: implemented

English | [中文](2026-08-15-electron-desktop-preview.zh.md)

## Problem

The GUI protocol architecture reserves Electron as a client, but users could evaluate only the browser application. A complete `file://` and IPC implementation also requires new connection-provider selection, cancellable dual-stream IPC, server-independent client-module inventory, bundle execution, download behavior, and renderer-loss cleanup. Building those mechanisms before any desktop workflow had a consumer would delay feedback and widen the first change across the shared GUI stack.

## Decision

`@deepseek-ai/dsh-desktop` under `apps/desktop` is a desktop preview application, not a new capability package. In source mode, its Node launcher starts Electron and passes the same Node executable into the main process; in packaged mode, the main process uses the Node runtime and `@deepseek-ai/dsh` CLI under the application resources directory. Both forms supervise that CLI as a child, start the exact Web profile with `--host 127.0.0.1 --port 0`, wait for its Loader-settled URL line, and load that origin in a hardened `BrowserWindow`. Keeping one Node executable for each Harness process tree preserves the native-module ABI. This design also preserves the [GUI layering and RPC protocol](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md): the preview makes no Agent, Session, API, Client-plugin, or Web-composition fork.

The Electron main process owns one isolated Harness process tree and one application window lifecycle. It uses a branded loading page while the Host starts, rejects navigation away from the assigned loopback origin, opens ordinary external links in the system browser, and reports startup and unexpected-exit diagnostics. POSIX shutdown applies a bounded SIGTERM-to-SIGKILL ladder to the complete process group and waits for group exit; Windows uses `taskkill /T /F`. The source-mode Node launcher has its own bounded Electron signal ladder. The invocation directory remains the source-mode default Harness working directory, a Finder-launched package defaults to the user's home directory, and `DSH_DESKTOP_CWD` and `DSH_DESKTOP_STARTUP_TIMEOUT_MS` expose the two deployment-varying launch values.

The dedicated IPC carrier remains unimplemented. The preview's local socket is an explicit delivery tradeoff, not a second desktop protocol: a future port-free distribution can replace this application-owned carriage after the renderer connection provider and client-module inventory have transport-independent providers. Until that need exists, Web remains the single assembled GUI behavior. The [unsigned macOS distribution](2026-08-15-unsigned-macos-desktop-distribution.md) packages this application and its existing CLI sidecar without changing that carrier decision.

## Testing

Unit coverage spawns real child processes to pin split-line readiness, loopback URL validation, configurable workspace and timeout resolution, diagnostics on timeout, unexpected post-readiness exit, whole-tree cleanup when a grandchild ignores SIGTERM, and bounded launcher escalation when Electron ignores its first signal. The keyless `desktop:smoke` entry starts the built Electron application against an isolated Harness home, waits for the complete Web profile and Client-plugin frame, reads the live renderer security preferences, checks viewport overflow, captures a screenshot, closes Electron, and verifies that its loopback URL stops responding.

## Alternatives considered

**Implement IPC in the first desktop version.** The lower protocol supports it, but the production connection plugin, dual event streams, generic Remote channels, module manifest, bundle delivery, HMR, downloads, and renderer teardown still select Web-specific carriers. Introducing every provider point at once would make the desktop experiment responsible for shared GUI architecture before the product workflow was validated.

**Run the Cordis tree inside Electron's main process.** The CLI already owns layered environment loading, profile healing, process signals, fail-loud behavior, and bounded shutdown. Reimplementing those obligations in the window process would couple renderer failures and runtime failures and duplicate the launcher contract.

**Connect to a fixed port or an independently started server.** A fixed port creates collision and stale-server ambiguity; requiring a separate server loses single-application ownership. Port zero plus readiness parsing gives each application instance one identifiable child and origin.

**Use Tauri with a Node sidecar.** It keeps the same sidecar and lifecycle obligations while adding a Rust application layer. Electron already supplies the Node-compatible process and Web runtime this preview needs.

## Consequences

**Bought:** users can run the full Harness GUI as a desktop window with no duplicated core or UI code; the app follows `master` by consuming the ordinary CLI and Web profile; startup, crash, navigation, single-instance, and shutdown ownership are explicit; an OS-assigned port avoids collisions.

**Paid:** the preview still opens a loopback HTTP/WebSocket listener and inherits the Web carrier's lack of local-process authentication. Source mode downloads Electron on first launch; the macOS DMG is unsigned and unnotarized. Neither form has auto-update, native Electron providers, or runtime restart. Windows tree cleanup relies on a successful `taskkill` while the CLI root still exists; failure is reported because the preview has no Job Object that can prove cleanup after an abrupt root exit. These limits remain visible in the application README.
