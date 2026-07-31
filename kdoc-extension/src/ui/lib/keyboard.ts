export interface KeyboardShortcut {
  id: string
  keys: string
  description: string
  category: 'formatting' | 'blocks' | 'ai' | 'global'
  action?: () => void
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const MOD = isMac ? 'Cmd' : 'Ctrl'

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {id: 'bold', keys: `${MOD}+B`, description: 'Bold', category: 'formatting'},
  {id: 'italic', keys: `${MOD}+I`, description: 'Italic', category: 'formatting'},
  {id: 'underline', keys: `${MOD}+U`, description: 'Underline', category: 'formatting'},
  {id: 'inline-code', keys: `${MOD}+E`, description: 'Inline code', category: 'formatting'},
  {id: 'strikethrough', keys: `${MOD}+Shift+S`, description: 'Strikethrough', category: 'formatting'},
  {id: 'h1', keys: `${MOD}+Alt+1`, description: 'Heading 1', category: 'blocks'},
  {id: 'h2', keys: `${MOD}+Alt+2`, description: 'Heading 2', category: 'blocks'},
  {id: 'h3', keys: `${MOD}+Alt+3`, description: 'Heading 3', category: 'blocks'},
  {id: 'h4', keys: `${MOD}+Alt+4`, description: 'Heading 4', category: 'blocks'},
  {id: 'ordered-list', keys: `${MOD}+Shift+7`, description: 'Ordered list', category: 'blocks'},
  {id: 'bullet-list', keys: `${MOD}+Shift+8`, description: 'Bullet list', category: 'blocks'},
  {id: 'task-list', keys: `${MOD}+Shift+9`, description: 'Task list', category: 'blocks'},
  {id: 'blockquote', keys: `${MOD}+Shift+B`, description: 'Blockquote', category: 'blocks'},
  {id: 'code-block', keys: `${MOD}+Alt+C`, description: 'Code block', category: 'blocks'},
  {id: 'undo', keys: `${MOD}+Z`, description: 'Undo', category: 'global'},
  {id: 'redo', keys: `${MOD}+Shift+Z`, description: 'Redo', category: 'global'},
  {id: 'save', keys: `${MOD}+S`, description: 'Save document', category: 'global'},
  {id: 'command-palette', keys: `${MOD}+K`, description: 'Open command palette', category: 'global'},
  {id: 'ai-continue', keys: `${MOD}+Space`, description: 'AI: Continue writing', category: 'ai'},
  {id: 'ai-panel', keys: `${MOD}+J`, description: 'Toggle AI panel', category: 'ai'},
  {id: 'shortcuts-help', keys: `${MOD}+/`, description: 'Show keyboard shortcuts', category: 'global'},
]

export function formatShortcut(keys: string): string {
  if (isMac) {
    return keys.replace('Cmd', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace('Ctrl', '⌃')
  }
  return keys
}

export function matchShortcut(event: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+')
  const needMod = parts.includes('Cmd') || parts.includes('Ctrl')
  const needShift = parts.includes('Shift')
  const needAlt = parts.includes('Alt')
  const keyPart = parts[parts.length - 1].toLowerCase()

  const hasMod = isMac ? event.metaKey : event.ctrlKey
  const hasShift = event.shiftKey
  const hasAlt = event.altKey

  if (needMod !== hasMod) return false
  if (needShift !== hasShift) return false
  if (needAlt !== hasAlt) return false
  return event.key.toLowerCase() === keyPart
}
