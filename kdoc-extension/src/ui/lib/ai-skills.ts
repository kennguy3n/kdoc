export type AISkillMode = 'replace' | 'insert'

export interface AISkillSubVariant {
  id: string
  label: string
  context?: string
}

export interface AISkillDef {
  id: string
  label: string
  description: string
  icon: string
  maxTokens: number
  temperature: number
  stop?: string[]
  needsSelection: boolean
  mode: AISkillMode
  subVariants?: AISkillSubVariant[]
  buildPrompt: (selection: string, context?: string) => {system: string; user: string}
}

export const AI_SKILLS: Record<string, AISkillDef> = {
  continue_writing: {
    id: 'continue_writing',
    label: 'Continue Writing',
    description: 'Continue from where you left off',
    icon: 'Sparkles',
    maxTokens: 150,
    temperature: 0.6,
    stop: ['<|im_end|>'],
    needsSelection: false,
    mode: 'insert',
    buildPrompt: (_selection, context) => ({
      system: 'You are a writing assistant. Continue the text naturally. Keep the same style and tone. Write 2-3 sentences. Do not explain. Output only the continuation.',
      user: `Continue: "${context ?? ''}"`,
    }),
  },
  improve_writing: {
    id: 'improve_writing',
    label: 'Improve Writing',
    description: 'Improve clarity and readability',
    icon: 'Wand2',
    maxTokens: 300,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    subVariants: [
      {id: 'clarity', label: 'Clarity', context: 'for clarity and readability'},
      {id: 'concise', label: 'Concise', context: 'to be more concise and to the point'},
      {id: 'engaging', label: 'Engaging', context: 'to be more engaging and compelling'},
    ],
    buildPrompt: (selection, context) => ({
      system: `You are an editor. Improve the text ${context ?? 'for clarity, readability, and flow'}. Keep the meaning. Do not explain or add commentary. Output only the improved text.`,
      user: `Improve: "${selection}"`,
    }),
  },
  fix_grammar: {
    id: 'fix_grammar',
    label: 'Fix Grammar',
    description: 'Fix spelling and grammar',
    icon: 'CheckCheck',
    maxTokens: 300,
    temperature: 0.2,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    buildPrompt: (selection) => ({
      system: 'You are a grammar checker. Fix only spelling and grammar errors. Keep the meaning and style. Do not explain. Output only the corrected text.',
      user: `Fix: "${selection}"`,
    }),
  },
  summarize: {
    id: 'summarize',
    label: 'Summarize',
    description: 'Condense to key points',
    icon: 'FileText',
    maxTokens: 150,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    buildPrompt: (selection) => ({
      system: 'You are a summarizer. Summarize the text in 2-3 bullet points. Be concise. Do not explain. Output only the bullet points.',
      user: `Summarize: "${selection}"`,
    }),
  },
  expand: {
    id: 'expand',
    label: 'Expand',
    description: 'Add detail and context',
    icon: 'Lightbulb',
    maxTokens: 300,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    buildPrompt: (selection) => ({
      system: 'You are a writing assistant. Expand the text with more detail and context. Keep the same style. Do not explain. Output only the expanded text.',
      user: `Expand: "${selection}"`,
    }),
  },
  simplify: {
    id: 'simplify',
    label: 'Simplify',
    description: 'Simplify the language',
    icon: 'Wand2',
    maxTokens: 300,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    buildPrompt: (selection) => ({
      system: 'You are an editor. Simplify the text to be easier to read. Use shorter sentences and simpler words. Do not explain. Output only the simplified text.',
      user: `Simplify: "${selection}"`,
    }),
  },
  change_tone: {
    id: 'change_tone',
    label: 'Change Tone',
    description: 'Rewrite in a different tone',
    icon: 'Wand2',
    maxTokens: 300,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    subVariants: [
      {id: 'professional', label: 'Professional', context: 'in a professional tone'},
      {id: 'casual', label: 'Casual', context: 'in a casual, friendly tone'},
      {id: 'confident', label: 'Confident', context: 'in a confident, assertive tone'},
      {id: 'friendly', label: 'Friendly', context: 'in a warm, friendly tone'},
    ],
    buildPrompt: (selection, context) => ({
      system: `You are an editor. Rewrite the text ${context ?? 'in a professional tone'}. Keep the meaning. Do not explain. Output only the rewritten text.`,
      user: `Rewrite: "${selection}"`,
    }),
  },
  generate_ideas: {
    id: 'generate_ideas',
    label: 'Generate Ideas',
    description: 'Generate bullet-point ideas',
    icon: 'Lightbulb',
    maxTokens: 200,
    temperature: 0.7,
    stop: ['<|im_end|>'],
    needsSelection: false,
    mode: 'insert',
    buildPrompt: (_selection, context) => ({
      system: 'You are a brainstorming assistant. Generate 3-5 ideas as bullet points. Be concise. Do not explain. Output only the bullet points.',
      user: `Topic: "${context ?? ''}"`,
    }),
  },
  generate_heading: {
    id: 'generate_heading',
    label: 'Generate Heading',
    description: 'Suggest a heading for section',
    icon: 'Heading',
    maxTokens: 20,
    temperature: 0.3,
    stop: ['<|im_end|>', '\n'],
    needsSelection: true,
    mode: 'replace',
    buildPrompt: (selection) => ({
      system: 'You are a title generator. Generate a single concise heading for the text. Do not explain. Output only the heading, no quotes.',
      user: `Title for: "${selection}"`,
    }),
  },
  extract_actions: {
    id: 'extract_actions',
    label: 'Extract Action Items',
    description: 'Extract action items as a list',
    icon: 'ListChecks',
    maxTokens: 150,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    buildPrompt: (selection) => ({
      system: 'You are an assistant. Extract action items from the text as a bullet list. Start each with "- ". Be concise. Do not explain. Output only the list.',
      user: `Extract actions from: "${selection}"`,
    }),
  },
  translate: {
    id: 'translate',
    label: 'Translate',
    description: 'Translate to target language',
    icon: 'FileText',
    maxTokens: 300,
    temperature: 0.2,
    stop: ['<|im_end|>'],
    needsSelection: true,
    mode: 'replace',
    subVariants: [
      {id: 'spanish', label: 'Spanish', context: 'Spanish'},
      {id: 'french', label: 'French', context: 'French'},
      {id: 'german', label: 'German', context: 'German'},
      {id: 'japanese', label: 'Japanese', context: 'Japanese'},
      {id: 'chinese', label: 'Chinese', context: 'Chinese'},
      {id: 'vietnamese', label: 'Vietnamese', context: 'Vietnamese'},
    ],
    buildPrompt: (selection, context) => ({
      system: 'You are a translator. Translate the text to the specified language. Do not explain. Output only the translated text.',
      user: `Translate to ${context ?? 'Spanish'}: "${selection}"`,
    }),
  },
}

export const SKILL_LIST = Object.values(AI_SKILLS)

export const SELECTION_SKILLS = SKILL_LIST.filter((s) => s.needsSelection)

export const SLASH_AI_SKILLS = SKILL_LIST.filter((s) => !s.needsSelection || s.id === 'continue_writing')
