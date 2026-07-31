declare module '@kchat/sdk/client' {
  export type ConnectionStatus = 'connecting' | 'ready' | 'failed'

  export interface ExtensionClientConfig {
    progressCallback?: (progress: { loaded: number; total: number }) => void
  }

  export class ExtensionClient {
    connect(): Promise<void>
    dispose(): void
    runtime: {
      getTheme(): Promise<'light' | 'dark' | 'system'>
      onThemeChange(cb: (theme: 'light' | 'dark' | 'system') => void): void
    }
    kchat: {
      queryMessages(params: Record<string, unknown>): Promise<unknown>
    }
    commands: {
      execute(id: string, args?: Record<string, unknown>): Promise<unknown>
    }
  }

  export function applyDefaultLayout(): void
}

declare module '@kchat/sdk/server' {
  export interface ExtensionContext {
    host: {
      onContextChange(cb: (ctx: ExtensionContext) => void): void
    }
    logger: {
      info(msg: string): void
      error(msg: string): void
      warn(msg: string): void
    }
    subscriptions: Array<{ dispose?: () => void }>
  }

  export interface ExtensionCommandDef {
    id: string
    title: string
    handler: (args: Record<string, unknown>) => Promise<unknown>
  }

  export function defineExtensionCommand(
    host: ExtensionContext['host'],
    def: ExtensionCommandDef,
  ): { dispose: () => void }
}
