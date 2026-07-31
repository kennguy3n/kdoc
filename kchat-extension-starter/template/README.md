# My KChat Extension

A KChat Desktop extension built from the starter template.

## Quick start

```bash
yarn install
yarn dev              # client dev server (HMR)
yarn dev:server       # server watch build (separate terminal)
```

In KChat: **Settings → Developer → Extensions → Install from URL**
→ `http://localhost:5150/manifest.json`

## Build

```bash
yarn build            # client + server → dist/
yarn package          # build + pack → artifacts/*.kcz
```

## Project layout

```text
├── manifest.json          # identity, contributions, permissions
├── package.json           # deps from npm (no monorepo)
├── vite.config.ts         # dual build: client SPA + server library
├── src/
│   ├── main.tsx           # client bootstrap
│   ├── server/index.ts    # server activate/deactivate + echo command
│   ├── runtime/           # bridge handshake provider
│   └── ui/
│       ├── app.tsx        # router shell
│       ├── routes.tsx     # route table
│       ├── pages/         # home page + not-found
│       ├── components/    # Button, Badge, EmptyState, ErrorBoundary
│       ├── styles/        # globals.css
│       └── utils/         # cn (className merge)
└── public/
```

## Docs

- `../docs/getting-started.md` — full dev loop
- `../docs/manifest-reference.md` — every manifest field
- `../docs/sdk-api.md` — SDK namespaces and methods
- `../docs/packaging.md` — build, sign, publish
- `../docs/dev-workflow.md` — dev modes, deeplinks, diagnostics

## Scripts

```bash
yarn dev               # Vite dev server (client only)
yarn dev:server        # server build in watch mode
yarn build             # client + server production build
yarn lint              # eslint
yarn format            # eslint --fix + prettier --write
yarn package           # build + kc extension:package → artifacts/*.kcz
yarn package -- --sign --key <pem> --key-id <id> --publisher <vendor>
```
