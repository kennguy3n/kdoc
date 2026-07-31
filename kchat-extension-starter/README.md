# KChat Extension Starter Kit

A standalone template for building KChat Desktop extensions. If you
have the KChat app installed, you can build, preview, and package
extensions without cloning any monorepo.

## Quick start

```bash
# 1. Prerequisites: Node 20+, Yarn 4+, KChat desktop app installed
node --version   # must be >= 20
yarn --version   # must be >= 4

# 2. Install dependencies (pulls @kchat/sdk, @kchat/cli from npm)
cd template
yarn install

# 3. Start the dev server (client only)
yarn dev
# → Vite dev server on http://localhost:5150

# 4. Build the server entry (host loads it from disk)
yarn build:server

# 5. In KChat: Settings → Developer → Extensions → Install from URL
#    Paste: http://localhost:5173/manifest.json
#    (or http://localhost:5150/manifest.json — check your Vite port)

# 6. See "My Extension" in the right sidebar. Click it → "Hello, KChat!"

# 7. Edit src/ui/pages/home.tsx, save, refresh — see your changes
```

## What's in here

```text
kchat-extension-starter/
├── template/          # the forkable extension project
│   ├── manifest.json  # extension identity, contributions, permissions
│   ├── package.json   # deps from npm (no monorepo needed)
│   ├── vite.config.ts # dual build: client SPA + server library
│   ├── src/
│   │   ├── main.tsx               # client bootstrap
│   │   ├── server/index.ts        # server activate/deactivate + echo command
│   │   ├── runtime/               # bridge handshake provider
│   │   └── ui/
│   │       ├── app.tsx            # router shell
│   │       ├── routes.tsx         # route table (one route: /home)
│   │       ├── pages/home.tsx     # "Hello, KChat!" — replace this
│   │       ├── pages/not-found.tsx
│   │       ├── components/primitives/  # Button, Badge, EmptyState, ErrorBoundary
│   │       ├── styles/globals.css
│   │       └── utils/cn.ts        # className merge helper
│   └── public/
├── docs/
│   ├── getting-started.md       # full dev loop, dev-link, refresh
│   ├── manifest-reference.md    # every manifest field explained
│   ├── sdk-api.md               # SDK namespaces and methods
│   ├── packaging.md             # build, sign, publish a .kcz
│   └── dev-workflow.md          # dev path vs dev URL vs .kcz install
├── README.md                    # this file
└── LICENSE
```

## Next steps

- **Build your UI** — edit `src/ui/pages/home.tsx`, add routes in
  `src/ui/routes.tsx`, add views/paths in `manifest.json`.
- **Add server commands** — edit `src/server/index.ts`, register
  commands in `manifest.json#contributes.commands`.
- **Package for distribution** — read `docs/packaging.md` to build a
  signed `.kcz` and publish an update feed.
- **Understand the SDK** — read `docs/sdk-api.md` for the full
  client and server API surface.

## Key conventions

- **Asset URLs stay relative.** The host serves them via
  `kchat-extension://` — absolute paths break.
- **Route with `HashRouter`.** Never call `history.pushState` against
  the host's path.
- **Bundle the SDK.** Import from `@kchat/sdk/client` and
  `@kchat/sdk/server` — Vite inlines it, do not rely on host globals.
- **No cross-extension calls.** Extensions are sandboxed.
- **State is not persisted across restarts.** Treat every cold start
  as a fresh mount.

## License

MIT — see `LICENSE`.
