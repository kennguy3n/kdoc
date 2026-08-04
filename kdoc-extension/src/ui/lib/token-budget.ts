/**
 * Token budget estimation and context truncation utilities.
 *
 * The local model (Ternary-Bonsai-4B) has a 4096-token context window.
 * After ChatML template overhead (~100 tokens) and the think-tag pre-fill
 * (~10 tokens), roughly 3980 tokens are available for system + user + output.
 *
 * We use a conservative estimate of ~3 chars per token for English text.
 * The previous value of 4 chars/token was too optimistic and caused
 * document-scoped actions (improve_document, format_document) to silently
 * overflow the context window on moderately-sized documents.
 */

const CHARS_PER_TOKEN = 3
const TOTAL_CONTEXT = 4096
const TEMPLATE_OVERHEAD = 120 // ChatML tags + think-tag pre-fill
const SAFETY_MARGIN = 80 // guard against estimation drift

/** Estimate the token count of a string. Conservative (~3 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Calculate the maximum context (in chars) that can be passed as user context,
 * given the system prompt, the user-prompt wrapper text, and max output tokens.
 *
 * budget = total_ctx - overhead - safety - system_tokens - wrapper_tokens - max_output_tokens
 * chars  = budget * CHARS_PER_TOKEN (clamped to >= 0)
 *
 * The wrapper text (e.g. "Improve this document:\n\n") is the part of the user
 * prompt that is NOT the variable context. Accounting for it prevents overflow
 * when the wrapper is non-trivial.
 */
export function budgetForContext(
  systemPrompt: string,
  maxOutputTokens: number,
  userWrapper = '',
  totalCtx = TOTAL_CONTEXT,
): number {
  const systemTokens = estimateTokens(systemPrompt)
  const wrapperTokens = estimateTokens(userWrapper)
  const remaining =
    totalCtx - TEMPLATE_OVERHEAD - SAFETY_MARGIN - systemTokens - wrapperTokens - maxOutputTokens
  return Math.max(remaining * CHARS_PER_TOKEN, 0)
}

/**
 * Adaptively reduce maxOutputTokens so that a given context text fits within
 * the context window. Returns the original maxOutputTokens if everything fits,
 * or a reduced value (clamped to a minimum) if the context is too large.
 *
 * This is critical for document-transformation actions (improve_document,
 * format_document) where the input document may be large. Without adaptation,
 * a 2000-token output budget + a 2500-token document overflows 4096 ctx.
 * With adaptation, the output budget is reduced so the input fits, and the
 * continuation mechanism handles the rest.
 */
export function adaptiveMaxOutput(
  systemPrompt: string,
  contextText: string,
  maxOutputTokens: number,
  userWrapper = '',
  totalCtx = TOTAL_CONTEXT,
  minOutput = 200,
): number {
  const systemTokens = estimateTokens(systemPrompt)
  const wrapperTokens = estimateTokens(userWrapper)
  const contextTokens = estimateTokens(contextText)
  const available =
    totalCtx - TEMPLATE_OVERHEAD - SAFETY_MARGIN - systemTokens - wrapperTokens - contextTokens
  if (available >= maxOutputTokens) return maxOutputTokens
  return Math.max(available, minOutput)
}

/**
 * Truncate text to fit within a max character budget.
 * Keeps the head of the text (most relevant for document context).
 */
export function truncateContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  // Keep head, add ellipsis
  return text.slice(0, maxChars - 3) + '...'
}

/**
 * Truncate text to fit within a token budget, keeping the tail
 * (most relevant for continuation - last generated text).
 */
export function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return '...' + text.slice(-(maxChars - 3))
}
