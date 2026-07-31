/**
 * Home page — the extension's landing surface.
 *
 * This is a minimal starting point. Replace the content below with
 * your own UI. The `useExtensionClient` hook gives you access to
 * the SDK client (host context, kchat queries, commands, etc.).
 */

import {type ReactElement} from 'react'

import {useExtensionClient} from '@/runtime'
import {EmptyState} from '@/ui/components/primitives'

export function HomePage(): ReactElement {
  const {status, client, error} = useExtensionClient()

  if (status === 'connecting') {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Connecting to KChat…</p>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          title="Connection failed"
          description={error?.message ?? 'Could not connect to the KChat host.'}
        />
      </div>
    )
  }

  // status === 'ready' — the SDK client is available.
  // Use `client.kchat.queryMessages(...)`, `client.commands.invoke(...)`,
  // `client.session.queryStatus()`, etc. to interact with the host.
  void client

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Hello, KChat!</h1>
      <p className="text-sm text-muted-foreground">
        Your extension is running. Edit{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          src/ui/pages/home.tsx
        </code>{' '}
        to build your UI.
      </p>
    </div>
  )
}
