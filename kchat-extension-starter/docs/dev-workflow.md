# Dev Workflow

How to iterate on your extension during development.

## Three loading modes

Open **Settings → Developer → Extensions** in the KChat app:

| Mode | When to use | How |
| --- | --- | --- |
| **Dev URL** | Active client development (HMR) | Paste `http://localhost:5150/manifest.json` |
| **Dev path** | Offline / packaged testing | Select the `template/` folder (requires `yarn build`) |
| **Install .kcz** | Release testing | Pick the archive from `yarn package` |

## Dev URL workflow (recommended)

```bash
# Terminal 1: client dev server
yarn dev
# → Vite on http://localhost:5150 with HMR

# Terminal 2: server watch build
yarn dev:server
# → recompiles dist/server/index.js on every save
```

In KChat: **Install from URL** → `http://localhost:5150/manifest.json`

- **Client changes** (React, CSS, routes): save → Vite HMR → instant
- **Server changes** (commands, handlers): `yarn dev:server` auto-
  rebuilds → click **Refresh Extension** in Settings
- **Manifest changes**: remove the dev-link and reinstall (the host
  re-fetches the manifest)

## Dev path workflow

```bash
yarn build
# → dist/client/ + dist/server/
```

In KChat: **Install from Folder** → select `template/`

- The host serves `dist/` through `kchat-extension://` — it does not
  run Vite.
- After each rebuild, click **Refresh Extension** to reload.

## Deeplinks

Paths with `deeplink: true` in the manifest are reachable via the
OS-level `kchat://` protocol:

```text
kchat://ext/<extensionId>/<pathId>?<query>
```

Example:

```bash
# macOS
open "kchat://ext/your-vendor.your-extension/home?draft=hello"

# Linux
xdg-open "kchat://ext/your-vendor.your-extension/home?draft=hello"

# Windows (PowerShell)
Start-Process "kchat://ext/your-vendor.your-extension/home?draft=hello"
```

Or build a URL from extension code:

```ts
const url = client.deeplinks.buildUrl('home', { draft: 'hello' })
```

For testing without leaving KChat: **Settings → Developer →
Extensions → Diagnostics → Deeplinks** lets you paste a URL and
dispatch it through the same pipeline.

## Diagnostics

**Settings → Developer → Extensions → Diagnostics** provides:

- **Extension log** — structured diagnostic stream from the host and
  the extension server.
- **Deeplinks** — paste-and-dispatch test surface.
- **Command invocations** — ring buffer of recent command calls.

## Lifecycle

| Action | What happens |
| --- | --- |
| Install | Host validates manifest, extracts to install root, starts server if `onAppReady` |
| Enable | Server `activate(context)` fires; views render |
| Disable | Server `deactivate(reason)` fires; views unmount |
| Uninstall | Install root removed; trust grants revoked |
| Refresh | Server `deactivate` → re-extract → `activate` (dev-link only) |

## Tips

- **Keep the dev-link installed** — you don't need to reinstall after
  every client edit. HMR handles it.
- **Use `yarn dev:server` (watch mode)** so server rebuilds are
  automatic. You still need to click **Refresh Extension** to reload
  the server in the host.
- **Check the diagnostics stream** if something doesn't work — the
  host logs capability denials, manifest validation errors, and
  server activation failures there.
- **Don't persist state across restarts** — the host does not restore
  active surfaces. Treat every cold start as a fresh mount.
