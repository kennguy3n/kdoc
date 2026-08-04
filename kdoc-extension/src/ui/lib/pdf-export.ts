import type {Editor} from '@tiptap/react'
import type {Node as ProseMirrorNode} from '@tiptap/pm/model'
import {jsPDF} from 'jspdf'

interface PdfContext {
  list: {type: 'bullet' | 'ordered'; level: number; counter: number[]} | null
  blockquote: boolean
}

interface TextSegment {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  code: boolean
  link?: string
}

// Page layout constants (in points; 1pt = 1/72 inch).
const PAGE_MARGIN = 72 // 1 inch
const HEADING_SIZES: Record<number, number> = {1: 20, 2: 15, 3: 13, 4: 12, 5: 11, 6: 11}
const BODY_SIZE = 11
const CODE_SIZE = 10
const LINE_HEIGHT = 1.35
const LIST_INDENT = 20
const BLOCKQUOTE_INDENT = 20

interface RenderState {
  y: number
  doc: jsPDF
  pageHeight: number
  margin: number
  contentWidth: number
}

/**
 * Convert the editor's ProseMirror document into a PDF Blob.
 *
 * Walks the doc tree and renders each node using jsPDF's text APIs.
 * Handles headings, paragraphs, lists, blockquotes, code blocks, tables,
 * images, and horizontal rules. Inline marks (bold, italic, underline,
 * strike, code, link) are applied per text segment.
 */
export async function exportPdf(editor: Editor, title: string): Promise<Blob> {
  const doc = new jsPDF({unit: 'pt', format: 'letter'})
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = PAGE_MARGIN
  const contentWidth = pageWidth - margin * 2

  const state: RenderState = {y: margin, doc, pageHeight, margin, contentWidth}

  // Render the document title as an H1 if the first node isn't already one.
  const firstChild = editor.state.doc.firstChild
  const hasH1 = firstChild && firstChild.type.name === 'heading' && firstChild.attrs.level === 1
  if (title && !hasH1) {
    renderLine(state, [{text: title, bold: true, italic: false, underline: false, strike: false, code: false}], HEADING_SIZES[1])
    state.y += 6
  }

  const ctx: PdfContext = {list: null, blockquote: false}
  renderBlockNodes(editor.state.doc, ctx, state)

  return doc.output('blob')
}

function ensureSpace(state: RenderState, needed: number) {
  if (state.y + needed > state.pageHeight - state.margin) {
    state.doc.addPage()
    state.y = state.margin
  }
}

function renderBlockNodes(node: ProseMirrorNode, ctx: PdfContext, state: RenderState) {
  node.forEach((child) => {
    renderBlock(child, ctx, state)
  })
}

function renderBlock(node: ProseMirrorNode, ctx: PdfContext, state: RenderState) {
  switch (node.type.name) {
    case 'paragraph':
      renderParagraph(node, ctx, state)
      break
    case 'heading':
      renderHeading(node, ctx, state)
      break
    case 'bulletList':
      renderList(node, ctx, 'bullet', state)
      break
    case 'orderedList':
      renderList(node, ctx, 'ordered', state)
      break
    case 'taskList':
      renderTaskList(node, ctx, state)
      break
    case 'blockquote':
      renderBlockquote(node, ctx, state)
      break
    case 'codeBlock':
      renderCodeBlock(node, state)
      break
    case 'horizontalRule':
      renderHorizontalRule(state)
      break
    case 'image':
      renderImage(node, state)
      break
    case 'table':
      renderTable(node, ctx, state)
      break
    case 'hardBreak':
      state.y += BODY_SIZE * LINE_HEIGHT
      break
    default:
      if (node.textContent.trim()) {
        renderParagraph(node, ctx, state)
      }
  }
}

function renderParagraph(node: ProseMirrorNode, ctx: PdfContext, state: RenderState) {
  const segments = collectInline(node)
  const indent = getIndent(ctx)
  renderLine(state, segments, BODY_SIZE, indent, ctx.blockquote)
  state.y += 4
}

