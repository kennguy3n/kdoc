import type {Editor} from '@tiptap/react'
import {useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent} from 'react'

import {cn} from '@/ui/utils'

export interface LinkInputPopoverProps {
  editor: Editor
  anchorRect: DOMRect | null
  onDone: () => void
}

export function LinkInputPopover({editor, anchorRect, onDone}: LinkInputPopoverProps) {
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (url.trim()) {
      editor.chain().focus().setLink({href: url.trim()}).run()
    }
    onDone()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onDone()
    }
  }

  const style: CSSProperties = anchorRect
    ? {top: anchorRect.bottom + 6, left: anchorRect.left}
    : {top: 100, left: 100}

  return (
    <div
      className="fixed z-50 rounded-lg border border-border bg-surface p-2 shadow-lg"
      style={style}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="url"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-48 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg',
            'placeholder:text-muted focus:border-brand focus:outline-none',
          )}
        />
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg transition-colors hover:bg-brand/90"
        >
          Apply
        </button>
      </form>
    </div>
  )
}
