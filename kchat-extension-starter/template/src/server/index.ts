/**
 * Extension server entry.
 *
 * The host calls `activate(context)` once per session; subscriptions
 * added to `context.subscriptions` are torn down when
 * `deactivate(reason)` returns.
 *
 * Use `defineExtensionCommand` with a Zod input schema for any
 * command you want paired AI clients to call through MCP. The SDK
 * harness runs `safeParse` before dispatch so the handler always
 * receives a parsed value.
 *
 * Renderer-only commands that do not need MCP exposure stay on the
 * string-id overload:
 *   `context.commands.registerCommand<Input, Output>('id', handler)`
 */

import {z} from '@kchat/sdk'
import {
  defineExtensionCommand,
  type ExtensionServerContext,
} from '@kchat/sdk/server'

const EchoInputSchema = z.object({
  message: z
    .string()
    .min(1)
    .max(2000)
    .describe('Text to echo back to the caller.'),
})

interface EchoInput {
  message: string
}

interface EchoResult {
  reply: string
  receivedAt: number
}

export async function activate(
  context: ExtensionServerContext,
): Promise<void> {
  context.logger.info('extension server activating')

  context.subscriptions.add(
    context.commands.registerCommand(
      defineExtensionCommand({
        id: 'your-extension.echo',
        title: 'Echo',
        description: 'Echo the supplied text back to the caller.',
        mcp: {
          category: 'read',
          tier: 'T0',
          destructive: false,
          callers: 'all',
          description:
            'Returns the supplied message verbatim — smoke-tests the AI-client to extension command pipeline end-to-end.',
          inputSchema: EchoInputSchema,
        },
        handle: async (input: EchoInput): Promise<EchoResult> => {
          return {reply: input.message, receivedAt: Date.now()}
        },
      }),
    ),
  )

  // Subscribe to host-context changes if useful.
  context.subscriptions.add(
    context.runtime.onDidChangeContext((snapshot) => {
      context.logger.debug('Scope changed', {kind: snapshot.scope.kind})
    }),
  )
}

export async function deactivate(_reason: string): Promise<void> {
  // Optional: persist anything the disposable bag cannot cover.
}