function renderHeading(node: ProseMirrorNode, ctx: PdfContext, state: RenderState) {
  const level = (node.attrs.level as number) ?? 2
  const size = HEADING_SIZES[level] ?? HEADING_SIZES[6]
  const segments = collectInline(node)
  state.y += size * 0.4
  renderLine(state, segments, size, getIndent(ctx))
  state.y += 6
}

function renderList(node: ProseMirrorNode, ctx: PdfContext, type: 'bullet' | 'ordered', state: RenderState) {
  const parentList = ctx.list
  const level = parentList?.type === type ? parentList.level + 1 : 0
  let counter = 0

  node.forEach((child) => {
    if (child.type.name === 'listItem') {
      counter++
      ctx.list = {type, level, counter: [...(parentList?.counter ?? []), counter]}
      child.forEach((itemChild) => {
        renderBlock(itemChild, ctx, state)
      })
    }
  })
  ctx.list = parentList
}

function renderTaskList(node: ProseMirrorNode, ctx: PdfContext, state: RenderState) {
  const parentList = ctx.list
  const level = parentList?.type === 'bullet' ? parentList.level + 1 : 0

  node.forEach((child) => {
    if (child.type.name === 'taskItem') {
      const checked = Boolean(child.attrs.checked)
      const prefix = checked ? '\u2611 ' : '\u2610 '
      ctx.list = {type: 'bullet', level, counter: [...(parentList?.counter ?? [])]}
      child.forEach((itemChild) => {
        if (itemChild.type.name === 'paragraph') {
          const segments = collectInline(itemChild)
          const indent = level * LIST_INDENT
          renderLine(state, [{text: prefix, bold: false, italic: false, underline: false, strike: false, code: false}, ...segments], BODY_SIZE, indent)
          state.y += 4
        } else {
          renderBlock(itemChild, ctx, state)
        }
      })
    }
  })
  ctx.list = parentList
}

function renderBlockquote(node: ProseMirrorNode, ctx: PdfContext, state: RenderState) {
  const prevBlockquote = ctx.blockquote
  ctx.blockquote = true
  node.forEach((child) => {
    renderBlock(child, ctx, state)
  })
  ctx.blockquote = prevBlockquote
}

function renderCodeBlock(node: ProseMirrorNode, state: RenderState) {
  const text = node.textContent
  const lines = text.split('\n')
  const indent = 0

  for (const line of lines) {
    ensureSpace(state, CODE_SIZE * LINE_HEIGHT + 4)
    // Draw light gray background for code.
    const bgY = state.y - CODE_SIZE * 0.8
    const bgH = CODE_SIZE * LINE_HEIGHT + 2
    state.doc.setFillColor(244, 244, 244)
    state.doc.rect(state.margin + indent, bgY, state.contentWidth - indent, bgH, 'F')
    state.doc.setFont('courier', 'normal')
    state.doc.setFontSize(CODE_SIZE)
    state.doc.setTextColor(30, 30, 30)
    state.doc.text(line, state.margin + indent + 4, state.y)
    state.y += CODE_SIZE * LINE_HEIGHT
  }
  state.y += 4
}

function renderHorizontalRule(state: RenderState) {
  ensureSpace(state, 12)
  state.y += 4
  state.doc.setDrawColor(200, 200, 200)
  state.doc.setLineWidth(0.5)
  state.doc.line(state.margin, state.y, state.margin + state.contentWidth, state.y)
  state.y += 8
}

function renderImage(node: ProseMirrorNode, state: RenderState) {
  const src = (node.attrs.src as string) || ''
  const decoded = decodeDataUri(src)
  if (!decoded) {
    const alt = (node.attrs.alt as string) || ''
    const placeholder = alt ? `[Image: ${alt}]` : '[Image]'
    renderLine(state, [{text: placeholder, bold: false, italic: true, underline: false, strike: false, code: false}], BODY_SIZE, 0)
    state.y += 4
    return
  }

  const widthPx = parsePx(node.attrs.width, 400)
  const heightPx = parsePx(node.attrs.height, 300)
  // Scale to fit content width.
  const maxW = state.contentWidth
  const scale = Math.min(1, maxW / widthPx)
  const w = widthPx * scale
  const h = heightPx * scale

  ensureSpace(state, h + 8)
  try {
    state.doc.addImage(decoded.data, decoded.format, state.margin, state.y, w, h)
  } catch {
    renderLine(state, [{text: '[Image: failed to render]', bold: false, italic: true, underline: false, strike: false, code: false}], BODY_SIZE, 0)
  }
  state.y += h + 8
}

