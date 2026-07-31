import {readFile} from 'node:fs/promises'
import {fileURLToPath, URL} from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {defineConfig, type LibraryFormats, type Plugin} from 'vite'

const isServerBuild = process.env.KCHAT_EXTENSION_BUILD === 'server'

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

export default defineConfig(() => {
  if (isServerBuild) {
    return {
      build: {
        outDir: 'dist/server',
        emptyOutDir: true,
        target: 'node22',
        sourcemap: false,
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
          '@kchat/sdk/server': fileURLToPath(new URL('./src/shims/kchat-sdk-server.ts', import.meta.url)),
        },
      },
    }
  }

  return {
    base: './',
    plugins: [react(), tailwindcss(), kchatExtensionManifestPlugin()],
    server: {
      port: 5151,
      strictPort: false,
    },
    preview: {
      port: 5151,
      strictPort: false,
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@kchat/sdk/client': fileURLToPath(new URL('./src/shims/kchat-sdk-client.ts', import.meta.url)),
      },
    },
  }
})
