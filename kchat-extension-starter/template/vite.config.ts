import {readFile} from 'node:fs/promises'
import {fileURLToPath, URL} from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {defineConfig, type LibraryFormats, type Plugin} from 'vite'

const isServerBuild = process.env.KCHAT_EXTENSION_BUILD === 'server'

/**
 * Serve `manifest.json` over the dev server with the `${MANIFEST_DIR}`
 * placeholder expanded to the project's absolute path. The KChat host
 * fetches this URL when the user registers the extension as a URL
 * dev-link; the expanded path becomes `dev.sourceRoot` so the server
 * harness anchors at the same folder Vite is serving from. Keeps the
 * committed manifest portable across machines (no hard-coded paths)
 * while letting URL dev-link mode run the full client + server.
 */
function kchatExtensionManifestPlugin(): Plugin {
  const manifestPath = fileURLToPath(
    new URL('./manifest.json', import.meta.url),
  )
  const manifestDir = fileURLToPath(new URL('./', import.meta.url)).replace(
    /\/$/,
    '',
  )
  return {
    name: 'kchat-extension:manifest',
    configureServer(server) {
      server.middlewares.use('/manifest.json', async (_req, res, next) => {
        try {
          const raw = await readFile(manifestPath, 'utf-8')
          const expanded = raw.split('${MANIFEST_DIR}').join(manifestDir)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(expanded)
        } catch (error) {
          next(error)
        }
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use('/manifest.json', async (_req, res, next) => {
        try {
          const raw = await readFile(manifestPath, 'utf-8')
          const expanded = raw.split('${MANIFEST_DIR}').join(manifestDir)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(expanded)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

/**
 * The sample extension ships both a client (Vite SPA) and a server
 * (Node module). The two outputs share `src/` but use different Vite
 * build configurations selected via the `KCHAT_EXTENSION_BUILD` env var:
 *
 *   yarn build              -> client, output dist/client
 *   KCHAT_EXTENSION_BUILD=server yarn build -> server, output dist/server
 *
 * `pack.js` runs both in sequence and archives `manifest.json` plus the
 * `dist/` directory; manifest entries reference the built artifacts via
 * the `dist/client/index.html` and `dist/server/index.js` paths so the
 * same layout works for `dev-path` registration and installed `.kcz`
 * extraction.
 */
export default defineConfig(() => {
  if (isServerBuild) {
    return {
      build: {
        outDir: 'dist/server',
        emptyOutDir: true,
        target: 'node22',
        sourcemap: false,
        // Single-entry library build. The harness imports
        // `dist/server/index.js`. Add more entries here if you
        // introduce workers or child processes.
        lib: {
          entry: {
            index: fileURLToPath(
              new URL('./src/server/index.ts', import.meta.url),
            ),
          },
          formats: ['es'] satisfies LibraryFormats[],
          fileName: (_format, entryName) => `${entryName}.js`,
        },
        rollupOptions: {
          external: (id) => id.startsWith('node:'),
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            format: 'es',
            preserveModules: false,
          },
        },
      },
      resolve: {
        alias: {
          '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
      },
    }
  }

  return {
    // Relative base so the built `index.html` references assets as
    // `./assets/...` instead of `/assets/...`. The packaged extension
    // is served through the `kchat-extension://<id>/<versionToken>/...`
    // protocol where the version token is the first path segment;
    // emitting absolute paths would shift every asset request up to
    // `kchat-extension://<id>/assets/...`, making the asset protocol
    // treat `assets` as the token and serve `404 asset-root-not-found`
    // for every JS/CSS/font request (the .kcz "blank screen" bug).
    // Vite's dev server still resolves `./` paths correctly when the
    // host loads the dev-link entry via `http://localhost:5150/`.
    base: './',
    plugins: [react(), tailwindcss(), kchatExtensionManifestPlugin()],
    // Reserved dev/preview port for the sample extension. Lives at
    // `5150` — well outside the KChat MCP server window (`5200-5209`,
    // see `src/desktop/runtime/ports/mcp/server/host/mcp-transport.ts`)
    // and clear of Vite's own default `5173`, so engineers can run the
    // host app and the extension dev server side-by-side without ever
    // racing for sockets. Vite still walks forward to the next free
    // port if `5150` itself is busy.
    server: {
      port: 5150,
      strictPort: false,
    },
    preview: {
      port: 5150,
      strictPort: false,
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
