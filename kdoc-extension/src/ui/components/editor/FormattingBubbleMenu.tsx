import {BubbleMenu} from '@tiptap/react'
import type {Editor} from '@tiptap/react'
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  Strikethrough,
  Underline as UnderlineIcon,
  type LucideIcon,
} from 'lucide-react'
import {useCallback, useEffect, useRef, useState, type MouseEvent} from 'react'

import {cn} from '@/ui/utils'
import {LinkInputPopover} from './LinkInputPopover'

interface LinkInputState {
  open: boolean
  anchorRect: DOMRect | null
}

interface BubbleButtonItem {
  icon: LucideIcon
  label: string
  isActive?: (editor: Editor) => boolean
  onClick: (editor: Editor) => void
}

const BUTTONS: BubbleButtonItem[] = [
  {icon: Bold, label: 'Bold', isActive: (e) => e.isActive('bold'), onClick: (e) => e.chain().focus().toggleBold().run()},
  {icon: Italic, label: 'Italic', isActive: (e) => e.isActive('italic'), onClick: (e) => e.chain().focus().toggleItalic().run()},
  {icon: UnderlineIcon, label: 'Underline', isActive: (e) => e.isActive('underline'), onClick: (e) => e.chain().focus().toggleUnderline().run()},
  {icon: Strikethrough, label: 'Strikethrough', isActive: (e) => e.isActive('strike'), onClick: (e) => e.chain().focus().toggleStrike().run()},
  {icon: Code, label: 'Inline code', isActive: (e) => e.isActive('code'), onClick: (e) => e.chain().focus().toggleCode().run()},
  {icon: LinkIcon, label: 'Link', isActive: (e) => e.isActive('link'), onClick: () => {}},
]

export interface FormattingBubbleMenuProps {
  editor: Editor | null
}

export function FormattingBubbleMenu({editor}: FormattingBubbleMenuProps) {
  const [linkInput, setLinkInput] = useState<LinkInputState>({open: false, anchorRect: null})
  const [kbShow, setKbShow] = useState(false)
  const pointerUpRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track pointer-based selections so we can distinguish mouse vs keyboard.
  useEffect(() => {
    if (!editor) return
    const handlePointerUp = () => {
      pointerUpRef.current = true
      setKbShow(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    const handleKeyDown = () => {
      // Any keyboard activity resets the debounce timer
      setKbShow(false)
    }
    editor.view.dom.addEventListener('pointerup', handlePointerUp)
    editor.view.dom.addEventListener('keydown', handleKeyDown)
    return () => {
      editor.view.dom.removeEventListener('pointerup', handlePointerUp)
      editor.view.dom.removeEventListener('keydown', handleKeyDown)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [editor])

  const handleMouseDown = useCallback(
    (e: MouseEvent, btn: BubbleButtonItem) => {
      e.preventDefault()
      if (!editor) return
      if (btn.label === 'Link') {
        if (editor.isActive('link')) {
          editor.chain().focus().unsetLink().run()
        } else {
          const bubbleEl = (e.currentTarget as HTMLElement).closest('[data-bubble-menu]') as HTMLElement | null
          setLinkInput({open: true, anchorRect: bubbleEl?.getBoundingClientRect() ?? null})
        }
        return
      }
      btn.onClick(editor)
    },
    [editor],
  )

  if (!editor) return null

  return (
    <>
      <BubbleMenu
        editor={editor}
        tippyOptions={{duration: 100, placement: 'top'}}
        shouldShow={({editor, state, from, to}) => {
          if (linkInput.open) return false
          if (from === to) return false
          if (editor.isActive('codeBlock')) return false
          const text = state.doc.textBetween(from, to, '\n')
          if (text.trim().length === 0) return false

          // Mouse selection: show immediately
          if (pointerUpRef.current) {
            pointerUpRef.current = false
            setKbShow(false)
            if (debounceRef.current) clearTimeout(debounceRef.current)
            return true
          }

          // Keyboard selection: only show if the debounce timer has fired
          // (i.e., selection has been stable for 600ms)
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => setKbShow(true), 600)
          return kbShow
        }}
      >
        <div
          className="flex items-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-1 shadow-lg"
          role="toolbar"
          data-bubble-menu
        >
          {BUTTONS.map((btn) => {
            const Icon = btn.icon
            const active = btn.isActive?.(editor) ?? false
            return (
              <button
                key={btn.label}
                type="button"
                title={btn.label}
                aria-label={btn.label}
                aria-pressed={active}
                onMouseDown={(e) => handleMouseDown(e, btn)}
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
      </BubbleMenu>
      {linkInput.open && editor && (
        <LinkInputPopover
          editor={editor}
          anchorRect={linkInput.anchorRect}
          onDone={() => setLinkInput({open: false, anchorRect: null})}
        />
      )}
    </>
  )
}
