import { EditorContent, useEditor } from '@tiptap/react'
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileDown,
  Loader2,
  PanelRight,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { AIPanel } from '@/ui/components/editor/AIPanel'
import { AISelectionMenu } from '@/ui/components/editor/AISelectionMenu'
import { DocumentOutline } from '@/ui/components/editor/DocumentOutline'
import { EditorToolbar } from '@/ui/components/editor/EditorToolbar'
import { FormattingBubbleMenu } from '@/ui/components/editor/FormattingBubbleMenu'
import { GhostBlock, type GhostBlockState } from '@/ui/components/editor/GhostBlock'
import { buildExtensions } from '@/ui/components/editor/extensions'
import { Button } from '@/ui/components/primitives'
import { AI_SKILLS, type AISkillMode } from '@/ui/lib/ai-skills'
import { getAIEngine } from '@/ui/lib/ai-engine'
import { getDocument, renameDocument, saveDocument } from '@/ui/lib/doc-storage'
import { importDocxToHtml } from '@/ui/lib/docx-import'
import { exportDocx } from '@/ui/lib/docx-export'

export function EditorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const docId = searchParams.get('doc') ?? ''

  const [docTitle, setDocTitle] = useState('Untitled')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [ghostState, setGhostState] = useState<GhostBlockState>('streaming')
  const [ghostVisible, setGhostVisible] = useState(false)
  const [ghostPos, setGhostPos] = useState<{ top: number; left: number } | null>(null)
  const [ghostError, setGhostError] = useState('')
  const ghostRangeRef = useRef<{ from: number; to: number } | null>(null)
  const ghostOriginalRef = useRef<string>('')
  const ghostModeRef = useRef<AISkillMode>('insert')
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [customPromptOpen, setCustomPromptOpen] = useState(false)
  const customPromptSelectionRef = useRef('')
  const [modelStatus, setModelStatus] = useState<'unloaded' | 'loading' | 'loaded' | 'error'>(
    getAIEngine().isLoaded() ? 'loaded' : 'unloaded',
  )
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [docxError, setDocxError] = useState('')
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editor = useEditor({
    extensions: buildExtensions(),
    content: '',
    editorProps: {
      attributes: {
        class: 'tiptap prose max-w-none px-8 py-6 focus:outline-none',
      },
    },
  })

  useEffect(() => {
    if (!docId) {
      navigate('/home')
      return
    }
    const doc = getDocument(docId)
    if (!doc) {
      navigate('/home')
      return
    }
    setDocTitle(doc.title)
    if (editor && doc.content) {
      editor.commands.setContent(doc.content)
    }
  }, [docId, editor, navigate])

  const handleSave = useCallback(() => {
    if (!editor || !docId) return
    setSaveStatus('saving')
    const content = editor.getHTML()
    saveDocument(docId, content, docTitle)
    setSaveStatus('saved')
  }, [editor, docId, docTitle])

  useEffect(() => {
    if (!editor) return
    const handleUpdate = () => {
      setSaveStatus('unsaved')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        if (!editor || !docId) return
        const content = editor.getHTML()
        saveDocument(docId, content, docTitle)
        setSaveStatus('saved')
      }, 1000)
    }
    editor.on('update', handleUpdate)
    return () => {
      editor.off('update', handleUpdate)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [editor, docId, docTitle])

  const handleTitleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setDocTitle(e.target.value)
      if (docId) renameDocument(docId, e.target.value)
    },
    [docId],
  )

  const handleExportMarkdown = useCallback(() => {
    if (!editor) return
    const markdown = editor.storage.markdown?.getMarkdown?.() ?? editor.getText()
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${docTitle || 'untitled'}.md`
    a.click()
    URL.revokeObjectURL(url)
    setExportMenuOpen(false)
  }, [editor, docTitle])

  const handleExportDocx = useCallback(async () => {
    if (!editor) return
    setExporting(true)
    setDocxError('')
    setExportMenuOpen(false)
    try {
      const blob = await exportDocx(editor, docTitle)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${docTitle || 'untitled'}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('docx export failed:', err)
      setDocxError(err instanceof Error ? err.message : 'Failed to export .docx.')
    } finally {
      setExporting(false)
    }
  }, [editor, docTitle])

  const handleImportClick = useCallback(() => {
    setDocxError('')
    importFileRef.current?.click()
  }, [])

  const handleImportFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !editor || !docId) return
      if (!/\.docx$/i.test(file.name)) {
        setDocxError('Please select a .docx file.')
        return
      }
      // Confirm before overwriting unsaved content.
      if (saveStatus === 'unsaved') {
        const ok = window.confirm(
          'Importing will replace the current document content. Unsaved changes will be lost. Continue?',
        )
        if (!ok) return
      }
      setImporting(true)
      setDocxError('')
      try {
        const { html, title } = await importDocxToHtml(file)
        // Clear any pending auto-save timer before replacing content,
        // otherwise it would fire with the stale old title and overwrite
        // our explicit save below.
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        editor.commands.setContent(html)
        setDocTitle(title)
        renameDocument(docId, title)
        // Persist imported content immediately with the correct title.
        saveDocument(docId, editor.getHTML(), title)
        setSaveStatus('saved')
      } catch (err) {
        console.error('docx import failed:', err)
        setDocxError(err instanceof Error ? err.message : 'Failed to import .docx file.')
      } finally {
        setImporting(false)
      }
    },
    [editor, docId, saveStatus],
  )

  // Close export menu when clicking outside or on Escape.
  useEffect(() => {
    if (!exportMenuOpen) return
    const handleClick = (e: globalThis.MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleEsc)
    }
  }, [exportMenuOpen])

  const loadModel = useCallback(async () => {
    const engine = getAIEngine()
    if (engine.isLoaded()) {
      setModelStatus('loaded')
      return
    }
    if (modelStatus === 'loading') return
    setModelStatus('loading')
    try {
      await engine.autoLoadModel()
      setModelStatus('loaded')
    } catch (err) {
      console.error('Model load failed:', err)
      setModelStatus('error')
    }
  }, [modelStatus])

  // Auto-load model on mount
  useEffect(() => {
    loadModel()
  }, [loadModel])

  const triggerAISkill = useCallback(
    async (skillId: string, selection: string, context: string) => {
      if (!editor) return

      let skill: (typeof AI_SKILLS)[string] | undefined = AI_SKILLS[skillId]
      let skillContext = context

      if (skillId === 'custom_instruction') {
        skill = {
          id: 'custom_instruction',
          label: 'Custom',
          description: context,
          icon: 'MessageSquare',
          maxTokens: 300,
          temperature: 0.4,
          stop: ['<|im_end|>'],
          needsSelection: true,
          mode: 'replace',
          buildPrompt: (sel, ctx) => ({
            system: `You are an editor. Follow the user's instruction to edit the text. Do not explain. Output only the result.`,
            user: `Instruction: ${ctx}\nText: "${sel}"`,
          }),
        }
        skillContext = context
      }

      if (!skill) return

      if (modelStatus !== 'loaded') {
        await loadModel()
      }

      const engine = getAIEngine()
      if (!engine.isLoaded()) {
        setGhostError('AI model is loading or unavailable. Please wait and try again.')
        setGhostState('error')
        setGhostVisible(true)
        return
      }

      const { from, to } = editor.state.selection
      const originalText = skill.mode === 'replace' ? selection : ''
      ghostModeRef.current = skill.mode
      ghostOriginalRef.current = originalText
      setGhostState('streaming')
      setGhostVisible(true)
      setGhostError('')

      // For replace mode: delete selection immediately so AI text appears in place
      if (skill.mode === 'replace') {
        editor.chain().focus().deleteRange({ from, to }).run()
        ghostRangeRef.current = { from, to: from }
      } else {
        ghostRangeRef.current = { from: to, to: to }
      }

      // Position floating toolbar near the selection
      const coords = editor.view.coordsAtPos(from)
      const editorRect = editor.view.dom.getBoundingClientRect()
      setGhostPos({
        top: coords.bottom - editorRect.top + 4,
        left: coords.left - editorRect.left,
      })

      await engine.runSkill(skill, selection, skillContext, {
        onToken: (token) => {
          // Insert token inline with ghost mark
          if (editor && ghostRangeRef.current) {
            const insertAt = ghostRangeRef.current.to
            editor
              .chain()
              .focus()
              .insertContentAt(insertAt, { type: 'text', text: token }, { updateSelection: false })
              .setTextSelection({ from: insertAt, to: insertAt + token.length })
              .setMark('ghostMark')
              .setTextSelection(insertAt + token.length)
              .run()
            ghostRangeRef.current = {
              from: ghostRangeRef.current.from,
              to: insertAt + token.length,
            }
          }
        },
        onDone: () => {
          setGhostState('done')
        },
        onError: (error) => {
          console.error('AI skill error:', error)
          setGhostError(error)
          setGhostState('error')
        },
      })
    },
    [editor, modelStatus, loadModel],
  )

  useEffect(() => {
    const handleAISkill = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        skillId: string
        selection: string
        context: string
      }
      if (detail.skillId === 'custom_instruction') {
        customPromptSelectionRef.current = detail.selection
        setCustomPrompt('')
        setCustomPromptOpen(true)
        return
      }
      triggerAISkill(detail.skillId, detail.selection, detail.context)
    }
    window.addEventListener('kdoc:ai-skill', handleAISkill)
    return () => window.removeEventListener('kdoc:ai-skill', handleAISkill)
  }, [triggerAISkill])

  const handleGhostAccept = useCallback(() => {
    if (!editor || !ghostRangeRef.current) return
    const { from, to } = ghostRangeRef.current
    // Remove ghost mark - keep the text
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetMark('ghostMark')
      .setTextSelection(to)
      .run()
    setGhostVisible(false)
    ghostRangeRef.current = null
    ghostOriginalRef.current = ''
  }, [editor])

  const handleGhostReject = useCallback(() => {
    if (!editor || !ghostRangeRef.current) {
      setGhostVisible(false)
      return
    }
    const { from, to } = ghostRangeRef.current
    // Delete the ghost text
    editor.chain().focus().deleteRange({ from, to }).run()
    // For replace mode: restore original text
    if (ghostModeRef.current === 'replace' && ghostOriginalRef.current) {
      editor.chain().focus().insertContentAt(from, ghostOriginalRef.current).run()
    }
    setGhostVisible(false)
    ghostRangeRef.current = null
    ghostOriginalRef.current = ''
  }, [editor])

  const handleContinueWriting = useCallback(() => {
    if (!editor) return
    const text = editor.getText()
    const lastWords = text.slice(-200)
    triggerAISkill('continue_writing', '', lastWords)
  }, [editor, triggerAISkill])

  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ' ') {
        e.preventDefault()
        handleContinueWriting()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setAiPanelOpen((prev) => !prev)
      }
      // Ghost block keyboard shortcuts
      if (ghostVisible) {
        if (e.key === 'Tab' && ghostState === 'done') {
          e.preventDefault()
          handleGhostAccept()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          handleGhostReject()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    editor,
    handleSave,
    handleContinueWriting,
    ghostVisible,
    ghostState,
    handleGhostAccept,
    handleGhostReject,
  ])

  // Close AI panel on Escape when no ghost is visible
  useEffect(() => {
    if (!aiPanelOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ghostVisible) {
        e.preventDefault()
        setAiPanelOpen(false)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [aiPanelOpen, ghostVisible])

  const handleCustomPromptSubmit = useCallback(() => {
    const instruction = customPrompt.trim()
    if (!instruction) return
    setCustomPromptOpen(false)
    triggerAISkill('custom_instruction', customPromptSelectionRef.current, instruction)
    setCustomPrompt('')
  }, [customPrompt, triggerAISkill])

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="text-muted hover:bg-surface-2 hover:text-fg rounded p-1 transition-colors"
            aria-label="Back to documents"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <input
            type="text"
            value={docTitle}
            onChange={handleTitleChange}
            className="text-fg hover:bg-surface-2 focus:bg-surface-2 rounded bg-transparent px-2 py-1 text-sm font-medium focus:outline-none"
            placeholder="Untitled"
          />
          <span className="text-muted text-xs">
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {modelStatus === 'loading' && (
            <span className="text-muted flex items-center gap-1.5 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading model...
            </span>
          )}
          {modelStatus === 'loaded' && (
            <span className="text-success flex items-center gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              Smart Ready
            </span>
          )}
          {modelStatus === 'error' && (
            <span className="text-danger text-xs">Model unavailable</span>
          )}
          {docxError && (
            <span className="text-danger text-xs" title={docxError}>
              .docx error
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleImportClick}
            disabled={importing || !editor}
            title="Import a .docx file, replacing the current document"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Import
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleImportFile}
            className="hidden"
          />
          <div className="relative" ref={exportMenuRef}>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleExportDocx()}
                disabled={exporting || !editor}
                title="Export as Word (.docx)"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="h-3.5 w-3.5" />
                )}
                Export
              </Button>
              <button
                type="button"
                onClick={() => setExportMenuOpen((prev) => !prev)}
                disabled={exporting || !editor}
                className="text-muted hover:bg-surface-2 hover:text-fg inline-flex h-8 w-5 items-center justify-center rounded-r-lg transition-colors disabled:opacity-50"
                aria-label="Choose export format"
                title="More export formats"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            {exportMenuOpen && (
              <div className="border-border bg-surface absolute top-full right-0 z-50 mt-1 w-44 rounded-lg border py-1 shadow-lg">
                <button
                  type="button"
                  onClick={handleExportDocx}
                  disabled={exporting}
                  className="text-fg hover:bg-surface-2 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-50"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Word (.docx)
                </button>
                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="text-fg hover:bg-surface-2 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Markdown (.md)
                </button>
              </div>
            )}
          </div>
          <Button
            variant={aiPanelOpen ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setAiPanelOpen((prev) => !prev)}
            title="Writing Tools (Cmd+K)"
          >
            <PanelRight className="h-3.5 w-3.5" />
            Writing
          </Button>
        </div>
      </header>

      <EditorToolbar editor={editor} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="relative mx-auto max-w-5xl">
            <FormattingBubbleMenu editor={editor} />
            <AISelectionMenu editor={editor} onSkillTrigger={triggerAISkill} />
            <EditorContent editor={editor} />
            <DocumentOutline editor={editor} />
            {ghostVisible && (
              <GhostBlock
                state={ghostState}
                position={ghostPos}
                errorMessage={ghostError}
                onAccept={handleGhostAccept}
                onReject={handleGhostReject}
              />
            )}
          </div>
        </div>
        <AIPanel editor={editor} open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} />
      </div>

      {customPromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setCustomPromptOpen(false)}
        >
          <div
            className="border-border bg-surface w-full max-w-md rounded-2xl border p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-fg text-sm font-semibold">Ask AI</h2>
              <button
                type="button"
                onClick={() => setCustomPromptOpen(false)}
                className="text-muted hover:bg-surface-2 hover:text-fg rounded p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              autoFocus
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleCustomPromptSubmit()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setCustomPromptOpen(false)
                }
              }}
              placeholder="What do you want AI to do with the selected text?"
              rows={3}
              className="border-border bg-surface-2 text-fg placeholder:text-muted focus:border-brand w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted text-xs">Enter to submit, Esc to cancel</span>
              <button
                type="button"
                onClick={handleCustomPromptSubmit}
                disabled={!customPrompt.trim()}
                className="bg-brand/10 text-brand hover:bg-brand/20 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
