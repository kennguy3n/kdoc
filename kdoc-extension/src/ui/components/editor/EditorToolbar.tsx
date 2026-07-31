import type {Editor} from '@tiptap/react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo,
  Strikethrough,
  Table,
  Underline as UnderlineIcon,
  Undo,
  type LucideIcon,
} from 'lucide-react'
import {useCallback, type MouseEvent} from 'react'

import {cn} from '@/ui/utils'

interface ToolbarButton {
  icon: LucideIcon
  label: string
  isActive?: (editor: Editor) => boolean
  onClick: (editor: Editor) => void
}

const HISTORY_BUTTONS: ToolbarButton[] = [
  {icon: Undo, label: 'Undo', onClick: (e) => e.chain().focus().undo().run()},
  {icon: Redo, label: 'Redo', onClick: (e) => e.chain().focus().redo().run()},
]

const HEADING_BUTTONS: ToolbarButton[] = [
  {icon: Heading1, label: 'H1', isActive: (e) => e.isActive('heading', {level: 1}), onClick: (e) => e.chain().focus().toggleHeading({level: 1}).run()},
  {icon: Heading2, label: 'H2', isActive: (e) => e.isActive('heading', {level: 2}), onClick: (e) => e.chain().focus().toggleHeading({level: 2}).run()},
  {icon: Heading3, label: 'H3', isActive: (e) => e.isActive('heading', {level: 3}), onClick: (e) => e.chain().focus().toggleHeading({level: 3}).run()},
]

const FORMAT_BUTTONS: ToolbarButton[] = [
  {icon: Bold, label: 'Bold', isActive: (e) => e.isActive('bold'), onClick: (e) => e.chain().focus().toggleBold().run()},
  {icon: Italic, label: 'Italic', isActive: (e) => e.isActive('italic'), onClick: (e) => e.chain().focus().toggleItalic().run()},
  {icon: UnderlineIcon, label: 'Underline', isActive: (e) => e.isActive('underline'), onClick: (e) => e.chain().focus().toggleUnderline().run()},
  {icon: Strikethrough, label: 'Strikethrough', isActive: (e) => e.isActive('strike'), onClick: (e) => e.chain().focus().toggleStrike().run()},
  {icon: Code, label: 'Code', isActive: (e) => e.isActive('code'), onClick: (e) => e.chain().focus().toggleCode().run()},
  {icon: LinkIcon, label: 'Link', isActive: (e) => e.isActive('link'), onClick: (e) => {
    const url = window.prompt('Enter URL:')
    if (url) e.chain().focus().setLink({href: url}).run()
  }},
]

const LIST_BUTTONS: ToolbarButton[] = [
  {icon: List, label: 'Bullet list', isActive: (e) => e.isActive('bulletList'), onClick: (e) => e.chain().focus().toggleBulletList().run()},
  {icon: ListOrdered, label: 'Numbered list', isActive: (e) => e.isActive('orderedList'), onClick: (e) => e.chain().focus().toggleOrderedList().run()},
  {icon: ListChecks, label: 'Task list', isActive: (e) => e.isActive('taskList'), onClick: (e) => e.chain().focus().toggleTaskList().run()},
  {icon: Quote, label: 'Quote', isActive: (e) => e.isActive('blockquote'), onClick: (e) => e.chain().focus().toggleBlockquote().run()},
]

const INSERT_BUTTONS: ToolbarButton[] = [
  {icon: ImageIcon, label: 'Image', onClick: (e) => {
    const url = window.prompt('Enter image URL:')
    if (url) e.chain().focus().setImage({src: url}).run()
  }},
  {icon: Table, label: 'Table', onClick: (e) => e.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run()},
  {icon: Minus, label: 'Divider', onClick: (e) => e.chain().focus().setHorizontalRule().run()},
]

function ToolbarGroup({buttons, editor}: {buttons: ToolbarButton[]; editor: Editor}) {
  return (
    <div className="flex items-center gap-0.5">
      {buttons.map((btn) => {
        const Icon = btn.icon
        const active = btn.isActive?.(editor) ?? false
        return (
          <button
            key={btn.label}
            type="button"
            title={btn.label}
            aria-label={btn.label}
            aria-pressed={active}
            onMouseDown={(e: MouseEvent) => {
              e.preventDefault()
              btn.onClick(editor)
            }}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
              'hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-brand/10 text-brand' : 'text-muted hover:text-fg',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

export interface EditorToolbarProps {
  editor: Editor | null
}

export function EditorToolbar({editor}: EditorToolbarProps) {
  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault()
  }, [])

  if (!editor) return null

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5"
      onMouseDown={handleMouseDown}
    >
      <ToolbarGroup buttons={HISTORY_BUTTONS} editor={editor} />
      <Divider />
      <ToolbarGroup buttons={HEADING_BUTTONS} editor={editor} />
      <Divider />
      <ToolbarGroup buttons={FORMAT_BUTTONS} editor={editor} />
      <Divider />
      <ToolbarGroup buttons={LIST_BUTTONS} editor={editor} />
      <Divider />
      <ToolbarGroup buttons={INSERT_BUTTONS} editor={editor} />
    </div>
  )
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border" />
}
