/**
 * Document chunking utilities for large-document AI processing.
 *
 * When a document is too large to fit in the model's context window, we split
 * it into coherent chunks at paragraph/heading boundaries, process each chunk
 * independently, and stitch the results together.
 *
 * Chunk boundaries are chosen to preserve semantic coherence:
 *   1. Prefer splitting at heading boundaries (## or #)
 *   2. Fall back to paragraph boundaries (blank line)
 *   3. Never split mid-paragraph unless a single paragraph exceeds the budget
 */

import {extractOutline} from './ai-actions'

export interface DocChunk {
  text: string
  /** 1-based index of this chunk in the document. */
  index: number
  /** Total number of chunks. */
  total: number
}

/**
 * Split a document into chunks of at most `maxChars` characters, preferring
 * to break at heading or paragraph boundaries.
 */
export function chunkDocument(text: string, maxChars = 6000): DocChunk[] {
  if (text.length <= maxChars) {
    return [{text, index: 1, total: 1}]
  }

  // Split into blocks at heading boundaries first, then at paragraph boundaries.
  // A "block" is either a heading line + its following content, or a standalone
  // paragraph. We split the raw text on blank lines, then group heading-led
  // blocks with the blocks that follow them until we approach the limit.
  const blocks = splitIntoBlocks(text)
  const chunks: string[] = []
  let current = ''

  for (const block of blocks) {
    if (current.length + block.length + 2 > maxChars && current) {
      chunks.push(current)
      current = block
    } else if (block.length > maxChars) {
      // Single block exceeds budget — split at sentence boundaries.
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (const piece of splitLongBlock(block, maxChars)) {
        chunks.push(piece)
      }
    } else {
      current = current ? current + '\n\n' + block : block
    }
  }
  if (current) chunks.push(current)

  return chunks.map((text, i) => ({text, index: i + 1, total: chunks.length}))
}

/**
 * Split text into blocks: heading + following paragraphs, or standalone
 * paragraphs. A heading starts a new block; subsequent non-heading paragraphs
 * attach to the current block until the next heading or end.
 */
function splitIntoBlocks(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let inHeadingGroup = false

  const flush = () => {
    if (current.length) {
      blocks.push(current.join('\n').trim())
      current = []
    }
  }

  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line.trim())
    if (isHeading) {
      flush()
      current.push(line)
      inHeadingGroup = true
    } else if (line.trim() === '' && inHeadingGroup) {
      // Blank line within a heading group — keep accumulating paragraphs.
      current.push(line)
    } else if (line.trim() === '') {
      // Blank line outside a heading group — paragraph boundary.
      flush()
      inHeadingGroup = false
    } else {
      current.push(line)
    }
  }
  flush()
  return blocks.filter((b) => b.length > 0)
}

/**
 * Split a single long block (no heading/paragraph boundaries) at sentence
 * boundaries, targeting ~maxChars per piece.
 */
function splitLongBlock(block: string, maxChars: number): string[] {
  const sentences = block.match(/[^.!?]+[.!?]+\s*/g) ?? [block]
  const pieces: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current) {
      pieces.push(current.trim())
      current = sentence
    } else {
      current += sentence
    }
  }
  if (current.trim()) pieces.push(current.trim())

  // If a single sentence exceeds maxChars, hard-split it.
  const result: string[] = []
  for (const piece of pieces) {
    if (piece.length <= maxChars) {
      result.push(piece)
    } else {
      for (let i = 0; i < piece.length; i += maxChars - 3) {
        const slice = piece.slice(i, i + maxChars - 3)
        result.push(i + maxChars - 3 < piece.length ? slice + '...' : slice)
      }
    }
  }
  return result
}

/**
 * Build a compact outline-based context for actions that only need document
 * structure (suggest_title, write_intro, write_conclusion).
 *
 * Returns the heading outline plus the first sentence of each section, which
 * is typically enough for the model to understand the document's topic and
 * flow without needing the full text.
 */
export function extractOutlineContext(text: string, maxChars = 2000): string {
  const outline = extractOutline(text)
  if (!outline) return text.slice(0, maxChars)

  // Extract first sentence after each heading.
  const sections = text.split(/^#{1,6}\s+/m)
  const summaries: string[] = []
  const headings = outline.split('\n')

  for (let i = 1; i < sections.length && i <= headings.length; i++) {
    const raw = sections[i] ?? ''
    // The split removes the heading marker but keeps the heading title text
    // as the first line. Skip it to get to the actual section body.
    // If there's no newline, the section has no body (just the heading title).
    const newlineIdx = raw.indexOf('\n')
    if (newlineIdx < 0) continue
    const body = raw.slice(newlineIdx + 1).trim()
    if (!body) continue
    const firstSentence = body.match(/^([^.!?\n]{10,200}[.!?])/)?.[1] ?? body.slice(0, 120)
    summaries.push(`${headings[i - 1]}\n  ${firstSentence.trim()}`)
  }

  const result = summaries.join('\n\n')
  return result.length > maxChars ? result.slice(0, maxChars - 3) + '...' : result
}
