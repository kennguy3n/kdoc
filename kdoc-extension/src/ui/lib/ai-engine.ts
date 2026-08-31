import type {AIActionDef} from './ai-actions'

export type ModelLoadProgress = (progress: number) => void

/**
 * Patterns that indicate model artifacts leaking into output.
 * These are stripped from the token stream before reaching the UI.
 */
const ARTIFACT_PATTERNS: RegExp[] = [
  // System prompt injection echoes — full patterns
  /!systemmessage[^\n]*/gi,
  /!systemend[^\n]*/gi,
  /!systemerror[^\n]*/gi,
  // Fragment patterns — when !systemmessage is split across tokens,
  // sanitization may catch "!system" in one token and leave "message" behind.
  // Catch the fragment "!message" and "!end" as standalone artifacts.
  /!message(?=\s|$)/gi,
  /!end(?=\s|$)/gi,
  // Meta-commentary the model produces about its own task
  /The text has been improved for clarity and flow[^\n]*/gi,
  /The text has been improved[^\n]*/gi,
  /The text has been rewritten[^\n]*/gi,
  /The document has been processed[^\n]*/gi,
  /The document has been improved[^\n]*/gi,
  /Improved text format[^\n]*/gi,
  /Improve the text for clarity and flow[^\n]*/gi,
  /Keep the meaning[^\n]*Output only the improved text[^\n]*/gi,
  /Output only the improved text[^\n]*/gi,
  /Output only the (?:formatted|corrected|simplified|expanded|shortened|translated) text[^\n]*/gi,
  /Output ONLY the (?:improved|formatted|corrected|simplified|expanded|shortened|translated) version[^\n]*/gi,
  /Do NOT include the document title[^\n]*/gi,
  /Do NOT repeat content[^\n]*/gi,
  /You are processing section[^\n]*/gi,
  // ChatML tag leakage
  /<\|im_start\|>/g,
  /<\|im_end\|>/g,
  // Think tag leakage (should be filtered by backend but catch residual)
  /<think>/g,
  /<\/think>/g,
  // Cut-off marker
  /\[CUT_OFF\]/g,
  // "System message:" meta-commentary
  /System message:[^\n]*/gi,
  // Repeated standalone "system" lines (ChatML tag leakage where <|im_start|>system
  // gets stripped but "system" remains). Only strip when it appears as a
  // standalone line, not as part of a word like "systematic".
  /^system$/gim,
  // Repeated "system" at end of output (model stuck in a loop)
  /(?:^|\n)system(?:\n|$){2,}/g,
  // "message excluded" — model echoing prompt instructions about what to
  // exclude from output. Appears in table cells as "(message excluded)".
  /\(message excluded\)/gi,
  // "The improved version is now ready" — meta-commentary
  /The improved version is now ready[^\n]*/gi,
]

/**
 * Sanitize a token (or accumulated output) by stripping known artifacts.
 * Called on each token in the streaming path.
 */
