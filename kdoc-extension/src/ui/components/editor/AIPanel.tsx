import type { Editor } from '@tiptap/react'
import {
  AlignLeft,
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
import { useCallback, useRef, useState } from 'react'

import { getAIEngine } from '@/ui/lib/ai-engine'
import { WORKFLOW_LIST, type AIWorkflowDef } from '@/ui/lib/ai-workflows'
import { cn } from '@/ui/utils'

const WORKFLOW_ICONS: Record<string, LucideIcon> = {
  ListTree,
  PenLine,
  Sparkles,
  Lightbulb,
  Heading,
  Wand2,
  AlignLeft,
}

// --- Markdown → HTML conversion -----------------------------------------

function normalizeMarkdown(md: string): string {
  let text = md
  // Insert a newline before heading markers and numbered list markers that
  // appear mid-line, so the parser can detect them. We do NOT do this for
  // bullet markers (- and *) because `* ` is ambiguous with closing bold/italic
  // markers (e.g. `**bold** ` would be corrupted into `**bold*\n* `).
  // The `#` lookbehind prevents `## ` from being split into `#` + `# `.
  text = text.replace(/(?<![#\n])(#{1,3} )/g, '\n$1')
  text = text.replace(/(?<!\n)(\d+\. )/g, '\n$1')
  // Fix body text concatenated onto a heading line: when a heading line
  // contains a lowercase-to-uppercase transition after the heading text,
  // the uppercase likely starts a new sentence/paragraph that was joined.
  // e.g. `### 1.1 PurposeThe KChat...` → `### 1.1 Purpose\nThe KChat...`
  // Only apply to lines starting with a heading marker, and require at
  // least 5 chars of heading text to avoid false positives on short titles.
  text = text.replace(/^((?:#{1,3} )\S.{5,}?[a-z])([A-Z][a-z])/gm, '$1\n$2')
  return text
}

function inlineMdToHtml(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

function markdownToHtml(md: string): string {
  const lines = normalizeMarkdown(md).split('\n')
  const html: string[] = []
  let inList = false
  let listType: 'ul' | 'ol' | null = null
  let inBlockquote = false

  const closeList = () => {
    if (inList && listType) {
      html.push(`</${listType}>`)
      inList = false
      listType = null
    }
  }
  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push('</blockquote>')
      inBlockquote = false
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line.startsWith('### ')) {
      closeList()
      closeBlockquote()
      html.push(`<h3>${inlineMdToHtml(line.slice(4))}</h3>`)
    } else if (line.startsWith('## ')) {
      closeList()
      closeBlockquote()
      html.push(`<h2>${inlineMdToHtml(line.slice(3))}</h2>`)
    } else if (line.startsWith('# ')) {
      closeList()
      closeBlockquote()
      html.push(`<h1>${inlineMdToHtml(line.slice(2))}</h1>`)
    } else if (/^[-*] /.test(line)) {
      closeBlockquote()
      if (!inList || listType !== 'ul') {
        closeList()
        html.push('<ul>')
        inList = true
        listType = 'ul'
      }
      html.push(`<li><p>${inlineMdToHtml(line.replace(/^[-*] /, ''))}</p></li>`)
    } else if (/^\d+\. /.test(line)) {
      closeBlockquote()
      if (!inList || listType !== 'ol') {
        closeList()
        html.push('<ol>')
        inList = true
        listType = 'ol'
      }
      html.push(`<li><p>${inlineMdToHtml(line.replace(/^\d+\. /, ''))}</p></li>`)
    } else if (/^>\s?/.test(line)) {
      closeList()
      if (!inBlockquote) {
        html.push('<blockquote>')
        inBlockquote = true
      }
      const quoteContent = line.replace(/^>\s?/, '')
      if (quoteContent.trim()) {
        html.push(`<p>${inlineMdToHtml(quoteContent)}</p>`)
      }
    } else if (line.trim() === '') {
      closeList()
      closeBlockquote()
    } else {
      closeList()
      closeBlockquote()
      html.push(`<p>${inlineMdToHtml(line)}</p>`)
    }
  }
  closeList()
  closeBlockquote()
  return html.join('')
}

// --- Continuation support -----------------------------------------------

/**
 * Heuristic: determine if a generation chunk was likely cut off by the
 * max_tokens limit rather than ending naturally.
 *
 * - If the chunk is short relative to maxTokens, the model likely finished.
 * - If the chunk is long AND doesn't end with a sentence/paragraph boundary,
 *   it was likely cut off mid-generation.
 */
function looksCutOff(chunk: string, maxTokens: number): boolean {
  // Rough chars-per-token estimate (English text averages ~4 chars/token).
  const approxTokens = chunk.length / 4
  // If we used less than 60% of the budget, the model likely stopped on its own.
  if (approxTokens < maxTokens * 0.6) return false
  // If the output ends with a clear boundary, likely finished naturally.
  // Boundaries: newline at end, or sentence-ending punctuation + newline.
  const trimmed = chunk.trimEnd()
  if (/[.!?:"|)\]>]\s*$/.test(trimmed) && chunk.endsWith('\n')) return false
  // If it ends with a complete markdown line (newline + no partial word),
  // treat it as likely complete.
  if (chunk.endsWith('\n\n')) return false
  // Otherwise, if we used >60% of the budget, assume cut off.
  return true
}

/**
 * Run a skill with automatic continuation if the generation is cut off by
 * the max_tokens limit. The output from each chunk is streamed to the
 * caller via onToken, and the full stitched output is returned.
 *
 * Up to `maxIterations` continuation rounds are attempted. If a continuation
 * produces an empty or very short response (< 10 chars), the model has
 * nothing more to generate and we stop.
 *
 * onContinuation is called (with the iteration number) when a continuation
 * round starts, so the UI can show a "continuing..." indicator.
 */
async function runWithContinuation(
  engine: ReturnType<typeof getAIEngine>,
  system: string,
  initialUser: string,
  maxTokens: number,
  temperature: number,
  stop: string[] | undefined,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  onContinuation?: (iteration: number) => void,
  maxIterations = 5,
): Promise<void> {
  let fullOutput = ''
  let currentUser = initialUser

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (iteration > 0) onContinuation?.(iteration)

    const chunkOutput = await new Promise<string>((resolve, reject) => {
      let chunk = ''
      engine
        .runSkill(
          {
            id: 'continuation',
            label: 'Continuation',
            description: '',
            icon: 'Sparkles',
            maxTokens,
            temperature,
            stop,
            needsSelection: false,
            mode: 'insert',
            buildPrompt: () => ({ system, user: currentUser }),
          } as never,
          '',
          '',
          {
            onToken: (token) => {
              chunk += token
              onToken(token)
            },
            onDone: () => resolve(chunk),
            onError: (err) => reject(new Error(err)),
          },
        )
        .catch(reject)
    }).catch((err) => {
      onError(err instanceof Error ? err.message : String(err))
      return null
    })

    if (chunkOutput === null) return

    fullOutput += chunkOutput

    // If the continuation produced nothing (or just whitespace), the model
    // has finished naturally — stop.
    if (iteration > 0 && chunkOutput.trim().length < 10) {
      break
    }

    // If the chunk doesn't look cut off, we're done.
    if (!looksCutOff(chunkOutput, maxTokens)) {
      break
    }

    // Prepare continuation prompt with the last 500 chars as context.
    const tail = fullOutput.slice(-500)
    currentUser =
      `Continue from exactly where you stopped. Do not repeat any text you already wrote.\n` +
      `Last 500 characters of your previous output:\n"""\n${tail}\n"""\n` +
      `Continue the document from this point. Output only the continuation:`
  }

  onDone()
}

export interface AIPanelProps {
  editor: Editor | null
  open: boolean
  onClose: () => void
}

export function AIPanel({ editor, open, onClose }: AIPanelProps) {
  const [activeWorkflow, setActiveWorkflow] = useState<AIWorkflowDef | null>(null)
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const [continuationRound, setContinuationRound] = useState(0)
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
      // For whole-document workflows, pass the full text (capped to avoid
      // overflowing the model's context window). For other workflows, pass
      // a short preview as context.
      // For improve_document, pass markdown so the AI can see and preserve
      // existing structure (headings, lists). For format_document, pass plain
      // text since the goal is to reformat from scratch.
      const fullText = workflow.needsFullDocument
        ? workflow.id === 'improve_document'
          ? (editor.storage.markdown?.getMarkdown?.() ?? editor.getText()).slice(0, 6000)
          : editor.getText().slice(0, 6000)
        : editor.getText().slice(0, 500)
      const context = fullText
      const topicText = topic.trim()

      if (workflow.needsTopic && !topicText) {
        setStatus('error')
        setOutput('Please enter a topic above.')
        return
      }

      if (workflow.needsFullDocument && !context.trim()) {
        setStatus('error')
        setOutput('The document is empty. Add some content first.')
        return
      }

      setOutput('')
      setContinuationRound(0)
      setStatus('streaming')

      const { system, user } = workflow.buildPrompt(topicText, selection, context, keywords)

      // For whole-document workflows, use continuation support to overcome
      // the max_tokens limit — the model generates in chunks and we stitch
      // them together. For other workflows, a single call suffices.
      if (workflow.needsFullDocument) {
        await runWithContinuation(
          engine,
          system,
          user,
          workflow.maxTokens,
          workflow.temperature,
          workflow.stop,
          (token) => {
            setOutput((prev) => prev + token)
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight
            }
          },
          () => {
            setStatus('done')
            setContinuationRound(0)
          },
          (err) => {
            setStatus('error')
            setOutput(err)
            setContinuationRound(0)
          },
          (iteration) => setContinuationRound(iteration),
        )
      } else {
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
            buildPrompt: () => ({ system, user }),
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
      }
    },
    [editor, topic, keywords],
  )

  const handleInsert = useCallback(() => {
    if (!editor || !output) return
    const { from } = editor.state.selection
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
    <aside className="border-border bg-surface flex w-72 flex-col border-l">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-fg flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="text-brand h-4 w-4" />
          Writing Tools
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:bg-surface-2 hover:text-fg rounded p-1"
          aria-label="Close AI panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!activeWorkflow ? (
          <div className="space-y-1">
            <p className="text-muted mb-2 text-xs">Choose a workflow:</p>
            {WORKFLOW_LIST.map((wf) => {
              const Icon = WORKFLOW_ICONS[wf.icon] ?? Sparkles
              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => setActiveWorkflow(wf)}
                  className="hover:bg-surface-2 flex w-full items-start gap-2 rounded-lg p-2 text-left transition-colors"
                >
                  <Icon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-fg text-sm font-medium">{wf.label}</span>
                    <span className="text-muted text-xs">{wf.description}</span>
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
                setKeywords('')
              }}
              className="text-muted hover:text-fg text-xs"
            >
              ← Back to workflows
            </button>

            <div>
              <label className="text-fg mb-1 block text-xs font-medium">
                {activeWorkflow.needsTopic
                  ? (activeWorkflow.topicLabel ?? 'Topic / Brief')
                  : activeWorkflow.needsSelection
                    ? 'Selected text will be used'
                    : activeWorkflow.needsFullDocument
                      ? 'Entire document will be processed — use "Replace document" to apply'
                      : 'Document context will be used'}
              </label>
              {activeWorkflow.needsTopic && (
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Enter a topic or brief description..."
                  rows={3}
                  className={cn(
                    'border-border bg-surface text-fg w-full rounded-lg border p-2 text-sm',
                    'placeholder:text-muted focus:border-brand resize-none focus:outline-none',
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

            {activeWorkflow.needsTopic && activeWorkflow.supportsKeywords && (
              <div>
                <label className="text-fg mb-1 block text-xs font-medium">
                  Keywords <span className="text-muted">(optional)</span>
                </label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. onboarding, pricing, API"
                  className={cn(
                    'border-border bg-surface text-fg w-full rounded-lg border p-2 text-sm',
                    'placeholder:text-muted focus:border-brand focus:outline-none',
                  )}
                />
              </div>
            )}

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
                  {continuationRound > 0 ? `Continuing... (${continuationRound})` : 'Generating...'}
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
                  className="border-border bg-surface-2 text-fg max-h-64 overflow-y-auto rounded-lg border p-2 text-sm whitespace-pre-wrap"
                >
                  {output || (status === 'streaming' ? '...' : '')}
                </div>

                {status === 'error' && <p className="text-danger text-xs">{output}</p>}

                {status === 'done' && output && (
                  <div className="flex gap-2">
                    {activeWorkflow.needsFullDocument ? (
                      <>
                        <button
                          type="button"
                          onClick={handleReplaceAll}
                          className="bg-brand/10 text-brand hover:bg-brand/20 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
                        >
                          Replace document
                        </button>
                        <button
                          type="button"
                          onClick={handleInsert}
                          className="bg-surface-2 text-muted hover:bg-surface-3 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
                        >
                          Insert at cursor
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleInsert}
                          className="bg-brand/10 text-brand hover:bg-brand/20 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
                        >
                          Insert at cursor
                        </button>
                        <button
                          type="button"
                          onClick={handleReplaceAll}
                          className="bg-surface-2 text-muted hover:bg-surface-3 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
                        >
                          Replace document
                        </button>
                      </>
                    )}
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
