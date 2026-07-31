# Getting Started

This guide walks you through setting up the development environment,
linking your extension into the KChat app, and making your first edit.

## Prerequisites

| Tool | Version | How to check |
| --- | --- | --- |
| Node.js | 20+ | `node --version` |
| Yarn | 4+ | `yarn --version` |
| KChat desktop app | latest | open the app |

## Install dependencies

```bash
cd template
yarn install
```

This pulls `@kchat/sdk`, `@kchat/cli`, and `@kchat/standards` from the
public npm registry. You do not need to clone any monorepo.

## Start the dev server

The extension has two build targets: a **client** (React SPA served by
Vite) and a **server** (Node module loaded from disk by the host).

```bash
# Terminal 1: client dev server (HMR)
yarn dev
# → http://localhost:5150

# Terminal 2: server build (watch mode)
yarn dev:server
# → recompiles dist/server/index.js on every change
```

## Link into KChat

Open **Settings → Developer → Extensions** in the KChat app and pick
one mode:

### Dev URL (recommended for client iteration)

1. Click **Install from URL**.
2. Paste `http://localhost:5150/manifest.json`.
3. The host fetches the manifest, expands the `${MANIFEST_DIR}`
   placeholder to the dev server's path, and registers the extension.
4. Client assets load from Vite (HMR works). Server entry loads from
   `dist/server/` on disk.

### Dev path (for offline / packaged testing)

1. Click **Install from Folder**.
2. Select the `template/` directory.
3. Requires a prior `yarn build` — the host serves `dist/` through
   `kchat-extension://`, it does not run Vite.

### Install from .kcz (for release testing)

1. Run `yarn package` to produce `artifacts/<id>-<version>.kcz`.
2. Click **Install from .kcz** and pick the archive.

## The iteration loop

| What you change | What to do | How to see it |
| --- | --- | --- |
| Client code (`src/ui/**`) | Save | Vite HMR — instant |
| Server code (`src/server/**`) | `yarn dev:server` (watch) or `yarn build:server` | **Refresh Extension** in Settings |
| `manifest.json` | Reinstall the dev-link | Host re-fetches manifest |

## Verify the echo command

The template ships with one server command: `your-extension.echo`.
You can invoke it from the client:

```ts
const reply = await client.commands.invoke<{reply: string}>(
  'your-extension.echo',
  {message: 'hello'},
)
console.log(reply.reply) // "hello"
```

If you declared `permissions.mcp: ["expose"]` in the manifest, the
command also appears as an MCP tool that paired AI clients can call.
See `docs/sdk-api.md` for the full MCP exposure flow.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank screen in the webview | Asset URLs are absolute | Use relative paths (`./assets/...`) |
| `INVALID_BOOTSTRAP` error | Loaded outside the host | The extension must run inside KChat's webview, not a browser |
| Server command not found | Server not built | Run `yarn build:server` then **Refresh Extension** |
| Manifest changes not picked up | Dev-link cached | Remove the dev-link and reinstall |
| Port 5150 busy | Another Vite instance | Vite auto-increments; check the printed URL |
