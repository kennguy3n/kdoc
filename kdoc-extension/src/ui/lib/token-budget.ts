/**
 * Token budget estimation and context truncation utilities.
 *
 * The local model (Ternary-Bonsai-1.7B) has an 8192-token context window
 * (increased from 4096 to support document processing). After ChatML template
 * overhead (~100 tokens) and the think-tag pre-fill (~10 tokens), roughly
 * 8060 tokens are available for system + user + output.
 *
 * We use per-script chars-per-token ratios for accurate estimation:
 * - Latin/Cyrillic: ~3 chars/token
 * - CJK (Chinese/Japanese/Korean): ~1.0 chars/token
 * - Arabic/Thai/Devanagari/Tamil/Bengali: ~1.5 chars/token
 */

const CHARS_PER_TOKEN_LATIN = 3
const CHARS_PER_TOKEN_CJK = 1.0
const CHARS_PER_TOKEN_COMPLEX = 1.5
const TOTAL_CONTEXT = 8192
const TEMPLATE_OVERHEAD = 120 // ChatML tags + think-tag pre-fill
const SAFETY_MARGIN = 80 // guard against estimation drift

/**
 * Estimate the token count of a string using per-script chars-per-token ratios.
 * CJK characters are ~1 char/token, Arabic/Thai/Devanagari ~1.5, Latin ~3.
 */
export function estimateTokens(text: string): number {
  // CJK: Chinese, Japanese Hiragana/Katakana, Korean Hangul
  const cjkRe = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3400-\u4dbf\uf900-\ufaff]/
  // Complex scripts: Arabic, Thai, Devanagari, Tamil, Bengali
  const complexRe = /[\u0600-\u06ff\u0750-\u077f\u0e00-\u0e7f\u0900-\u097f\u0b80-\u0bff\u0980-\u09ff]/

  let cjk = 0
  let complex = 0
  for (const ch of text) {
    if (cjkRe.test(ch)) cjk++
    else if (complexRe.test(ch)) complex++
  }
  const latin = text.length - cjk - complex
  return Math.ceil(cjk / CHARS_PER_TOKEN_CJK + complex / CHARS_PER_TOKEN_COMPLEX + latin / CHARS_PER_TOKEN_LATIN)
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
  return Math.max(remaining * CHARS_PER_TOKEN_LATIN, 0)
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
