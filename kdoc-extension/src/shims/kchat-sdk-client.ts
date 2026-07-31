export type ConnectionStatus = 'connecting' | 'ready' | 'failed'

export interface ExtensionClientConfig {
  progressCallback?: (progress: { loaded: number; total: number }) => void
}

export class ExtensionClient {
  private listeners: Array<() => void> = []

  async connect(): Promise<void> {
    return Promise.resolve()
  }

  dispose(): void {
    this.listeners.forEach((fn) => fn())
    this.listeners = []
  }

  runtime = {
    getTheme: async (): Promise<'light' | 'dark' | 'system'> => {
      const stored = localStorage.getItem('kdoc:theme')
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    },
    onThemeChange: (cb: (theme: 'light' | 'dark' | 'system') => void): void => {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = (e: MediaQueryListEvent) => {
        cb(e.matches ? 'dark' : 'light')
      }
      mediaQuery.addEventListener('change', handler)
      this.listeners.push(() => mediaQuery.removeEventListener('change', handler))
    },
  }

  kchat = {
    queryMessages: async (_params: Record<string, unknown>): Promise<unknown> => {
      return []
    },
  }

  commands = {
    execute: async (_id: string, _args?: Record<string, unknown>): Promise<unknown> => {
      return null
    },
  }
}

export function applyDefaultLayout(): void {
  const root = document.getElementById('root')
  if (root) {
    root.style.height = '100%'
    root.style.width = '100%'
  }
}
