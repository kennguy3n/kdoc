import type {Editor} from '@tiptap/react'
import {List, X} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'

import {cn} from '@/ui/utils'

interface HeadingEntry {
  id: string
  level: number
  text: string
  pos: number
}

function extractHeadings(editor: Editor): HeadingEntry[] {
  const headings: HeadingEntry[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        id: `${pos}`,
        level: node.attrs.level as number,
        text: node.textContent,
        pos,
      })
    }
    return true
  })
  return headings
}

export interface DocumentOutlineProps {
  editor: Editor | null
}

export function DocumentOutline({editor}: DocumentOutlineProps) {
  const [headings, setHeadings] = useState<HeadingEntry[]>([])
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!editor) return
    let rafId: number | null = null
    const update = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = null
        setHeadings(extractHeadings(editor))
      })
    }
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [editor])

  const scrollToHeading = useCallback(
    (pos: number) => {
      if (!editor) return
      editor.commands.focus()
      editor.commands.setTextSelection(pos)
      const tr = editor.state.tr.scrollIntoView()
      editor.view.dispatch(tr)
    },
    [editor],
  )

  if (headings.length === 0) return null

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        title={`${headings.length} headings — show outline`}
        className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium text-muted shadow-card transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <List className="h-3.5 w-3.5" />
        {headings.length}
      </button>
    )
  }

  return (
    <div className="absolute right-4 top-4 z-20 w-52 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-surface p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Outline</h3>
        <button
          type="button"
          onClick={() => setVisible(false)}
          title="Hide outline"
          className="rounded p-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-0.5">
        {headings.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => scrollToHeading(h.pos)}
              className={cn(
                'block w-full truncate rounded px-2 py-1 text-left text-sm transition-colors',
                'hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                h.level === 1 ? 'font-medium text-fg' : h.level === 2 ? 'pl-4 text-fg/80' : 'pl-6 text-muted',
              )}
              title={h.text}
            >
              {h.text || 'Untitled'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
