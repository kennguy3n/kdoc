import {Extension} from '@tiptap/core'
import {Plugin, PluginKey} from '@tiptap/pm/state'
import type {Editor} from '@tiptap/react'
import {createRoot, type Root} from 'react-dom/client'
import type {SuggestionProps} from '@tiptap/suggestion'

import {SlashMenuView} from './SlashMenuView'
import {SLASH_ACTIONS} from '@/ui/lib/ai-actions'
import {getLocalContext} from '@/ui/lib/token-context'

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  category: 'block' | 'rich' | 'ai'
  command: (props: {editor: Editor; range: Range; props: unknown}) => void
}

interface Range {
  from: number
  to: number
}

const BLOCK_COMMANDS: SlashCommandItem[] = [
  {
    title: 'Text',
    description: 'Plain text paragraph',
    icon: 'Type',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: 'Heading1',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).setHeading({level: 1}).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: 'Heading2',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).setHeading({level: 2}).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: 'Heading3',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).setHeading({level: 3}).run(),
  },
  {
    title: 'Bullet List',
    description: 'Create a bulleted list',
    icon: 'List',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered List',
    description: 'Create a numbered list',
    icon: 'ListOrdered',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'To-Do List',
    description: 'Create a task list',
    icon: 'ListChecks',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Quote',
    description: 'Insert a blockquote',
    icon: 'Quote',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code Block',
    description: 'Insert a code block',
    icon: 'Code',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    description: 'Insert a horizontal rule',
    icon: 'Minus',
    category: 'block',
    command: ({editor, range}) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Table',
    description: 'Insert a 3x3 table',
    icon: 'Table',
    category: 'block',
    command: ({editor, range}) =>
      editor.chain().focus().deleteRange(range).insertTable({rows: 3, cols: 3, withHeaderRow: true}).run(),
  },
]

const AI_COMMANDS: SlashCommandItem[] = SLASH_ACTIONS.map((action) => ({
  title: action.label,
  description: action.description,
  icon: action.icon,
  category: 'ai' as const,
  command: ({editor, range}) => {
    editor.chain().focus().deleteRange(range).run()
    const {from, to} = editor.state.selection
    const selection = editor.state.doc.textBetween(from, to, '\n')
    const context = getLocalContext(editor, from, to)
    window.dispatchEvent(
      new CustomEvent('kdoc:ai-skill', {
        detail: {skillId: action.id, selection, context, from, to},
      }),
    )
  },
}))

// Add custom instruction command
AI_COMMANDS.push({
  title: 'Ask AI...',
  description: 'Custom instruction for selected text',
  icon: 'MessageSquare',
  category: 'ai',
  command: ({editor, range}) => {
    editor.chain().focus().deleteRange(range).run()
    const {from, to} = editor.state.selection
    const selection = editor.state.doc.textBetween(from, to, '\n')
    window.dispatchEvent(
      new CustomEvent('kdoc:ai-skill', {
        detail: {skillId: 'custom_instruction', selection, context: ''},
      }),
    )
  },
})

const ALL_COMMANDS = [...BLOCK_COMMANDS, ...AI_COMMANDS]

const slashCommandPluginKey = new PluginKey('slashCommand')

function renderSlashMenu() {
  let containerEl: HTMLDivElement | null = null
  let root: Root | null = null

  const render = (props: SuggestionProps<SlashCommandItem>) => {
    if (!containerEl || !root) return
    root.render(
      <SlashMenuView
        items={props.items}
        command={props.command}
        clientRect={props.clientRect}
      />,
    )
  }

  return {
    onStart(props: SuggestionProps<SlashCommandItem>) {
      containerEl = document.createElement('div')
      document.body.appendChild(containerEl)
      root = createRoot(containerEl)
      render(props)
    },
    onUpdate(props: SuggestionProps<SlashCommandItem>) {
      render(props)
    },
    onExit() {
      if (root) {
        root.unmount()
        root = null
      }
      if (containerEl) {
        containerEl.remove()
        containerEl = null
      }
    },
    onKeyDown() {
      return false
    },
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: slashCommandPluginKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== '/') return false
            const {state} = view
            const $from = state.doc.resolve(from)
            const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n')
            if (textBefore.length > 0) return false

            const tr = state.tr.delete(from, to).insertText('/', from)
            view.dispatch(tr)

            const plugin = (editor.extensionStorage as Record<string, unknown>)['slashCommand'] as
              | {onSlash?: (range: Range) => void}
              | undefined
            plugin?.onSlash?.({from, to: from + 1})
            return true
          },
        },
      }),
    ]
  },

  addStorage() {
    return {
      onSlash: null as ((range: Range) => void) | null,
      commands: ALL_COMMANDS,
    }
  },
})

export {ALL_COMMANDS, renderSlashMenu}