function sanitizeToken(token: string): string {
  let result = token
  for (const pattern of ARTIFACT_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result
}

/**
 * Sanitize the final accumulated output. Handles artifacts that may span
 * multiple tokens (and thus weren't caught by per-token sanitization).
 */
function sanitizeOutput(text: string): string {
  let result = text
  for (const pattern of ARTIFACT_PATTERNS) {
    result = result.replace(pattern, '')
  }
  // Clean up extra blank lines left by artifact removal
  result = result.replace(/\n{3,}/g, '\n\n')
  return result.trim()
}

export interface AIEngineCallbacks {
  onToken: (token: string) => void
  onDone: () => void
  onError: (error: string) => void
  /** Called if the backend signals that generation was cut off by max_tokens. */
  onCutOff?: () => void
}

export interface ModelInfo {
  name: string
  path: string
  format: string
  size_mb: number
}

export interface BackendStatus {
  loaded: boolean
  model_name: string | null
  model_format: string | null
  backend: string
  /** Current model quality mode ("fast" | "quality"). */
  model_quality?: string
}

/**
 * Model quality preference — determines which Bonsai quantization to load.
 * - "fast": 1-bit Bonsai (~269MB, ~22 tok/s, lower quality)
 * - "quality": 2-bit Ternary Bonsai (~484MB, ~11 tok/s, +18% benchmark score)
 *
 * Both models share the same Qwen3-1.7B architecture and LoRA adapters.
 */
export type ModelQuality = 'fast' | 'quality'

const BACKEND_URL = 'http://127.0.0.1:9942'

/**
 * Base paths for LoRA adapters in the kchat-ai-runtime manifest.
 * Adapters live at: {LORA_BASE}/{family}.{lang}/adapters.safetensors
 *
 * Both the 1-bit and 2-bit MLX packs symlink their `lora/` directory to the
 * same shared adapter set, so either base path resolves to the same files.
 */
const LORA_BASE_1BIT = '/Users/Ken/workspaces/kocal/kchat-ai-runtime/manifest/packs/bonsai-1.7b-mlx-1bit/lora'
const LORA_BASE_2BIT = '/Users/Ken/workspaces/kocal/kchat-ai-runtime/manifest/packs/ternary-bonsai-1.7b-mlx-2bit/lora'

/**
 * Map KDoc language names (from translate action context) to LoRA language codes.
 */
const LANG_TO_LORA: Record<string, string> = {
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Japanese: 'ja',
  Chinese: 'zh',
  Vietnamese: 'vi',
  Korean: 'ko',
  Arabic: 'ar',
  Hindi: 'hi',
  English: 'en',
}

/**
 * Resolve a LoRA adapter path from a task family, language context, and quality mode.
 * For translation, the context is the target language name (e.g. "Chinese").
 * For other tasks, we use the "en" adapter by default.
 * Returns null if the path doesn't exist (caller should fall back to base model).
 *
 * Quality mode selects the adapter set:
 * - "fast": 1-bit dedicated LoRA adapters (trained on 1-bit base)
 * - "quality": 2-bit dedicated LoRA adapters (trained on 2-bit base)
 */
function resolveLoraPath(loraTask: string, quality: ModelQuality, context?: string): string | null {
  let langCode = 'en'

  // For translate, context is the target language name.
  if (loraTask === 'rewrite_grammar' && context) {
    langCode = LANG_TO_LORA[context] ?? 'en'
  }

  // Use the adapter set matching the current quality mode.
  const basePath = quality === 'quality' ? LORA_BASE_2BIT : LORA_BASE_1BIT
  const adapterPath = `${basePath}/${loraTask}.${langCode}`
  return adapterPath
}

export class AIEngine {
  private loaded = false
  private loading = false
  private loadProgress = 0
  private currentModel: string | null = null
  /** Current model quality mode. */
  private quality: ModelQuality = 'fast'

  isLoaded(): boolean {
    return this.loaded
  }

  isLoading(): boolean {
    return this.loading
  }

  getLoadProgress(): number {
    return this.loadProgress
  }

  getModelName(): string | null {
    return this.currentModel
  }

  /** Get the current model quality mode. */
  getQuality(): ModelQuality {
    return this.quality
  }

  /** Set the model quality mode (does not reload — call reloadForQuality to switch). */
  setQuality(q: ModelQuality): void {
    this.quality = q
  }

  /** Get the current quality mode from the backend. */
  async fetchQuality(): Promise<ModelQuality> {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/quality`)
      if (!resp.ok) return this.quality
      const data = await resp.json()
      const q = data.quality as string
      if (q === 'quality' || q === 'fast') {
        this.quality = q as ModelQuality
      }
    } catch {
      // Backend not running — keep current setting.
    }
    return this.quality
  }

  /** Set the quality mode on the backend (no model reload). */
  async setBackendQuality(q: ModelQuality): Promise<void> {
    await fetch(`${BACKEND_URL}/api/quality`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({quality: q}),
    })
    this.quality = q
  }

  /**
   * Switch model quality and reload the appropriate model pack.
   * Unloads the current model, sets the new quality, and auto-loads the new pack.
   */
  async switchQuality(q: ModelQuality, onProgress?: ModelLoadProgress): Promise<void> {
    if (this.quality === q && this.loaded) return
    this.quality = q

    // Unload current model first.
    if (this.loaded) {
      await this.unloadModel()
    }

    // Set quality on backend so auto-load picks the right pack.
    await this.setBackendQuality(q)

    // Auto-load the new model.
    await this.autoLoadModel(onProgress)
  }

  async getStatus(): Promise<BackendStatus> {
    const resp = await fetch(`${BACKEND_URL}/api/status`)
    if (!resp.ok) throw new Error('Failed to get backend status')
    return resp.json()
  }

  async listModels(): Promise<ModelInfo[]> {
    const resp = await fetch(`${BACKEND_URL}/api/models`)
    if (!resp.ok) throw new Error('Failed to list models')
    const data = await resp.json()
    return data.models as ModelInfo[]
  }

  async loadModel(modelPath: string, onProgress?: ModelLoadProgress): Promise<void> {
    if (this.loaded && this.currentModel === modelPath) return
    if (this.loading) throw new Error('Model is already loading')

    this.loading = true
    this.loadProgress = 0
    this.currentModel = modelPath

    try {
      const resp = await fetch(`${BACKEND_URL}/api/load`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model_path: modelPath}),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({error: 'Unknown error'}))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }

      onProgress?.(1)
      this.loaded = true
    } catch (err) {
      this.loaded = false
      this.currentModel = null
      throw new Error(`Failed to load model: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.loading = false
    }
  }

  async autoLoadModel(onProgress?: ModelLoadProgress): Promise<void> {
    if (this.loaded) return
    if (this.loading) throw new Error('Model is already loading')

    this.loading = true
    this.loadProgress = 0

    try {
      const resp = await fetch(`${BACKEND_URL}/api/auto-load`, {
        method: 'POST',
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({error: 'Unknown error'}))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }

      const data = await resp.json()
      this.currentModel = data.model_path ?? null
      onProgress?.(1)
      this.loaded = true
    } catch (err) {
      this.loaded = false
      this.currentModel = null
      throw new Error(`Failed to load model: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.loading = false
    }
  }

  async unloadModel(): Promise<void> {
    await fetch(`${BACKEND_URL}/api/unload`, {method: 'POST'})
    this.loaded = false
    this.currentModel = null
    this.currentLoraAdapter = null
  }

  /** Current LoRA adapter path (null = base model only). */
  private currentLoraAdapter: string | null = null

  /** Load a LoRA adapter for a specific task+language. */
  async loadLora(adapterPath: string): Promise<void> {
    if (this.currentLoraAdapter === adapterPath) return
    const resp = await fetch(`${BACKEND_URL}/api/lora/load`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({adapter_path: adapterPath}),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({error: 'Unknown error'}))
      throw new Error(`LoRA load failed: ${err.error || `HTTP ${resp.status}`}`)
    }
    this.currentLoraAdapter = adapterPath
  }

  /** Detach the current LoRA adapter, reverting to base model. */
  async detachLora(): Promise<void> {
    if (!this.currentLoraAdapter) return
    await fetch(`${BACKEND_URL}/api/lora/detach`, {method: 'POST'})
    this.currentLoraAdapter = null
  }

  /** Get the current LoRA adapter path from the backend. */
  async getLoraStatus(): Promise<string | null> {
    const resp = await fetch(`${BACKEND_URL}/api/lora/status`)
    if (!resp.ok) return null
    const data = await resp.json()
    this.currentLoraAdapter = data.adapter ?? null
    return this.currentLoraAdapter
  }

  async runSkill(
    skill: AIActionDef,
    selection: string,
    context: string | undefined,
    callbacks: AIEngineCallbacks,
  ): Promise<void> {
    if (!this.loaded) {
      callbacks.onError('Model not loaded. Please load the model first.')
      return
    }

    // Auto-load LoRA adapter if the skill specifies a task family.
    // If the skill has no loraTask, detach any currently-loaded LoRA so
    // the base model is used. Without this, a LoRA from a previous action
    // (e.g. rewrite_grammar from improve_writing) stays attached and
    // corrupts the output of actions that expect the base model (e.g.
    // improve_document, format_document).
    if (skill.loraTask) {
      const adapterPath = resolveLoraPath(skill.loraTask, this.quality, context)
      if (adapterPath) {
        try {
          await this.loadLora(adapterPath)
        } catch (err) {
          // Non-fatal: fall back to base model if LoRA load fails.
          console.warn(`LoRA load failed for ${skill.loraTask}:`, err)
        }
      }
    } else {
      // No LoRA needed for this skill — ensure base model is active.
      await this.detachLora()
    }

    // For selection-scope actions, input is the selection text.
    // For topic-scope actions, input is the context (which carries the topic).
    // For document-scope actions, input is empty (context is the document).
    const input = skill.scope === 'selection' ? selection : skill.scope === 'topic' ? (context ?? '') : ''
    const {system, user, responsePrefix: dynamicPrefix} = skill.buildPrompt(input, context)
    const responsePrefix = dynamicPrefix ?? skill.responsePrefix

    try {
      const resp = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          system,
          user,
          max_tokens: skill.maxTokens,
          temperature: skill.temperature,
          stop: skill.stop,
          response_prefix: responsePrefix,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({error: 'Unknown error'}))
        callbacks.onError(err.error || `HTTP ${resp.status}`)
        return
      }

      const reader = resp.body?.getReader()
      if (!reader) {
        callbacks.onError('No response body')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const {done, value} = await reader.read()
        if (done) break

        buffer += decoder.decode(value, {stream: true})
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: error')) {
            const dataLine = lines[lines.indexOf(line) + 1]
            if (dataLine?.startsWith('data: ')) {
              callbacks.onError(dataLine.slice(6))
              return
            }
          }
          if (line.startsWith('data: ')) {
            const raw = line.slice(6)
            if (!raw) continue
            try {
              const token = JSON.parse(raw) as string
              if (!token) continue
              // Detect backend cut-off signal (sent when stop_type == "limit")
              if (token.includes('[CUT_OFF]')) {
                callbacks.onCutOff?.()
                continue
              }
              // Sanitize artifacts from the token before forwarding to UI
              const clean = sanitizeToken(token)
              if (clean) callbacks.onToken(clean)
            } catch {
              const clean = sanitizeToken(raw)
              if (clean) callbacks.onToken(clean)
            }
          }
        }
      }

      callbacks.onDone()
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err))
    }
  }

  dispose(): void {
    this.loaded = false
    this.loading = false
    this.currentModel = null
    this.loadProgress = 0
  }
}

let engineInstance: AIEngine | null = null

export function getAIEngine(): AIEngine {
  if (!engineInstance) {
    engineInstance = new AIEngine()
  }
  return engineInstance
}
