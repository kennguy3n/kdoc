import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  ExtensionClient,
  type ConnectionStatus,
  type ExtensionClient as ExtensionClientType,
} from '@kchat/sdk/client'

export interface ExtensionClientContextValue {
  client: ExtensionClientType | null
  connectionStatus: ConnectionStatus
  theme: 'light' | 'dark' | 'system'
  effectiveTheme: 'light' | 'dark'
}

const ExtensionClientContext = createContext<ExtensionClientContextValue | null>(null)

export function ExtensionClientProvider({children}: {children: ReactNode}) {
  const [client, setClient] = useState<ExtensionClientType | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    let disposed = false
    const extClient = new ExtensionClient()

    const connect = async () => {
      try {
        setConnectionStatus('connecting')
        await extClient.connect()
        if (disposed) return
        setClient(extClient)
        setConnectionStatus('ready')

        const hostTheme = await extClient.runtime.getTheme()
        if (disposed) return
        setTheme(hostTheme)

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        const updateEffective = () => {
          const effective = hostTheme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : hostTheme
          setEffectiveTheme(effective)
          document.documentElement.classList.toggle('dark', effective === 'dark')
        }
        updateEffective()

        extClient.runtime.onThemeChange((nextTheme) => {
          setTheme(nextTheme)
          const effective = nextTheme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : nextTheme
          setEffectiveTheme(effective)
          document.documentElement.classList.toggle('dark', effective === 'dark')
        })
      } catch (err) {
        if (disposed) return
        console.error('Failed to connect to KChat host:', err)
        setConnectionStatus('failed')
      }
    }

    connect()

    return () => {
      disposed = true
      extClient.dispose()
    }
  }, [])

  const value = useMemo<ExtensionClientContextValue>(
    () => ({
      client,
      connectionStatus,
      theme,
      effectiveTheme,
    }),
    [client, connectionStatus, theme, effectiveTheme],
  )

  return <ExtensionClientContext.Provider value={value}>{children}</ExtensionClientContext.Provider>
}

export function useExtensionClient(): ExtensionClientContextValue {
  const ctx = useContext(ExtensionClientContext)
  if (!ctx) {
    throw new Error('useExtensionClient must be used within ExtensionClientProvider')
  }
  return ctx
}

export {ExtensionClientContext}
