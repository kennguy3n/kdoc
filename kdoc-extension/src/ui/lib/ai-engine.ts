import type {AIActionDef} from './ai-actions'

export type ModelLoadProgress = (progress: number) => void

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
}

const BACKEND_URL = 'http://127.0.0.1:9942'

export class AIEngine {
  private loaded = false
  private loading = false
  private loadProgress = 0
  private currentModel: string | null = null

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

    // For selection-scope actions, input is the selection text.
    // For topic-scope actions, input is the context (which carries the topic).
    // For document-scope actions, input is empty (context is the document).
    const input = skill.scope === 'selection' ? selection : skill.scope === 'topic' ? (context ?? '') : ''
    const {system, user} = skill.buildPrompt(input, context)

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
          response_prefix: skill.responsePrefix,
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
              callbacks.onToken(token)
            } catch {
              callbacks.onToken(raw)
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
