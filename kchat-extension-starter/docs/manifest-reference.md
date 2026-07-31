# Manifest Reference

The `manifest.json` is the only place an extension declares intent.
The host validates it at install time and rejects malformed manifests.

## Full template manifest

```jsonc
{
  "manifestVersion": 1,
  "id": "your-vendor.your-extension",  // <vendor>.<extension-id>
  "name": "My KChat Extension",         // display name
  "version": "0.1.0",                   // semver
  "publisher": "your-vendor",           // matches the signing key's publisher
  "sdkVersion": "^1.0.0",               // SDK contract version
  "entry": {
    "client": "dist/client/index.html",  // optional — at least one required
    "server": "dist/server/index.js"     // optional
  },
  "dev": {
    "sourceRoot": "${MANIFEST_DIR}",     // expanded by the host at dev-link time
    "devServerUrl": "http://localhost:5150"
  },
  "activationEvents": ["onAppReady"],
  "contributes": { /* views, paths, actions, commands, menus */ },
  "permissions": { /* runtime, kchat, session, device, utils, mcp */ },
  "resources": { "public": ["dist/client/assets/**"] },
  "update": { "policy": "notify", "channel": "stable" }
}
```

## Identity

| Field | Type | Description |
| --- | --- | --- |
| `manifestVersion` | `1` | Schema version. Always `1`. |
| `id` | `string` | `<vendor>.<extension-id>`. Must be globally unique. |
| `name` | `string` | Human-readable display name. |
| `version` | `string` | Semver version. Bump for every release. |
| `publisher` | `string` | Vendor slug. Must match the signing key's publisher. |
| `sdkVersion` | `string` | SDK contract semver range. |

## Entry points

At least one of `entry.client` or `entry.server` is required.

| Entry | What it is | When to declare |
| --- | --- | --- |
| `client` | Built HTML + JS/CSS served in a webview | Your extension has a UI |
| `server` | Built Node module with `activate()`/`deactivate()` | Your extension has server-side logic, commands, or MCP tools |

## Activation events

| Event | Fires when |
| --- | --- |
| `onAppReady` | App startup — extension activates immediately |
| `onView:<viewId>` | The user navigates to a view you contribute |
| `onCommand:<commandId>` | The user triggers a command you declare |

## Contributions

### Views

```jsonc
"views": [
  {
    "id": "home-panel",           // unique within this extension
    "title": "My Extension",      // tab/sidebar title
    "slot": "com.kchat.desktop.slot.outer-rightbar",  // host slot id
    "options": { "showCloseButton": false }
  }
]
```

**Available slots:**

| Slot id | Where it renders |
| --- | --- |
| `com.kchat.desktop.slot.outer-rightbar` | Right sidebar |
| `com.kchat.desktop.slot.conversation.main.inline` | Inline above conversation |
| `com.kchat.desktop.slot.message.bubble.card` | Per-message card (one webview per message) |

### Paths

```jsonc
"paths": [
  {
    "id": "home",              // unique within this extension
    "view": "home-panel",      // must match a view id
    "path": "/home",           // hash route
    "deeplink": true,          // optional — reachable via kchat://
    "query": ["draft"]         // optional — allowed query params for deeplinks
  }
]
```

### Actions

```jsonc
"actions": [
  {
    "id": "open-home",
    "title": "My Extension",
    "icon": "bot",             // lucide icon name
    "placement": "com.kchat.desktop.placement.global-header-right",
    "target": { "path": "home" },  // navigates to a path id
    "order": 100
  }
]
```

### Commands

```jsonc
"commands": [
  { "id": "your-extension.echo", "title": "Echo" }
]
```

Commands are invoked from the client (`client.commands.invoke(...)`)
or from menu contributions. To expose a command to AI clients via MCP,
register it with `defineExtensionCommand({mcp: {...}})` in the server
entry and add `"mcp": ["expose"]` to permissions.

### Menus

**Composer slash:**

```jsonc
"menus": {
  "composer/slash": [
    {
      "id": "your-extension.slash.echo",
      "trigger": "echo",       // user types /echo <text>
      "title": "Echo input",
      "summary": "Post text back into the conversation",
      "command": "your-extension.slash-echo",
      "scope": ["conversation"]
    }
  ]
}
```

**Message context:**

```jsonc
"menus": {
  "message/context": [
    {
      "id": "your-extension.menu.translate",
      "title": "Translate",
      "icon": "sparkles",
      "command": "your-extension.menu-translate",
      "group": "inline",
      "appliesTo": ["text"]
    }
  ]
}
```

## Permissions

Every capability the extension uses must be declared here. The host
denies any SDK call not covered by a declared permission.

| Namespace | Capabilities |
| --- | --- |
| `runtime` | `context` |
| `kchat` | `query_messages`, `query_conversations`, `send_message`, `upload_media` |
| `session` | `query_status`, `get_access_token` |
| `device` | `get_state` |
| `utils` | `open_external` |
| `mcp` | `expose` (required when any command has an `mcp` block) |

## Resources

```jsonc
"resources": {
  "public": ["dist/client/assets/**", "dist/client/favicon.svg"]
}
```

Glob patterns for files the host serves as static assets via
`kchat-extension://<id>/<version>/...`.

## Update

```jsonc
"update": {
  "policy": "notify",    // "notify" (prompt user) or "auto" (silent)
  "channel": "stable"    // "stable" or "beta"
}
```

Only `user-installed` extensions poll an update feed. `bundled`
extensions ride the app image; `dev-link` extensions reload from disk.
