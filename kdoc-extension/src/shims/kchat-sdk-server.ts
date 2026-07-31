export interface ExtensionContext {
  host: {
    onContextChange: (cb: (ctx: ExtensionContext) => void) => void
  }
  logger: {
    info: (msg: string) => void
    error: (msg: string) => void
    warn: (msg: string) => void
  }
  subscriptions: Array<{ dispose?: () => void }>
}

export interface ExtensionCommandDef {
  id: string
  title: string
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export function defineExtensionCommand(
  _host: ExtensionContext['host'],
  _def: ExtensionCommandDef,
): { dispose: () => void } {
  return {
    dispose: () => {},
  }
}
