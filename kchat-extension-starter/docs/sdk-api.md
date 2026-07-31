# SDK API

The SDK (`@kchat/sdk`) is the only path through which an extension
talks to the host. It ships as a single package with role-scoped
sub-entries.

## Entry points

| Entry | Used by | Key exports |
| --- | --- | --- |
| `@kchat/sdk` | Both client and server | Shared types, `z` (Zod), error classes |
| `@kchat/sdk/client` | Client bundle | `bootstrap()`, `applyDefaultLayout`, `subscribeThemeChange` |
| `@kchat/sdk/server` | Server bundle | `defineExtensionCommand`, `ExtensionServerContext` type |
| `@kchat/sdk/host` | Host only — never import | — |

## Client namespaces

After `bootstrap()`, the returned `ExtensionClient` exposes:

```ts
const ext = await bootstrap()
```

### `ext.runtime`

```ts
// Current host context (theme, scope, window info)
const ctx = await ext.runtime.getCurrentContext()

// Subscribe to context changes
ext.subscriptions.add(
  ext.runtime.onDidChangeContext((next) => { ... }),
)
```

### `ext.kchat`

```ts
// Query messages in a conversation
const page = await ext.kchat.queryMessages({
  conversationId: 'conv_123',
  limit: 20,
})
// page.items: Message[]
// page.pagination: { hasMore, nextCursor? }

// Query conversations
const convos = await ext.kchat.queryConversations({ limit: 10 })

// Send a message
const reply = await ext.kchat.sendMessage({
  conversationId: 'conv_123',
  text: 'Hello!',
})

// Upload media (returns opaque mediaAssetId)
const asset = await ext.kchat.uploadMedia({ file })
```

### `ext.commands`

```ts
// Invoke a manifest-declared command on the server
const result = await ext.commands.invoke<{reply: string}>(
  'your-extension.echo',
  {message: 'hello'},
)
```

### `ext.session`

```ts
// Identity card (username, display name, account id)
const me = await ext.session.queryStatus()

// Access token (requires permissions.session: ['get_access_token'])
const token = await ext.session.getAccessToken()
```

### `ext.deeplinks`

```ts
// Build a kchat:// URL for one of your paths
const url = ext.deeplinks.buildUrl('home', { draft: 'hello' })
// → "kchat://ext/your-vendor.your-extension/home?draft=hello"
```

### `ext.notifications`

```ts
await ext.notifications.show({ title: 'Done', body: 'Task completed' })
```

### `ext.internalStorage`

```ts
// Key-value storage scoped to this extension
await ext.internalStorage.set('key', value)
const value = await ext.internalStorage.get('key')
```

### `ext.secureStorage`

```ts
// Encrypted storage for secrets (tokens, etc.)
await ext.secureStorage.set('secret', token)
const token = await ext.secureStorage.get('secret')
```

### `ext.resources`

```ts
// Resolve a public asset URL
const url = ext.resources.resolve('assets/icon.png')
// → "kchat-extension://your-vendor.your-extension/<version>/assets/icon.png"
```

### `ext.hostShell`

```ts
// Open a URL in the system browser (requires permissions.utils: ['open_external'])
await ext.hostShell.openExternal('https://example.com')
```

### `ext.subscriptions`

A disposable bag. Add subscriptions here; they are disposed when the
extension unmounts.

```ts
ext.subscriptions.add(ext.runtime.onDidChangeContext(handler))
```

### `ext.logger`

```ts
ext.logger.info('message', { key: 'value' })
ext.logger.debug('detail', { key: 'value' })
ext.logger.warn('warning', { key: 'value' })
ext.logger.error('error', { key: 'value' })
```

## Server namespaces

The server entry receives an `ExtensionServerContext`:

```ts
export async function activate(context: ExtensionServerContext) {
  // context.commands, context.kchat, context.runtime, context.logger,
  // context.subscriptions, context.workers, context.processes,
  // context.internalStorage, context.secureStorage, context.extensionId
}
```

### `context.commands`

```ts
// Simple string-id command (no MCP exposure)
context.subscriptions.add(
  context.commands.registerCommand<Input, Output>(
    'your-extension.do-thing',
    async (input, invocation) => { ... },
  ),
)

// MCP-exposed command (with Zod schema)
context.subscriptions.add(
  context.commands.registerCommand(
    defineExtensionCommand({
      id: 'your-extension.echo',
      title: 'Echo',
      description: 'Echo the supplied text back to the caller.',
      mcp: {
        category: 'read',       // 'read' | 'write'
        tier: 'T0',             // T0 (auto-approve) | T1 | T2 (always prompt)
        destructive: false,
        callers: 'all',         // 'all' | 'mcp' | 'extension'
        description: '...',
        inputSchema: EchoInputSchema,  // Zod schema
      },
      handle: async (input) => { ... },
    }),
  ),
)
```

### `context.kchat`

Same surface as `ext.kchat` on the client — `queryMessages`,
`queryConversations`, `sendMessage`, `uploadMedia`.

### `context.workers`

```ts
const worker = context.workers.spawn({
  name: 'my-worker',
  source: { inline: '...' },  // or new URL('./worker.js', import.meta.url)
})
worker.onMessage((value) => { ... })
worker.postMessage({ hello: 'world' })
await worker.dispose()
```

### `context.processes`

```ts
// Fork a child process (Tier-2 — requires host ledger)
const child = context.processes.fork({
  name: 'my-child',
  source: new URL('./child.js', import.meta.url),
})

// Spawn a binary
const proc = context.processes.spawn({
  name: 'my-spawn',
  command: '/bin/echo',
  args: ['hello'],
})

// Register a raw Node.js child for cleanup tracking
context.subscriptions.add(
  context.processes.registerForCleanup(rawChild, { name: 'raw' }),
)
```

## Error handling

The SDK ships a typed error class hierarchy. Catch by code:

```ts
import { isExtensionRuntimeError } from '@kchat/sdk/client'

try {
  await ext.kchat.sendMessage({ ... })
} catch (err) {
  if (isExtensionRuntimeError(err)) {
    console.log(err.code)    // 'CAPABILITY_DENIED', 'RATE_LIMITED', etc.
    console.log(err.message)
  }
}
```

Common error codes:

| Code | Meaning |
| --- | --- |
| `CAPABILITY_DENIED` | Permission not declared in manifest |
| `RATE_LIMITED` | Too many calls to a rate-limited capability |
| `INPUT_INVALID` | Zod schema validation failed |
| `MCP_PERMISSION_MISSING` | Command has `mcp` block but `permissions.mcp: ['expose']` not declared |
| `INVALID_BOOTSTRAP` | Extension loaded outside the host webview |