function renderTable(node: ProseMirrorNode, _ctx: PdfContext, state: RenderState) {
  const rows: {cells: ProseMirrorNode[]; isHeader: boolean}[] = []
  let maxCols = 0

  node.forEach((rowNode) => {
    if (rowNode.type.name !== 'tableRow') return
    const cells: ProseMirrorNode[] = []
    rowNode.forEach((cellNode) => {
      if (cellNode.type.name === 'tableCell' || cellNode.type.name === 'tableHeader') {
        cells.push(cellNode)
      }
    })
    const isHeader = cells.length > 0 && cells.every((c) => c.type.name === 'tableHeader')
    rows.push({cells, isHeader})
    maxCols = Math.max(maxCols, cells.length)
  })

  if (rows.length === 0 || maxCols === 0) return

  const colWidth = state.contentWidth / maxCols

  for (const row of rows) {
    // Calculate row height by measuring cell content.
    let rowHeight = BODY_SIZE * LINE_HEIGHT + 6
    const cellTexts: string[][] = []

    for (const cell of row.cells) {
      const segments = collectInline(cell)
      const text = segments.map((s) => s.text).join('')
      // Split text to fit column width.
      state.doc.setFont('helvetica', row.isHeader ? 'bold' : 'normal')
      state.doc.setFontSize(BODY_SIZE)
      const lines = state.doc.splitTextToSize(text, colWidth - 8) as string[]
      cellTexts.push(lines)
      rowHeight = Math.max(rowHeight, lines.length * BODY_SIZE * LINE_HEIGHT + 6)
    }

    ensureSpace(state, rowHeight)

    // Draw cell borders and backgrounds.
    for (let i = 0; i < row.cells.length; i++) {
      const x = state.margin + i * colWidth
      state.doc.setDrawColor(220, 220, 220)
      state.doc.setLineWidth(0.5)
      state.doc.rect(x, state.y, colWidth, rowHeight)
      if (row.isHeader) {
        state.doc.setFillColor(238, 238, 238)
        state.doc.rect(x, state.y, colWidth, rowHeight, 'F')
      }
      // Draw cell text.
      state.doc.setFont('helvetica', row.isHeader ? 'bold' : 'normal')
      state.doc.setFontSize(BODY_SIZE)
      state.doc.setTextColor(30, 30, 30)
      const lines = cellTexts[i] ?? ['']
      lines.forEach((line, li) => {
        state.doc.text(line, x + 4, state.y + BODY_SIZE + 2 + li * BODY_SIZE * LINE_HEIGHT)
      })
    }

    state.y += rowHeight
  }
  state.y += 4
}

// --- Inline text rendering ---------------------------------------------

function collectInline(node: ProseMirrorNode): TextSegment[] {
  const out: TextSegment[] = []
  node.forEach((child) => {
    collectInlineSegments(child, out)
  })
  return out
}

function collectInlineSegments(node: ProseMirrorNode, out: TextSegment[]): void {
  if (node.type.name === 'text') {
    out.push(buildSegment(node))
  } else if (node.type.name === 'hardBreak') {
    out.push({text: '\n', bold: false, italic: false, underline: false, strike: false, code: false})
  } else if (node.type.name === 'image') {
    const alt = (node.attrs.alt as string) || ''
    out.push({text: alt ? `[${alt}]` : '[image]', bold: false, italic: true, underline: false, strike: false, code: false})
  } else if (node.content.size > 0) {
    node.forEach((child) => collectInlineSegments(child, out))
  }
}

function buildSegment(node: ProseMirrorNode): TextSegment {
  const text = node.text ?? ''
  const seg: TextSegment = {text, bold: false, italic: false, underline: false, strike: false, code: false}
  for (const mark of node.marks) {
    switch (mark.type.name) {
      case 'bold': seg.bold = true; break
      case 'italic': seg.italic = true; break
      case 'underline': seg.underline = true; break
      case 'strike': seg.strike = true; break
      case 'code': seg.code = true; break
      case 'link': seg.link = (mark.attrs.href as string) || ''; break
    }
  }
  return seg
}

