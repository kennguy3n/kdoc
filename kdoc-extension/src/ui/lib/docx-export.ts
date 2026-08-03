import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from 'docx'

interface ListContext {
  type: 'bullet' | 'ordered'
  level: number
}

interface ConversionContext {
  list: ListContext | null
  /** When set, paragraphs are rendered with blockquote indent + left border. */
  blockquote: boolean
}

/**
 * Convert the editor's ProseMirror document into a .docx Blob.
 *
 * Walks the doc tree and maps each node to docx Paragraphs / Tables. Marks
 * (bold, italic, underline, strike, code, link) are translated to TextRun
 * properties. Task lists, code blocks, blockquotes, tables, images, and
 * horizontal rules are approximated using docx primitives.
 */
export async function exportDocx(editor: Editor, title: string): Promise<Blob> {
  const ctx: ConversionContext = { list: null, blockquote: false }
  const children = convertNodes(editor.state.doc, ctx)

  // Ensure at least one paragraph (docx requires non-empty section body).
  if (children.length === 0) {
    children.push(new Paragraph({ text: '' }))
  }

  const doc = new Document({
    title: title || 'Untitled',
    creator: 'KDoc',
    numbering: {
      config: [
        {
          reference: 'kdoc-ordered',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2)',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
            },
            {
              level: 2,
              format: LevelFormat.LOWER_ROMAN,
              text: '%3.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 2160, hanging: 360 } } },
            },
            {
              level: 3,
              format: LevelFormat.DECIMAL,
              text: '%4.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 2880, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  })

  return Packer.toBlob(doc)
}

function convertNodes(node: ProseMirrorNode, ctx: ConversionContext): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  node.forEach((child) => {
    const converted = convertBlock(child, ctx)
    if (converted) out.push(...converted)
  })
  return out
}

function convertBlock(node: ProseMirrorNode, ctx: ConversionContext): (Paragraph | Table)[] | null {
  switch (node.type.name) {
    case 'paragraph':
      return [convertParagraph(node, ctx)]
    case 'heading':
      return [convertHeading(node, ctx)]
    case 'bulletList':
      return convertList(node, ctx, 'bullet')
    case 'orderedList':
      return convertList(node, ctx, 'ordered')
    case 'taskList':
      return convertTaskList(node, ctx)
    case 'blockquote':
      return convertBlockquote(node, ctx)
    case 'codeBlock':
      return [convertCodeBlock(node)]
    case 'horizontalRule':
      return [convertHorizontalRule()]
    case 'image':
      return [convertImage(node)]
    case 'table':
      return [convertTable(node)]
    case 'hardBreak':
      return [new Paragraph({ children: [new TextRun({ break: 1 })] })]
    default:
      // Unknown block: try to extract text content as a paragraph.
      return [new Paragraph({ text: node.textContent })]
  }
}

function applyBlockProps(
  opts: ConstructorParameters<typeof Paragraph>[0],
  ctx: ConversionContext,
): ConstructorParameters<typeof Paragraph>[0] {
  if (ctx.list) {
    if (ctx.list.type === 'bullet') {
      opts.bullet = { level: ctx.list.level }
    } else {
      opts.numbering = { reference: 'kdoc-ordered', level: ctx.list.level }
    }
  }
  if (ctx.blockquote) {
    opts.indent = { left: 720 } // 0.5 inch in twips
    opts.border = {
      left: { color: 'AAAAAA', space: 12, style: BorderStyle.SINGLE, size: 18 },
    }
  }
  return opts
}

function convertParagraph(node: ProseMirrorNode, ctx: ConversionContext): Paragraph {
  const children = convertInline(node)
  const opts = applyBlockProps({ children }, ctx)
  return new Paragraph(opts)
}

function convertHeading(node: ProseMirrorNode, ctx: ConversionContext): Paragraph {
  const level = (node.attrs.level as number) ?? 2
  const heading =
    level === 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : level === 3
          ? HeadingLevel.HEADING_3
          : level === 4
            ? HeadingLevel.HEADING_4
            : HeadingLevel.HEADING_5
  const children = convertInline(node)
  const opts = applyBlockProps({ heading, children }, ctx)
  return new Paragraph(opts)
}

function convertList(
  node: ProseMirrorNode,
  ctx: ConversionContext,
  type: 'bullet' | 'ordered',
): Paragraph[] {
  const out: Paragraph[] = []
  const parentList = ctx.list
  const level = parentList?.type === type ? parentList.level + 1 : 0
  // Cap at the max level defined in the numbering config (3 for ordered,
  // docx bullets have no explicit cap but 9 is a safe upper bound).
  const cappedLevel = type === 'ordered' ? Math.min(level, 3) : Math.min(level, 8)
  node.forEach((child) => {
    if (child.type.name === 'listItem') {
      ctx.list = { type, level: cappedLevel }
      child.forEach((itemChild) => {
        const converted = convertBlock(itemChild, ctx)
        if (converted) out.push(...(converted as Paragraph[]))
      })
    }
  })
  ctx.list = parentList
  return out
}

function convertTaskList(node: ProseMirrorNode, ctx: ConversionContext): Paragraph[] {
  const out: Paragraph[] = []
  const parentList = ctx.list
  // Task lists use bullet styling; respect nesting level from parent list
  // if it's also a bullet list, otherwise start at level 0.
  const level = parentList?.type === 'bullet' ? Math.min(parentList.level + 1, 8) : 0
  node.forEach((child) => {
    if (child.type.name === 'taskItem') {
      const checked = Boolean(child.attrs.checked)
      const prefix = checked ? '\u2611 ' : '\u2610 ' // ☑ / ☐
      ctx.list = { type: 'bullet', level }
      child.forEach((itemChild) => {
        if (itemChild.type.name === 'paragraph') {
          const inline = convertInline(itemChild)
          out.push(
            new Paragraph({
              bullet: { level },
              children: [new TextRun({ text: prefix }), ...inline],
            }),
          )
        } else {
          const converted = convertBlock(itemChild, ctx)
          if (converted) out.push(...(converted as Paragraph[]))
        }
      })
    }
  })
  ctx.list = parentList
  return out
}

function convertBlockquote(node: ProseMirrorNode, ctx: ConversionContext): Paragraph[] {
  const out: Paragraph[] = []
  const prevBlockquote = ctx.blockquote
  ctx.blockquote = true
  node.forEach((child) => {
    const converted = convertBlock(child, ctx)
    if (converted) out.push(...(converted as Paragraph[]))
  })
  ctx.blockquote = prevBlockquote
  return out
}

function convertCodeBlock(node: ProseMirrorNode): Paragraph {
  // Render each line as a separate run with a break, monospace font, and
  // light gray shading to mimic a code block.
  const text = node.textContent
  const lines = text.split('\n')
  const runs: TextRun[] = []
  lines.forEach((line, i) => {
    runs.push(
      new TextRun({
        text: line,
        font: 'Menlo',
        size: 20, // 10pt
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F4F4' },
      }),
    )
    if (i < lines.length - 1) {
      runs.push(new TextRun({ break: 1, font: 'Menlo', size: 20 }))
    }
  })
  return new Paragraph({
    children: runs,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F4F4' },
    spacing: { before: 80, after: 80 },
  })
}

function convertHorizontalRule(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    spacing: { before: 80, after: 80 },
  })
}

interface DecodedImage {
  type: 'jpg' | 'png' | 'gif' | 'bmp'
  data: Uint8Array
}

function convertImage(node: ProseMirrorNode): Paragraph {
  const src = (node.attrs.src as string) || ''
  const alt = (node.attrs.alt as string) || ''
  const width = (node.attrs.width as number | string | undefined) ?? 400
  const height = (node.attrs.height as number | string | undefined) ?? 300
  const decoded = decodeDataUri(src)
  if (!decoded) {
    // Not a base64 image (e.g. remote URL) — emit a placeholder paragraph.
    return new Paragraph({
      children: [
        new TextRun({
          text: alt ? `[Image: ${alt}]` : `[Image: ${src}]`,
          italics: true,
          color: '888888',
        }),
      ],
      alignment: AlignmentType.CENTER,
    })
  }
  const widthPx = parsePx(width, 400)
  const heightPx = parsePx(height, 300)
  return new Paragraph({
    children: [
      new ImageRun({
        type: decoded.type,
        data: decoded.data,
        transformation: { width: widthPx, height: heightPx },
        altText: { name: 'Image', description: alt, title: alt },
      }),
    ],
    alignment: AlignmentType.CENTER,
  })
}

function convertTable(node: ProseMirrorNode): Table {
  const rows: TableRow[] = []
  node.forEach((rowNode) => {
    if (rowNode.type.name !== 'tableRow') return
    // First pass: collect cell nodes and compute total column span count
    // so we can distribute widths evenly (accounting for colspan).
    const cellNodes: ProseMirrorNode[] = []
    let totalCols = 0
    rowNode.forEach((cellNode) => {
      if (cellNode.type.name !== 'tableCell' && cellNode.type.name !== 'tableHeader') return
      cellNodes.push(cellNode)
      totalCols += (cellNode.attrs.colspan as number) ?? 1
    })
    const cells: TableCell[] = []
    let headerCellCount = 0
    for (const cellNode of cellNodes) {
      const isHeader = cellNode.type.name === 'tableHeader'
      if (isHeader) headerCellCount++
      const cellChildren: Paragraph[] = []
      cellNode.forEach((p) => {
        const converted = convertBlock(p, { list: null, blockquote: false })
        if (converted) cellChildren.push(...(converted as Paragraph[]))
      })
      if (cellChildren.length === 0) cellChildren.push(new Paragraph({ text: '' }))
      const colspan = (cellNode.attrs.colspan as number) ?? 1
      const rowspan = (cellNode.attrs.rowspan as number) ?? 1
      // Width proportional to this cell's colspan relative to total columns.
      const cellWidth = totalCols > 0 ? Math.floor((100 * colspan) / totalCols) : 100
      cells.push(
        new TableCell({
          children: cellChildren,
          columnSpan: colspan > 1 ? colspan : undefined,
          rowSpan: rowspan > 1 ? rowspan : undefined,
          width: { size: cellWidth, type: WidthType.PERCENTAGE },
          shading: isHeader
            ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEEEEE' }
            : undefined,
        }),
      )
    }
    // Only mark as table header row if ALL cells in the row are header cells.
    const isHeaderRow = cellNodes.length > 0 && headerCellCount === cellNodes.length
    rows.push(new TableRow({ children: cells, tableHeader: isHeaderRow }))
  })
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

// --- Inline conversion -------------------------------------------------

function convertInline(node: ProseMirrorNode): ParagraphChild[] {
  const out: ParagraphChild[] = []
  node.forEach((child) => {
    collectInline(child, out)
  })
  if (out.length === 0) out.push(new TextRun({ text: '' }))
  return out
}

function collectInline(node: ProseMirrorNode, out: ParagraphChild[]): void {
  if (node.type.name === 'text') {
    out.push(buildTextRunOrHyperlink(node))
  } else if (node.type.name === 'hardBreak') {
    out.push(new TextRun({ break: 1 }))
  } else if (node.type.name === 'image') {
    // Inline image: wrap in its own paragraph is not possible here; emit a
    // placeholder run. Block-level images are handled in convertBlock.
    out.push(new TextRun({ text: '[image]', italics: true, color: '888888' }))
  } else if (node.content.size > 0) {
    node.forEach((child) => collectInline(child, out))
  }
}

function buildTextRunOrHyperlink(node: ProseMirrorNode): ParagraphChild {
  const text = node.text ?? ''
  const linkMark = node.marks.find((m) => m.type.name === 'link')
  const runOpts: IRunOptions = { text }
  for (const mark of node.marks) {
    switch (mark.type.name) {
      case 'bold':
        runOpts.bold = true
        break
      case 'italic':
        runOpts.italics = true
        break
      case 'underline':
        runOpts.underline = {}
        break
      case 'strike':
        runOpts.strike = true
        break
      case 'code':
        runOpts.font = 'Menlo'
        runOpts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F4F4' }
        break
      case 'link':
        // Handled below by wrapping in ExternalHyperlink.
        runOpts.color = '0563C1'
        runOpts.underline = {}
        break
    }
  }
  const run = new TextRun(runOpts)
  if (linkMark) {
    const href = (linkMark.attrs.href as string) || ''
    return new ExternalHyperlink({ children: [run], link: href })
  }
  return run
}

// --- Helpers ----------------------------------------------------------

function decodeDataUri(src: string): DecodedImage | null {
  const match = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i)
  if (!match) return null
  const mimeExt = match[1].toLowerCase()
  const type: DecodedImage['type'] = mimeExt === 'jpeg' ? 'jpg' : (mimeExt as DecodedImage['type'])
  const base64 = match[2]
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { type, data: bytes }
  } catch {
    return null
  }
}

/**
 * Parse a pixel dimension that may be a number, a numeric string, or a
 * CSS-like string (e.g. "400px"). Falls back to `fallback` if parsing fails.
 */
function parsePx(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'number') return value
  const parsed = parseInt(value.replace(/px$/i, '').trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
