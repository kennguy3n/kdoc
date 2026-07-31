/**
 * Extension Client Provider
 *
 * Wraps `bootstrap()` from `@kchat/sdk/client` and exposes the resolved
 * `ExtensionClient` to the rest of the extension UI via React context.
 *
 * Why a module-level singleton promise:
 *   `bootstrap()` consumes `window.__KCHAT_EXTENSION_BOOTSTRAP__` exactly
 *   once and deletes the global afterwards. Under React StrictMode the
 *   provider mounts twice in development, so we cache the promise at
 *   module scope to ensure a single bridge handshake per document.
 *
 * Failure modes:
 *   - When loaded outside the host (e.g. `vite dev`), the host bootstrap
 *     payload is missing and `bootstrap()` rejects with
 *     `INVALID_BOOTSTRAP`. The provider surfaces the error through the
 *     context so the UI can render a clear fallback instead of a blank
 *     screen.
 */

import {
  applyDefaultTheme,
  bootstrap,
  type ExtensionClient,
  isExtensionRuntimeError,
  subscribeThemeChange,
} from '@kchat/sdk/client'
import {
  createContext,
  memo,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'

export type ExtensionClientStatus = 'connecting' | 'ready' | 'failed'

export interface ExtensionClientContextValue {
  status: ExtensionClientStatus
  /** Available only when `status === 'ready'`. */
  client: ExtensionClient | null
  /** Populated only when `status === 'failed'`. */
  error: {code: string; message: string} | null
  /**
   * Current host theme mode. Mirrors `client.client.themeMode` after
   * `status === 'ready'`, but stays in sync with later
   * `kchat:themechange` events so consumers can react without a
   * second subscription.
   */
  themeMode: 'light' | 'dark'
}

const INITIAL_VALUE: ExtensionClientContextValue = {
  status: 'connecting',
  client: null,
  error: null,
  themeMode: 'light',
}

const ExtensionClientContext =
  createContext<ExtensionClientContextValue>(INITIAL_VALUE)

let bootstrapPromise: Promise<ExtensionClient> | null = null

function getBootstrapPromise(): Promise<ExtensionClient> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap()
  }
  return bootstrapPromise
}

export interface ExtensionClientProviderProps {
  children: ReactNode
}

export const ExtensionClientProvider = memo(function ExtensionClientProvider({
  children,
}: ExtensionClientProviderProps): ReactElement {
  const [value, setValue] = useState<ExtensionClientContextValue>(INITIAL_VALUE)

  useEffect(() => {
    let cancelled = false
    let unsubscribeThemeChange: (() => void) | null = null

    getBootstrapPromise()
      .then((client) => {
        if (cancelled) {
          return
        }
        const initialThemeMode = client.client.themeMode
        applyDefaultTheme(initialThemeMode)
        setValue({
          status: 'ready',
          client,
          error: null,
          themeMode: initialThemeMode,
        })
        unsubscribeThemeChange = subscribeThemeChange((themeMode) => {
          applyDefaultTheme(themeMode)
          setValue((previous) => ({...previous, themeMode}))
        })
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return
        }
        const error = isExtensionRuntimeError(reason)
          ? {code: reason.code, message: reason.message}
          : {
              code: 'RUNTIME_BRIDGE_DISCONNECTED',
              message:
                reason instanceof Error ? reason.message : String(reason),
            }
        setValue((previous) => ({
          ...previous,
          status: 'failed',
          client: null,
          error,
        }))
      })

    // We intentionally do not dispose `client.subscriptions` here:
    // the bridge connection lives for the entire document lifetime; the
    // webview teardown closes the WebSocket implicitly. The theme
    // subscription is owned by this effect and detaches on unmount.
    return () => {
      cancelled = true
      unsubscribeThemeChange?.()
    }
  }, [])

  return (
    <ExtensionClientContext.Provider value={value}>
      {children}
    </ExtensionClientContext.Provider>
  )
})

ExtensionClientProvider.displayName = 'ExtensionClientProvider'

/**
 * Access the current bridge connection state. Components that only run
 * when the bridge is ready should narrow the result with
 * `status === 'ready'` before touching `client`.
 */
export function useExtensionClient(): ExtensionClientContextValue {
  return useContext(ExtensionClientContext)
}