function getIndent(ctx: PdfContext): number {
  let indent = 0
  if (ctx.list) {
    indent = ctx.list.level * LIST_INDENT
  }
  if (ctx.blockquote) {
    indent += BLOCKQUOTE_INDENT
  }
  return indent
}

/**
 * Render a line of text segments with word wrapping. Handles mixed styles
 * (bold/italic/code) by rendering each segment with its own font settings.
 */
function renderLine(
  state: RenderState,
  segments: TextSegment[],
  fontSize: number,
  indent = 0,
  isBlockquote = false,
) {
  const x = state.margin + indent
  const maxWidth = state.contentWidth - indent

  // Build a flat list of words with their segment styling for wrapping.
  interface Word {
    text: string
    seg: TextSegment
  }
  const words: Word[] = []
  for (const seg of segments) {
    const segWords = seg.text.split(/(\s+)/)
    for (const w of segWords) {
      if (w) words.push({text: w, seg})
    }
  }

  if (words.length === 0) {
    ensureSpace(state, fontSize * LINE_HEIGHT)
    state.y += fontSize * LINE_HEIGHT
    return
  }

  // Greedy word wrap.
  let lineWords: Word[] = []
  let lineWidth = 0

  const flushLine = () => {
    if (lineWords.length === 0) return
    ensureSpace(state, fontSize * LINE_HEIGHT)
    let cx = x

    // Draw blockquote left border.
    if (isBlockquote) {
      state.doc.setDrawColor(180, 180, 180)
      state.doc.setLineWidth(2)
      state.doc.line(x - 6, state.y - fontSize * 0.8, x - 6, state.y + fontSize * 0.6)
    }

    for (const word of lineWords) {
      const seg = word.seg
      const font = seg.code ? 'courier' : 'helvetica'
      const style = seg.bold && seg.italic ? 'bolditalic' : seg.bold ? 'bold' : seg.italic ? 'italic' : 'normal'
      state.doc.setFont(font, style)
      state.doc.setFontSize(fontSize)
      state.doc.setTextColor(40, 40, 40)

      // Code background.
      if (seg.code) {
        const w = state.doc.getTextWidth(word.text)
        state.doc.setFillColor(244, 244, 244)
        state.doc.rect(cx - 1, state.y - fontSize * 0.8, w + 2, fontSize * LINE_HEIGHT, 'F')
      }

      state.doc.text(word.text, cx, state.y)
      cx += state.doc.getTextWidth(word.text)
    }

    state.y += fontSize * LINE_HEIGHT
    lineWords = []
    lineWidth = 0
  }

  for (const word of words) {
    const font = word.seg.code ? 'courier' : 'helvetica'
    const style = word.seg.bold && word.seg.italic ? 'bolditalic' : word.seg.bold ? 'bold' : word.seg.italic ? 'italic' : 'normal'
    state.doc.setFont(font, style)
    state.doc.setFontSize(fontSize)
    const ww = state.doc.getTextWidth(word.text)

    if (lineWidth + ww > maxWidth && lineWords.length > 0) {
      flushLine()
    }

    lineWords.push(word)
    lineWidth += ww
  }
  flushLine()
}

// --- Helpers ----------------------------------------------------------

interface DecodedImage {
  format: 'PNG' | 'JPEG' | 'GIF' | 'BMP'
  data: Uint8Array
}

function decodeDataUri(src: string): DecodedImage | null {
  const match = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i)
  if (!match) return null
  const mimeFmt = match[1].toLowerCase()
  const format: DecodedImage['format'] = mimeFmt === 'jpeg' ? 'JPEG' : (mimeFmt.toUpperCase() as DecodedImage['format'])
  const base64 = match[2]
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return {format, data: bytes}
  } catch {
    return null
  }
}

function parsePx(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const m = value.match(/^(\d+(?:\.\d+)?)px$/)
    if (m) return parseFloat(m[1])
    const n = parseFloat(value)
    if (!isNaN(n)) return n
  }
  return fallback
}
