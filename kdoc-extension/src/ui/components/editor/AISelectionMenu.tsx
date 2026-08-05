import type {Editor} from '@tiptap/react'
import {ChevronRight, MessageSquare} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'

import {SELECTION_ACTIONS, type AIActionDef, type AIActionSubVariant} from '@/ui/lib/ai-actions'
import {ACTION_ICONS, DEFAULT_ACTION_ICON} from '@/ui/lib/ai-icons'
import {cn} from '@/ui/utils'

export interface AISelectionMenuProps {
  editor: Editor | null
  onSkillTrigger: (skillId: string, selection: string, context: string) => void
}

interface MenuItem {
  skill: AIActionDef
  variant?: AIActionSubVariant
}

export function AISelectionMenu({editor, onSkillTrigger}: AISelectionMenuProps) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({top: 0, left: 0})
  const [submenuFor, setSubmenuFor] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [subIndex, setSubIndex] = useState(0)
  const [customInstruction, setCustomInstruction] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const selectionRef = useRef<{from: number; to: number} | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pointerUpRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const menuItems: MenuItem[] = SELECTION_ACTIONS.map((s) => ({skill: s}))

  useEffect(() => {
    if (!editor) return

    const handlePointerUp = () => {
      pointerUpRef.current = true
    }
    editor.view.dom.addEventListener('pointerup', handlePointerUp)

    const handleSelectionUpdate = () => {
      const {from, to} = editor.state.selection
      if (from === to) {
        setVisible(false)
        return
      }
      if (editor.isActive('codeBlock')) {
        setVisible(false)
        return
      }
      const text = editor.state.doc.textBetween(from, to, '\n')
      if (text.trim().length < 2) {
        setVisible(false)
        return
      }

      const showMenu = () => {
        const coords = editor.view.coordsAtPos(from)
        const editorRect = editor.view.dom.getBoundingClientRect()
        setPosition({
          top: coords.bottom - editorRect.top + 4,
          left: coords.left - editorRect.left,
        })
        selectionRef.current = {from, to}
        setSubmenuFor(null)
        setSelectedIndex(0)
        setSubIndex(0)
        setShowCustomInput(false)
        setVisible(true)
      }

      // Mouse selection: show immediately
      if (pointerUpRef.current) {
        pointerUpRef.current = false
        if (debounceRef.current) clearTimeout(debounceRef.current)
        showMenu()
        return
      }

      // Keyboard selection: debounce so the menu doesn't appear mid-selection
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(showMenu, 600)
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
      editor.view.dom.removeEventListener('pointerup', handlePointerUp)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [editor])

  const triggerSkill = useCallback(
    (skillId: string, context?: string) => {
      if (!editor || !selectionRef.current) return
      const {from, to} = selectionRef.current
      const selection = editor.state.doc.textBetween(from, to, '\n')
      onSkillTrigger(skillId, selection, context ?? '')
      setVisible(false)
      setSubmenuFor(null)
      setShowCustomInput(false)
    },
    [editor, onSkillTrigger],
  )

  const triggerCustomInstruction = useCallback(() => {
    if (!customInstruction.trim()) return
    if (!editor || !selectionRef.current) return
    const {from, to} = selectionRef.current
    const selection = editor.state.doc.textBetween(from, to, '\n')
    onSkillTrigger('custom_instruction', selection, customInstruction.trim())
    setCustomInstruction('')
    setShowCustomInput(false)
    setVisible(false)
  }, [customInstruction, editor, onSkillTrigger])

  useEffect(() => {
    if (!visible) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (submenuFor || showCustomInput) {
          setSubmenuFor(null)
          setShowCustomInput(false)
        } else {
          setVisible(false)
        }
        return
      }

      if (showCustomInput) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          triggerCustomInstruction()
        }
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % (menuItems.length + 1))
        setSubmenuFor(null)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + menuItems.length + 1) % (menuItems.length + 1))
        setSubmenuFor(null)
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        const item = menuItems[selectedIndex]
        if (!item) {
          setShowCustomInput(true)
          return
        }
        if (item.skill.subVariants && item.skill.subVariants.length > 0) {
          if (e.key === 'ArrowRight') {
            setSubmenuFor(item.skill.id)
            setSubIndex(0)
          } else {
            triggerSkill(item.skill.id)
          }
        } else {
          triggerSkill(item.skill.id)
        }
      } else if (e.key === 'ArrowLeft' && submenuFor) {
        e.preventDefault()
        setSubmenuFor(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [visible, selectedIndex, submenuFor, showCustomInput, menuItems, triggerSkill, triggerCustomInstruction])

  useEffect(() => {
    if (!visible) return
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setVisible(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [visible])

  if (!editor || !visible) return null

  const activeSubmenuSkill = submenuFor ? SELECTION_ACTIONS.find((s) => s.id === submenuFor) : null

  return (
    <div
      ref={containerRef}
      className="absolute z-30 rounded-lg border border-border bg-surface shadow-lg"
      style={{top: position.top, left: position.left}}
    >
      {showCustomInput ? (
        <div className="w-64 p-2">
          <textarea
            autoFocus
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Enter custom instruction..."
            className="w-full resize-none rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-xs text-muted">Enter to submit, Esc to cancel</span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                triggerCustomInstruction()
              }}
              className="rounded-md bg-brand/10 px-2 py-1 text-xs font-medium text-brand hover:bg-brand/20"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <div className="py-1">
          {menuItems.map(({skill}, idx) => {
            const Icon = ACTION_ICONS[skill.icon] ?? DEFAULT_ACTION_ICON
            const hasSub = skill.subVariants && skill.subVariants.length > 0
            const isActive = idx === selectedIndex
            return (
              <div key={skill.id} className="relative">
                <button
                  type="button"
                  onMouseEnter={() => {
                    setSelectedIndex(idx)
                    setSubmenuFor(hasSub ? skill.id : null)
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (hasSub) {
                      setSubmenuFor(skill.id)
                    } else {
                      triggerSkill(skill.id)
                    }
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                    isActive ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                  <span className="flex-1 text-sm font-medium text-fg">{skill.label}</span>
                  {hasSub && <ChevronRight className="h-3 w-3 text-muted" />}
                </button>
                {hasSub && submenuFor === skill.id && activeSubmenuSkill && (
                  <div className="absolute left-full top-0 ml-0.5 min-w-[140px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                    {activeSubmenuSkill.subVariants!.map((variant, vIdx) => (
                      <button
                        key={variant.id}
                        type="button"
                        onMouseEnter={() => setSubIndex(vIdx)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          triggerSkill(skill.id, variant.context)
                        }}
                        className={cn(
                          'flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors',
                          vIdx === subIndex ? 'bg-surface-2' : 'hover:bg-surface-2',
                        )}
                      >
                        {variant.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {/* Custom instruction item */}
          <button
            type="button"
            onMouseEnter={() => setSelectedIndex(menuItems.length)}
            onMouseDown={(e) => {
              e.preventDefault()
              setShowCustomInput(true)
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
              selectedIndex === menuItems.length ? 'bg-surface-2' : 'hover:bg-surface-2',
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
            <span className="flex-1 text-sm font-medium text-fg">Ask AI...</span>
          </button>
        </div>
      )}
    </div>
  )
}
