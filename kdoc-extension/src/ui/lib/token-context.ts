import type {Editor} from '@tiptap/react'

/**
 * Extract local context around a selection for inline AI skills.
 *
 * Instead of passing text from the document start (which is often irrelevant),
 * this returns:
 * - The nearest preceding heading (for section awareness)
 * - ~200 chars before the selection
 * - ~200 chars after the selection
 *
 * This gives the model enough context to understand what it's editing without
 * overflowing the 4096-token context window.
 */
export function getLocalContext(
  editor: Editor,
  from: number,
  to: number,
  maxChars = 500,
): string {
  const docText = editor.getText()
  const beforeChars = Math.min(200, from)
  const afterChars = Math.min(200, docText.length - to)

  const before = docText.slice(from - beforeChars, from)
  const after = docText.slice(to, to + afterChars)

  // Find nearest preceding heading
  const heading = getNearestHeading(editor, from)

  const parts: string[] = []
  if (heading) parts.push(`Section: ${heading}`)
  if (before.trim()) parts.push(`Before: "${before.trim()}"`)
  if (after.trim()) parts.push(`After: "${after.trim()}"`)

  let result = parts.join('\n')
  if (result.length > maxChars) {
    // Trim the after-context first, then before
    const over = result.length - maxChars
    if (after.length > over + 10) {
      const trimmedAfter = after.slice(0, after.length - over - 10)
      result = parts.slice(0, -1).join('\n') + `\nAfter: "${trimmedAfter.trim()}"`
    } else {
      result = result.slice(0, maxChars - 3) + '...'
    }
  }
  return result
}

/** Find the nearest heading text preceding a position in the document. */
function getNearestHeading(editor: Editor, pos: number): string | null {
  const doc = editor.state.doc
  let heading: string | null = null

  doc.descendants((node, nodePos) => {
    if (nodePos >= pos) return false
    if (node.type.name === 'heading') {
      heading = node.textContent.trim()
    }
    return true
  })

  return heading
}
