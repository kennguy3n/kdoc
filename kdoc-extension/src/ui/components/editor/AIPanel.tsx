import type { Editor } from '@tiptap/react'
import {
  Loader2,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import {
  ACTIONS_BY_GROUP,
  GROUP_LABELS,
  GROUP_ORDER,
  extractOutline,
  type AIActionDef,
  type AIActionGroup,
} from '@/ui/lib/ai-actions'
import { getAIEngine } from '@/ui/lib/ai-engine'
import { ACTION_ICONS, DEFAULT_ACTION_ICON } from '@/ui/lib/ai-icons'
import { chunkDocument, extractOutlineContext } from '@/ui/lib/doc-chunking'
import { adaptiveMaxOutput, budgetForContext, truncateContext } from '@/ui/lib/token-budget'
import { cn } from '@/ui/utils'

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
  responsePrefix?: string,
): Promise<void> {
  let fullOutput = ''
  let currentUser = initialUser

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (iteration > 0) onContinuation?.(iteration)

    let wasCutOff = false
    const chunkOutput = await new Promise<string>((resolve, reject) => {
      let chunk = ''
      engine
        .runSkill(
          {
            id: 'continuation',
            label: 'Continuation',
            description: '',
            icon: 'Sparkles',
            group: 'document',
            scope: 'document',
            mode: 'insert',
            maxTokens,
            temperature,
            stop,
            responsePrefix: iteration === 0 ? responsePrefix : undefined,
            buildPrompt: () => ({ system, user: currentUser }),
          },
          '',
          '',
          {
            onToken: (token) => {
              chunk += token
              onToken(token)
            },
            onCutOff: () => {
              wasCutOff = true
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

    // Use the backend's cut-off signal if available; fall back to heuristic.
    const cutOff = wasCutOff || looksCutOff(chunkOutput, maxTokens)
    if (!cutOff) {
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

/**
 * Sectioned generation for long documents: first generates an outline,
 * then writes each section sequentially, stitching results together.
 *
 * This produces more coherent long documents than blind tail-continuation,
 * because each section is written with full outline context and the model
 * focuses on one section at a time.
 */
async function runSectionedGeneration(
  engine: ReturnType<typeof getAIEngine>,
  topic: string,
  keywords: string,
  maxTokens: number,
  temperature: number,
  stop: string[] | undefined,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  onProgress?: (section: number, total: number, heading: string) => void,
): Promise<void> {
  // Step 1: Generate the outline
  const outlineSystem =
    'Generate a document outline as markdown headings (# for title, ## for sections). ' +
    'Use bullet points (-) for key points under each section. Output only the outline.'
  const outlineUser = `Create an outline for: ${topic}${keywords?.trim() ? `\nKeywords to cover: "${keywords}"` : ''}`

  let outline = ''
  let outlineFailed = false
  await new Promise<void>((resolve, reject) => {
    engine.runSkill(
      {
        id: 'outline_gen',
        label: 'Outline',
        description: '',
        icon: 'ListTree',
        group: 'generate',
        scope: 'topic',
        mode: 'insert',
        maxTokens: 800,
        temperature: 0.4,
        stop,
        responsePrefix: '# ',
        buildPrompt: () => ({ system: outlineSystem, user: outlineUser }),
      },
      '',
      '',
      {
        onToken: (token) => {
          outline += token
          onToken(token)
        },
        onDone: resolve,
        onError: (err) => reject(new Error(err)),
      },
    )
  }).catch((err) => {
    onError(err instanceof Error ? err.message : String(err))
    outlineFailed = true
  })

  if (outlineFailed || !outline.trim()) return

  // Step 2: Parse sections from the outline (## headings only)
  const sections = outline
    .split('\n')
    .filter((line) => /^##\s+/.test(line.trim()))
    .map((line) => line.trim().replace(/^##\s+/, ''))

  if (sections.length === 0) {
    onDone()
    return
  }

  // Step 3: Write each section
  for (let i = 0; i < sections.length; i++) {
    const heading = sections[i]
    onProgress?.(i + 1, sections.length, heading)

    // Emit the section heading before its content
    onToken(`\n\n## ${heading}\n\n`)

    const sectionSystem =
      'Write a document section. Cover the key points from the outline. ' +
      'Write 2-4 paragraphs. Output only the content, no heading. ' +
      'Do not repeat content from other sections.'
    const sectionUser =
      `Write the section "${heading}" for a document about: ${topic}\n` +
      `Full outline:\n${outline}`

    let sectionFailed = false
    await new Promise<void>((resolve, reject) => {
      engine.runSkill(
        {
          id: 'section_gen',
          label: 'Section',
          description: '',
          icon: 'PenLine',
          group: 'generate',
          scope: 'topic',
          mode: 'insert',
          maxTokens,
          temperature,
          stop,
          buildPrompt: () => ({ system: sectionSystem, user: sectionUser }),
        },
        '',
        '',
        {
          onToken: (token) => onToken(token),
          onDone: resolve,
          onError: (err) => reject(new Error(err)),
        },
      )
    }).catch((err) => {
      onError(err instanceof Error ? err.message : String(err))
      sectionFailed = true
    })

    if (sectionFailed) return
  }

  onDone()
}

/**
 * Chunked transform for large documents: splits the input into chunks at
 * paragraph/heading boundaries, transforms each chunk independently (with
 * the document outline provided for cross-section awareness), and stitches
 * the results together.
 *
 * Used by improve_document and format_document when the document is too
 * large to fit in the context window in a single pass.
 */
async function runChunkedTransform(
  engine: ReturnType<typeof getAIEngine>,
  system: string,
  documentText: string,
  maxTokens: number,
  temperature: number,
  stop: string[] | undefined,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  onProgress?: (chunk: number, total: number) => void,
): Promise<void> {
  const outline = extractOutline(documentText)
  const outlineLine = outline ? `\nDocument outline (for context):\n${outline}\n` : ''

  // Adaptively size chunks based on outline length so the full request
  // (system + outline + chunk + maxTokens + overhead) fits in 4096 tokens.
  // Base chunk size is 6000 chars; reduce it if the outline is large.
  const chunkInfoOverhead = 80 // "You are processing chunk N of M..." line
  const fullSystemOverhead = system.length + outlineLine.length + chunkInfoOverhead
  const maxChunkChars = Math.max(
    2000,
    Math.min(6000, (4096 - 120 - 80 - maxTokens) * 3 - fullSystemOverhead - 100),
  )
  const chunks = chunkDocument(documentText, maxChunkChars)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    onProgress?.(i + 1, chunks.length)

    const chunkSystem =
      system +
      (outlineLine ? `\n${outlineLine}` : '') +
      `\nYou are processing chunk ${i + 1} of ${chunks.length}. ` +
      `Preserve formatting consistency with the rest of the document.`
    const chunkUser = `Process this section:\n\n${chunk.text}`

    // Per-chunk adaptive maxTokens as a safety net.
    const chunkMaxTokens = adaptiveMaxOutput(chunkSystem, chunk.text, maxTokens, chunkUser)

    let chunkFailed = false
    await new Promise<void>((resolve, reject) => {
      engine.runSkill(
        {
          id: 'chunk_transform',
          label: 'Transform',
          description: '',
          icon: 'Wand2',
          group: 'document',
          scope: 'document',
          mode: 'insert',
          maxTokens: chunkMaxTokens,
          temperature,
          stop,
          buildPrompt: () => ({system: chunkSystem, user: chunkUser}),
        },
        '',
        '',
        {
          onToken: (token) => onToken(token),
          onDone: resolve,
          onError: (err) => reject(new Error(err)),
        },
      )
    }).catch((err) => {
      onError(err instanceof Error ? err.message : String(err))
      chunkFailed = true
    })

    if (chunkFailed) return

    // Add spacing between chunks in the stitched output.
    if (i < chunks.length - 1) {
      onToken('\n\n')
    }
  }

  onDone()
}

/**
 * Map-reduce summarization for large documents: summarizes each chunk
 * independently, then summarizes the chunk summaries into a final summary.
 *
 * This is the standard technique for summarizing documents that exceed the
 * model's context window. The first pass (map) captures key points per chunk;
 * the second pass (reduce) synthesizes them into a coherent summary.
 */
async function runMapReduce(
  engine: ReturnType<typeof getAIEngine>,
  system: string,
  documentText: string,
  maxTokens: number,
  temperature: number,
  stop: string[] | undefined,
  responsePrefix: string | undefined,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  onProgress?: (phase: 'map' | 'reduce', current: number, total: number) => void,
): Promise<void> {
  const chunks = chunkDocument(documentText, 6000)

  // Phase 1 (map): summarize each chunk into bullet points.
  const chunkSummaries: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    onProgress?.('map', i + 1, chunks.length)

    let summary = ''
    let failed = false
    await new Promise<void>((resolve, reject) => {
      engine.runSkill(
        {
          id: 'chunk_summarize',
          label: 'Summarize',
          description: '',
          icon: 'FileText',
          group: 'extract',
          scope: 'document',
          mode: 'insert',
          maxTokens: 200,
          temperature,
          stop,
          responsePrefix: '- ',
          buildPrompt: () => ({
            system: 'Summarize the key points of this section in 2-3 bullet points (- ). Output only the bullets.',
            user: chunk.text,
          }),
        },
        '',
        '',
        {
          onToken: (token) => {
            summary += token
          },
          onDone: resolve,
          onError: (err) => reject(new Error(err)),
        },
      )
    }).catch((err) => {
      onError(err instanceof Error ? err.message : String(err))
      failed = true
    })

    if (failed) return
    chunkSummaries.push(summary.trim())
  }

  // Phase 2 (reduce): synthesize chunk summaries into a final summary.
  // If the combined summaries are too large for a single reduce pass, use
  // hierarchical reduce: reduce in batches, then reduce the batch results.
  onProgress?.('reduce', 1, 1)
  let combined = chunkSummaries.join('\n')

  // Budget check: system (~40 tok) + wrapper (~40 tok) + maxTokens + overhead (200)
  // leaves ~3700 tokens for combined. At 3 chars/token, that's ~11100 chars.
  const maxCombinedChars = (4096 - 120 - 80 - 80 - 80 - maxTokens) * 3
  if (combined.length > maxCombinedChars) {
    // Hierarchical reduce: batch summaries, reduce each batch, then combine.
    const batchSize = Math.max(1, Math.floor(chunkSummaries.length / Math.ceil(combined.length / maxCombinedChars)))
    const batchResults: string[] = []
    for (let b = 0; b < chunkSummaries.length; b += batchSize) {
      const batch = chunkSummaries.slice(b, b + batchSize).join('\n')
      let batchResult = ''
      let batchFailed = false
      await new Promise<void>((resolve, reject) => {
        engine.runSkill(
          {
            id: 'batch_reduce',
            label: 'Summarize',
            description: '',
            icon: 'FileText',
            group: 'extract',
            scope: 'document',
            mode: 'insert',
            maxTokens: 200,
            temperature,
            stop,
            responsePrefix: '- ',
            buildPrompt: () => ({
              system: 'Combine these key points into a concise summary. Keep the most important points. Output only bullet points (- ).',
              user: batch,
            }),
          },
          '',
          '',
          {
            onToken: (token) => {
              batchResult += token
            },
            onDone: resolve,
            onError: (err) => reject(new Error(err)),
          },
        )
      }).catch((err) => {
        onError(err instanceof Error ? err.message : String(err))
        batchFailed = true
      })
      if (batchFailed) return
      batchResults.push(batchResult.trim())
    }
    combined = batchResults.join('\n')
  }

  // Final truncate as a safety net.
  combined = truncateContext(combined, maxCombinedChars)

  await new Promise<void>((resolve, reject) => {
    engine.runSkill(
      {
        id: 'reduce_summarize',
        label: 'Summarize',
        description: '',
        icon: 'FileText',
        group: 'extract',
        scope: 'document',
        mode: 'insert',
        maxTokens,
        temperature,
        stop,
        responsePrefix,
        buildPrompt: () => ({
          system,
          user: `These are key points from different sections of a document. ` +
            `Synthesize them into a coherent summary.\n\n${combined}`,
        }),
      },
      '',
      '',
      {
        onToken: (token) => onToken(token),
        onDone: resolve,
        onError: (err) => reject(new Error(err)),
      },
    )
  }).catch((err) => {
    onError(err instanceof Error ? err.message : String(err))
    return
  })

  onDone()
}

export interface AIPanelProps {
  editor: Editor | null
  open: boolean
  onClose: () => void
}

export function AIPanel({ editor, open, onClose }: AIPanelProps) {
  const [activeAction, setActiveAction] = useState<AIActionDef | null>(null)
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const [continuationRound, setContinuationRound] = useState(0)
  const outputRef = useRef<HTMLDivElement>(null)

  const handleRun = useCallback(
    async (action: AIActionDef) => {
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

      const topicText = topic.trim()
      const hasSelection = editor.state.selection.from !== editor.state.selection.to
      const selection = hasSelection
        ? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
        : ''

      // Determine the input to buildPrompt based on scope.
      // For selection scope: input = selection text.
      // For topic scope: input = topic text.
      // For document scope: input = '' (context is the document).
      const input = action.scope === 'selection' ? selection : action.scope === 'topic' ? topicText : ''

      // Build the system prompt first to calculate the context budget.
      // We also need the user-prompt wrapper (the part of the user prompt that
      // is NOT the variable context) to account for its token overhead.
      const { system: promptSystem, user: promptUserEmpty } = action.buildPrompt(input, '', keywords)
      const maxContextChars = budgetForContext(promptSystem, action.maxTokens, promptUserEmpty)

      // Determine the raw document text to use as context.
      // - Outline-context actions (suggest_title, write_intro, write_conclusion):
      //   use a compact outline + first-sentence-per-section. Scales to any size.
      // - Full-document actions (improve/format/summarize_document): use the
      //   full text. For large docs, chunked/map-reduce strategies handle it.
      // - Selection actions: no document context needed in the panel.
      let rawText: string
      if (action.useOutlineContext) {
        const fullDoc = editor.getText()
        rawText = extractOutlineContext(fullDoc)
      } else if (action.needsFullDocument) {
        rawText = action.id === 'improve_document'
          ? editor.storage.markdown?.getMarkdown?.() ?? editor.getText()
          : editor.getText()
      } else if (action.scope === 'selection') {
        rawText = '' // selection actions don't need document context in the panel
      } else {
        rawText = editor.getText()
      }

      // For full-document transform actions, check if the doc needs chunking.
      // If it fits in the context budget, use the single-pass path. If not,
      // use chunked transform (improve/format) or map-reduce (summarize).
      const needsChunking =
        action.needsFullDocument &&
        !action.useOutlineContext &&
        rawText.length > maxContextChars

      // For the chunked/map-reduce paths, we pass the full untruncated text
      // to the strategy function. For the single-pass path, truncate.
      const context = needsChunking ? rawText : truncateContext(rawText, maxContextChars)

      if (action.needsTopic && !topicText) {
        setStatus('error')
        setOutput('Please enter a topic above.')
        return
      }

      if (action.scope === 'selection' && !selection.trim()) {
        setStatus('error')
        setOutput('Select text in the document first, then run this action.')
        return
      }

      if (action.needsFullDocument && !context.trim()) {
        setStatus('error')
        setOutput('The document is empty. Add some content first.')
        return
      }

      // Adaptively reduce maxTokens for document-scoped single-pass actions so
      // the full context fits. The continuation mechanism handles the rest.
      // Chunked/map-reduce paths manage their own token budgets per chunk.
      let effectiveMaxTokens = action.maxTokens
      if (action.scope === 'document' && !needsChunking && context) {
        effectiveMaxTokens = adaptiveMaxOutput(
          promptSystem,
          context,
          action.maxTokens,
          promptUserEmpty,
        )
      }

      setContinuationRound(0)
      setStatus('streaming')

      const { system, user, responsePrefix: dynamicPrefix } = action.buildPrompt(input, needsChunking ? '' : context, keywords)
      const responsePrefix = dynamicPrefix ?? action.responsePrefix

      // Dispatch strategy:
      //   generate_document       -> sectioned generation (outline -> per-section)
      //   summarize_document      -> map-reduce (if large) or single-pass
      //   improve/format_document -> chunked transform (if large) or continuation
      //   outline-context actions -> single-pass (context is compact)
      //   everything else         -> single run
      if (action.id === 'generate_document') {
        await runSectionedGeneration(
          engine,
          topicText,
          keywords,
          action.maxTokens,
          action.temperature,
          action.stop,
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
          (section, _total, _heading) => {
            setContinuationRound(section)
          },
        )
      } else if (action.id === 'summarize_document' && needsChunking) {
        await runMapReduce(
          engine,
          system,
          context,
          action.maxTokens,
          action.temperature,
          action.stop,
          responsePrefix,
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
          (phase, current, total) => {
            setContinuationRound(phase === 'map' ? current : total + 1)
          },
        )
      } else if ((action.id === 'improve_document' || action.id === 'format_document') && needsChunking) {
        await runChunkedTransform(
          engine,
          system,
          context,
          effectiveMaxTokens,
          action.temperature,
          action.stop,
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
          (chunk) => setContinuationRound(chunk),
        )
      } else if (action.scope === 'document') {
        await runWithContinuation(
          engine,
          system,
          user,
          effectiveMaxTokens,
          action.temperature,
          action.stop,
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
          5,
          responsePrefix,
        )
      } else {
        await engine.runSkill(
          {
            id: action.id,
            label: action.label,
            description: action.description,
            icon: action.icon,
            group: action.group,
            scope: action.scope,
            mode: 'insert',
            maxTokens: action.maxTokens,
            temperature: action.temperature,
            stop: action.stop,
            responsePrefix,
            buildPrompt: () => ({ system, user }),
          },
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
        {!activeAction ? (
          <div className="space-y-3">
            {GROUP_ORDER.map((group: AIActionGroup) => {
              const actions = ACTIONS_BY_GROUP[group]
              if (actions.length === 0) return null
              return (
                <div key={group} className="space-y-1">
                  <p className="text-muted px-1 text-xs font-semibold uppercase tracking-wide">
                    {GROUP_LABELS[group]}
                  </p>
                  {actions.map((action) => {
                    const Icon = ACTION_ICONS[action.icon] ?? DEFAULT_ACTION_ICON
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => setActiveAction(action)}
                        className="hover:bg-surface-2 flex w-full items-start gap-2 rounded-lg p-2 text-left transition-colors"
                      >
                        <Icon className="text-brand mt-0.5 h-4 w-4 shrink-0" />
                        <div className="flex flex-col">
                          <span className="text-fg text-sm font-medium">{action.label}</span>
                          <span className="text-muted text-xs">{action.description}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setActiveAction(null)
                setOutput('')
                setStatus('idle')
                setKeywords('')
              }}
              className="text-muted hover:text-fg text-xs"
            >
              &larr; Back to actions
            </button>

            <div>
              <label className="text-fg mb-1 block text-xs font-medium">
                {activeAction.needsTopic
                  ? (activeAction.topicLabel ?? 'Topic / Brief')
                  : activeAction.scope === 'selection'
                    ? 'Selected text will be used'
                    : activeAction.needsFullDocument
                      ? 'Entire document will be processed - use "Replace document" to apply'
                      : 'Document context will be used'}
              </label>
              {activeAction.needsTopic && (
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
                      handleRun(activeAction)
                    }
                  }}
                />
              )}
            </div>

            {activeAction.needsTopic && activeAction.supportsKeywords && (
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
              onClick={() => handleRun(activeAction)}
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
                    {activeAction.needsFullDocument ? (
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
