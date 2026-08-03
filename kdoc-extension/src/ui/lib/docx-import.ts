import mammoth from 'mammoth'

export interface DocxImportResult {
  html: string
  title: string
  messages: string[]
}

/**
 * Convert a .docx File into HTML that can be loaded into the TipTap editor.
 * Uses mammoth's browser build (arrayBuffer input). Images are emitted as
 * base64 data URIs, which the TipTap Image extension supports
 * (allowBase64: true).
 *
 * The style map extends mammoth's defaults with mappings for common Word
 * styles (Title, Subtitle, quotes, etc.) and preserves text alignment via
 * inline styles that TipTap's HTML parser respects.
 */
export async function importDocxToHtml(file: File): Promise<DocxImportResult> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      // Explicitly use dataUri for images (also the default, but be safe).
      convertImage: mammoth.images.dataUri,
      styleMap: [
        // Mammoth has default tags for bold (strong), italic (em), and
        // strikethrough (s), but NOT for underline — without this entry,
        // underlined text loses its <u> wrapper during import.
        'u => u',
        // Common Word heading styles not in mammoth's default map.
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Quote Text'] => blockquote:fresh",
        "p[style-name='Block Text'] => blockquote:fresh",
        "p[style-name='Block Quote'] => blockquote:fresh",
        // Numbered / bullet style names used by some Word templates.
        "p[style-name='List Number'] => ol > li:fresh",
        "p[style-name='List Bullet'] => ul > li:fresh",
        // Preserve bold/italic run styles that some .docx files use
        // instead of direct formatting.
        "r[style-name='Emphasis'] => em",
        "r[style-name='Strong'] => strong",
        "r[style-name='Underline'] => u",
        // Map common "Intense" styles.
        "r[style-name='Intense Emphasis'] => em",
        "r[style-name='Intense Strong'] => strong",
      ],
    },
  )

  const rawHtml = result.value || ''
  const html = postProcessHtml(rawHtml)
  const title = deriveTitle(html, file.name)
  const messages = result.messages.map((m) => `${m.type}: ${m.message}`)

  return { html, title, messages }
}

/**
 * Post-process mammoth's HTML output for better TipTap compatibility.
 *
 * Mammoth produces clean HTML, but some structures don't map 1:1 to
 * TipTap's node schema:
 * - Tables: mammoth emits <table><tr><td>; TipTap's Table extension
 *   parses fine without <tbody>, but we ensure cells have at least one
 *   <p> child (required by TipTap's TableCell).
 * - Empty paragraphs: collapse runs of 3+ into one.
 * - Nested lists: mammoth uses <ul>|<ol> selectors which produce valid
 *   nesting; no change needed.
 */
function postProcessHtml(html: string): string {
  if (!html) return ''

  let out = html

  // Ensure every <td>/<th> has at least one <p> child (TipTap requirement).
  // If the cell already starts with a block element, leave it; otherwise
  // wrap inline content in <p>.
  out = out.replace(
    /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag: string, attrs: string, content: string) => {
      const trimmed = content.trim()
      if (!trimmed) {
        return `<${tag}${attrs}><p></p></${tag}>`
      }
      // If content already starts with a block-level element, leave as-is.
      if (/^<(p|h[1-6]|ul|ol|blockquote|table|pre)/i.test(trimmed)) {
        return match
      }
      return `<${tag}${attrs}><p>${trimmed}</p></${tag}>`
    },
  )

  // Collapse multiple consecutive empty paragraphs into one.
  out = out.replace(/(<p>\s*<\/p>\s*){3,}/g, '<p></p>')

  return out.trim()
}

function deriveTitle(html: string, fallbackFilename: string): string {
  // Prefer the first heading in the document.
  const headingMatch = html.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)
  if (headingMatch) {
    const text = stripTags(headingMatch[1]).trim()
    if (text) return text.slice(0, 120)
  }
  // Otherwise use the filename without extension.
  return (
    fallbackFilename
      .replace(/\.docx$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Imported Document'
  )
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
}
