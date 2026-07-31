import type {Editor} from '@tiptap/react'
import {
  Heading,
  Lightbulb,
  ListTree,
  Loader2,
  PenLine,
  Sparkles,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react'
import {useCallback, useRef, useState} from 'react'

import {getAIEngine} from '@/ui/lib/ai-engine'
import {WORKFLOW_LIST, type AIWorkflowDef} from '@/ui/lib/ai-workflows'
import {cn} from '@/ui/utils'

const WORKFLOW_ICONS: Record<string, LucideIcon> = {
  ListTree,
  PenLine,
  Sparkles,
  Lightbulb,
  Heading,
  Wand2,
}

function normalizeMarkdown(md: string): string {
  let text = md
  text = text.replace(/(?<!\n)(#{1,3} )/g, '\n$1')
  text = text.replace(/(?<!\n)([-*] )/g, '\n$1')
  text = text.replace(/(?<!\n)(\d+\. )/g, '\n$1')
  return text
}

function inlineMdToHtml(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function markdownToHtml(md: string): string {
  const lines = normalizeMarkdown(md).split('\n')
  const html: string[] = []
  let inList = false
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (inList && listType) {
      html.push(`</${listType}>`)
      inList = false
      listType = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line.startsWith('### ')) {
      closeList()
      html.push(`<h3>${inlineMdToHtml(line.slice(4))}</h3>`)
    } else if (line.startsWith('## ')) {
      closeList()
      html.push(`<h2>${inlineMdToHtml(line.slice(3))}</h2>`)
    } else if (line.startsWith('# ')) {
      closeList()
      html.push(`<h1>${inlineMdToHtml(line.slice(2))}</h1>`)
    } else if (/^[-*] /.test(line)) {
      if (!inList || listType !== 'ul') {
        closeList()
        html.push('<ul>')
        inList = true
        listType = 'ul'
      }
      html.push(`<li><p>${inlineMdToHtml(line.replace(/^[-*] /, ''))}</p></li>`)
    } else if (/^\d+\. /.test(line)) {
      if (!inList || listType !== 'ol') {
        closeList()
        html.push('<ol>')
        inList = true
        listType = 'ol'
      }
      html.push(`<li><p>${inlineMdToHtml(line.replace(/^\d+\. /, ''))}</p></li>`)
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      html.push(`<p>${inlineMdToHtml(line)}</p>`)
    }
  }
  closeList()
  return html.join('')
}

export interface AIPanelProps {
  editor: Editor | null
  open: boolean
  onClose: () => void
}

export function AIPanel({editor, open, onClose}: AIPanelProps) {
  const [activeWorkflow, setActiveWorkflow] = useState<AIWorkflowDef | null>(null)
  const [topic, setTopic] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const outputRef = useRef<HTMLDivElement>(null)

  const handleRun = useCallback(
    async (workflow: AIWorkflowDef) => {
      if (!editor) return
      const engine = getAIEngine()
      if (!engine.isLoaded()) {
        setStatus('streaming')
        setOutput('Loading AI model...')
        try {
          await engine.autoLoadModel()
        } catch (err) {
          setStatus('error')
          setOutput(err instanceof Error ? err.message : String(err))
          return
        }
        if (!engine.isLoaded()) {
          setStatus('error')
          setOutput('Failed to load AI model.')
          return
        }
      }
      setOutput('')

      const selection = workflow.needsSelection
        ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
        : ''
      const context = editor.getText().slice(0, 500)
      const topicText = topic.trim()

      if (workflow.needsTopic && !topicText) {
        setStatus('error')
        setOutput('Please enter a topic above.')
        return
      }

      setOutput('')
      setStatus('streaming')

      const {system, user} = workflow.buildPrompt(topicText, selection, context)

      await engine.runSkill(
        {
          id: workflow.id,
          label: workflow.label,
          description: workflow.description,
          icon: workflow.icon,
          maxTokens: workflow.maxTokens,
          temperature: workflow.temperature,
          stop: workflow.stop,
          needsSelection: workflow.needsSelection,
          mode: 'insert',
          buildPrompt: () => ({system, user}),
        } as never,
        selection,
        context,
        {
          onToken: (token) => {
            setOutput((prev) => prev + token)
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight
            }
          },
          onDone: () => setStatus('done'),
          onError: (err) => {
            setStatus('error')
            setOutput(err)
          },
        },
      )
    },
    [editor, topic],
  )

  const handleInsert = useCallback(() => {
    if (!editor || !output) return
    const {from} = editor.state.selection
    editor.chain().focus().insertContentAt(from, markdownToHtml(output)).run()
    onClose()
  }, [editor, output, onClose])

  const handleReplaceAll = useCallback(() => {
    if (!editor || !output) return
    editor.chain().focus().setContent(markdownToHtml(output)).run()
    onClose()
  }, [editor, output, onClose])

  if (!open) return null

  return (
    <aside className="flex w-72 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Sparkles className="h-4 w-4 text-brand" />
          Writing Tools
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Close AI panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!activeWorkflow ? (
          <div className="space-y-1">
            <p className="mb-2 text-xs text-muted">Choose a workflow:</p>
            {WORKFLOW_LIST.map((wf) => {
              const Icon = WORKFLOW_ICONS[wf.icon] ?? Sparkles
              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => setActiveWorkflow(wf)}
                  className="flex w-full items-start gap-2 rounded-lg p-2 text-left transition-colors hover:bg-surface-2"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-fg">{wf.label}</span>
                    <span className="text-xs text-muted">{wf.description}</span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setActiveWorkflow(null)
                setOutput('')
                setStatus('idle')
              }}
              className="text-xs text-muted hover:text-fg"
            >
              ← Back to workflows
            </button>

            <div>
              <label className="mb-1 block text-xs font-medium text-fg">
                {activeWorkflow.needsTopic
                  ? 'Topic / Brief'
                  : activeWorkflow.needsSelection
                    ? 'Selected text will be used'
                    : 'Document context will be used'}
              </label>
              {activeWorkflow.needsTopic && (
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Enter a topic or brief description..."
                  rows={3}
                  className={cn(
                    'w-full rounded-lg border border-border bg-surface p-2 text-sm text-fg',
                    'placeholder:text-muted focus:border-brand focus:outline-none resize-none',
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleRun(activeWorkflow)
                    }
                  }}
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => handleRun(activeWorkflow)}
              disabled={status === 'streaming'}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                status === 'streaming'
                  ? 'bg-surface-2 text-muted'
                  : 'bg-brand/10 text-brand hover:bg-brand/20',
              )}
            >
              {status === 'streaming' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Run
                </>
              )}
            </button>

            {(output || status !== 'idle') && (
              <div className="space-y-2">
                <div
                  ref={outputRef}
                  className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2 text-sm text-fg whitespace-pre-wrap"
                >
                  {output || (status === 'streaming' ? '...' : '')}
                </div>

                {status === 'error' && (
                  <p className="text-xs text-danger">{output}</p>
                )}

                {status === 'done' && output && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleInsert}
                      className="flex-1 rounded-md bg-brand/10 px-2 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20"
                    >
                      Insert at cursor
                    </button>
                    <button
                      type="button"
                      onClick={handleReplaceAll}
                      className="flex-1 rounded-md bg-surface-2 px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-3"
                    >
                      Replace document
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
