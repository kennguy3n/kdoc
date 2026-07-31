import {defineExtensionCommand, type ExtensionContext} from '@kchat/sdk/server'

let ctx: ExtensionContext | null = null

export async function activate(context: ExtensionContext) {
  ctx = context
  const {host, logger} = context

  logger.info('KDoc extension activated')

  context.subscriptions.push(
    defineExtensionCommand(host, {
      id: 'kennguy3n.kdoc.ai-skill',
      title: 'AI Skill',
      handler: async (args: Record<string, unknown>) => {
        const {skill_id} = args as {skill_id: string}
        logger.info(`AI skill invoked: ${skill_id}`)
        return {
          skill_id,
          status: 'queued',
          message: 'AI skill will be processed client-side via wllama.',
        }
      },
    }),
  )

  context.subscriptions.push(
    defineExtensionCommand(host, {
      id: 'kennguy3n.kdoc.export',
      title: 'Export Document',
      handler: async (args: Record<string, unknown>) => {
        const {doc_id, format} = args as {doc_id: string; format: string}
        logger.info(`Export requested: doc=${doc_id}, format=${format}`)
        return {
          doc_id,
          format,
          status: 'Export is handled client-side.',
        }
      },
    }),
  )

  host.onContextChange((newCtx) => {
    ctx = newCtx
    logger.info('Host context updated')
  })
}

export async function deactivate() {
  ctx?.logger.info('KDoc extension deactivated')
  ctx = null
}
