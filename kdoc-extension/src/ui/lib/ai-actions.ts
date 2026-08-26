/**
 * Unified AI action registry.
 *
 * All AI capabilities - whether triggered from the highlight menu, the writing
 * panel, or slash commands - are defined here as a single set of actions with
 * a `scope` and `group` that determine where they appear and how they behave.
 *
 * Scope:
 *   - 'selection'  requires highlighted text, operates on it
 *   - 'document'   operates on the whole document
 *   - 'topic'      requires a topic/brief input, generates new content
 *
 * Group (for panel section headers):
 *   - 'refine'     polish existing text
 *   - 'extract'    distill structured info from text
 *   - 'generate'   create new content
 *   - 'document'   transform the whole document
 */

export type AIActionScope = 'selection' | 'document' | 'topic'
export type AIActionGroup = 'refine' | 'extract' | 'generate' | 'document'
export type AIActionMode = 'replace' | 'insert'

export interface AIActionSubVariant {
  id: string
  label: string
  context?: string
}

export interface AIActionDef {
  id: string
  label: string
  description: string
  icon: string
  group: AIActionGroup
  scope: AIActionScope
  mode: AIActionMode
  maxTokens: number
  temperature: number
  stop?: string[]
  /** Text prepended to the model's response to anchor output format. */
  responsePrefix?: string
  /** Sub-variants shown as a flyout submenu (e.g. tone options). */
  subVariants?: AIActionSubVariant[]
  /** Needs a topic/brief input from the user. */
  needsTopic?: boolean
  /** Supports optional keywords input. */
  supportsKeywords?: boolean
  /** Custom label for the topic input field. */
  topicLabel?: string
  /** When true, pass the full document text as context (budget-aware). */
  needsFullDocument?: boolean
  /**
   * LoRA task family for this action. When set, the engine will auto-load
   * the corresponding LoRA adapter before generation.
   * Maps to the family names in the LoRA registry: extract_json,
   * rewrite_grammar, summarize_catchup, doc_creative, slides_deck.
   */
  loraTask?: string
  /**
   * When true, use outline-based context (headings + first sentence per
   * section) instead of full document text. Scales to any document size.
   * Used by suggest_title, write_intro, write_conclusion.
   */
  useOutlineContext?: boolean
  /**
   * Build the system and user prompts.
   * For selection scope: (selection, context?) => prompts
   * For topic scope: (topic, _selection, context?, keywords?) => prompts
   * For document scope: (_topic, _selection, context?) => prompts
   */
  buildPrompt: (
    input: string,
    context?: string,
    keywords?: string,
  ) => { system: string; user: string; responsePrefix?: string }
}

function keywordLine(keywords?: string): string {
  const trimmed = keywords?.trim()
  return trimmed ? `\nKeywords to cover: "${trimmed}"` : ''
}

/** Extract all markdown headings from a document as an outline string. */
export function extractOutline(documentText: string): string {
  const headingRe = /^(#{1,6})\s+(.+)$/
  const outlineLines: string[] = []
  for (const line of documentText.split('\n')) {
    const m = line.match(headingRe)
    if (m) outlineLines.push(`${'#'.repeat(m[1].length)} ${m[2].trim()}`)
  }
  return outlineLines.join('\n')
}

export const AI_ACTIONS: Record<string, AIActionDef> = {
  // --- Refine (selection-scoped) -----------------------------------------

  improve_writing: {
    id: 'improve_writing',
    label: 'Improve Writing',
    description: 'Improve clarity and readability',
    icon: 'Wand2',
    group: 'refine',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 300,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    subVariants: [
      { id: 'clarity', label: 'Clarity', context: 'for clarity and readability' },
      { id: 'concise', label: 'Concise', context: 'to be more concise' },
      { id: 'engaging', label: 'Engaging', context: 'to be more engaging' },
    ],
    buildPrompt: (selection, context) => ({
      system: `Improve the text ${context || 'for clarity and flow'}. Keep the meaning. Output only the improved text.`,
      user: selection,
    }),
  },

  fix_grammar: {
    id: 'fix_grammar',
    label: 'Fix Grammar',
    description: 'Fix spelling and grammar',
    icon: 'CheckCheck',
    group: 'refine',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 300,
    temperature: 0.2,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    buildPrompt: (selection) => ({
      system: 'Fix spelling and grammar errors only. Keep meaning and style. Output only the corrected text.',
      user: selection,
    }),
  },

  simplify: {
    id: 'simplify',
    label: 'Simplify',
    description: 'Simplify the language',
    icon: 'Wand2',
    group: 'refine',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 300,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    buildPrompt: (selection) => ({
      system: 'Simplify the text. Use shorter sentences and simpler words. Output only the simplified text.',
      user: selection,
    }),
  },

  change_tone: {
    id: 'change_tone',
    label: 'Change Tone',
    description: 'Rewrite in a different tone',
    icon: 'Wand2',
    group: 'refine',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 300,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    subVariants: [
      { id: 'professional', label: 'Professional', context: 'in a professional tone' },
      { id: 'casual', label: 'Casual', context: 'in a casual, friendly tone' },
      { id: 'confident', label: 'Confident', context: 'in a confident, assertive tone' },
      { id: 'friendly', label: 'Friendly', context: 'in a warm, friendly tone' },
    ],
    buildPrompt: (selection, context) => ({
      system: `Rewrite ${context || 'in a professional tone'}. Keep the meaning. Output only the rewritten text.`,
      user: selection,
    }),
  },

  make_longer: {
    id: 'make_longer',
    label: 'Make Longer',
    description: 'Add more detail and depth',
    icon: 'Maximize2',
    group: 'refine',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 400,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    buildPrompt: (selection) => ({
      system: 'Expand the text with more detail, examples, and depth. Keep the same style and meaning. Output only the expanded text.',
      user: selection,
    }),
  },

  make_shorter: {
    id: 'make_shorter',
    label: 'Make Shorter',
    description: 'Condense without losing key info',
    icon: 'Minimize2',
    group: 'refine',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 200,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    buildPrompt: (selection) => ({
      system: 'Condense the text to be shorter. Keep all key information. Do not use bullet points. Output only the shortened text.',
      user: selection,
    }),
  },

  translate: {
    id: 'translate',
    label: 'Translate',
    description: 'Translate to target language',
    icon: 'Languages',
    group: 'refine',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 1024,
    temperature: 0.2,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    subVariants: [
      { id: 'spanish', label: 'Spanish', context: 'Spanish' },
      { id: 'french', label: 'French', context: 'French' },
      { id: 'german', label: 'German', context: 'German' },
      { id: 'japanese', label: 'Japanese', context: 'Japanese' },
      { id: 'chinese', label: 'Chinese', context: 'Chinese' },
      { id: 'vietnamese', label: 'Vietnamese', context: 'Vietnamese' },
    ],
    buildPrompt: (selection, context) => {
      const lang = context || 'Spanish'
      // Language-specific data: native name and native instruction.
      // Including the target language in its own script primes the model to
      // output in that script and reduces code-switching.
      const langData: Record<string, { native: string; instruction: string }> = {
        Spanish: { native: 'español', instruction: 'Traduzca el siguiente texto al español. No deje ninguna palabra ni título en inglés.' },
        French: { native: 'français', instruction: 'Traduisez le texte suivant en français. Ne laissez aucun mot ni titre en anglais.' },
        German: { native: 'Deutsch', instruction: 'Übersetzen Sie den folgenden Text ins Deutsche. Lassen Sie keine englischen Wörter oder Überschriften stehen.' },
        Japanese: { native: '日本語', instruction: '以下のテキストを日本語に翻訳してください。英語の単語や見出しを残さないでください。' },
        Chinese: { native: '中文', instruction: '请将以下文本翻译成中文。所有英文单词和标题都必须翻译成中文，只有专有名词（如Apple、App Store、GDPR）可以保留英文。' },
        Vietnamese: { native: 'Tiếng Việt', instruction: 'Vui lòng dịch văn bản sau sang tiếng Việt. Không để lại bất kỳ từ hoặc tiêu đề tiếng Anh nào.' },
      }
      const ld = langData[lang] || { native: lang, instruction: `Translate to ${lang}. Do not leave any English words or headings untranslated.` }
      return {
        system: `You are a professional translator. Translate the following text into ${lang} (${ld.native}). ${ld.instruction}\nRules:\n1. Translate ALL text completely — do not leave any English words, phrases, or headings untranslated.\n2. Output ONLY the translated text, no explanations.\n3. Keep formatting (headings, lists, line breaks) intact.\n4. Translate markdown headings too — do not leave headings in English.\n5. Common English words (suspension, appeal, inactivity, violation, account, review, process, submit, documentation, evidence, verification, security, privacy, encryption) MUST be translated. Only proper nouns (Apple, KChat, App Store, GDPR) may stay in English.\n6. If a term has no direct translation, transliterate it and keep it consistent.`,
        user: selection,
      }
    },
  },

  // --- Extract (selection-scoped) ----------------------------------------

  summarize: {
    id: 'summarize',
    label: 'Summarize',
    description: 'Condense to key points',
    icon: 'FileText',
    group: 'extract',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 150,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'summarize_catchup',
    responsePrefix: '- ',
    buildPrompt: (selection) => ({
      system: 'Summarize in 2-3 bullet points starting with "- ". Be concise. Output only the bullets.',
      user: selection,
    }),
  },

  key_takeaways: {
    id: 'key_takeaways',
    label: 'Key Takeaways',
    description: 'Extract 3-5 key points',
    icon: 'KeyRound',
    group: 'extract',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 200,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'extract_json',
    responsePrefix: '1. ',
    buildPrompt: (selection) => ({
      system: 'Extract 3-5 key takeaways as a numbered list (1. 2. 3.). Be concise. Output only the list.',
      user: selection,
    }),
  },

  extract_actions: {
    id: 'extract_actions',
    label: 'Extract Action Items',
    description: 'Extract action items as a list',
    icon: 'ListChecks',
    group: 'extract',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 150,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'extract_json',
    responsePrefix: '- ',
    buildPrompt: (selection) => ({
      system: 'Extract action items as a bullet list starting with "- ". Be concise. Output only the list.',
      user: selection,
    }),
  },

  generate_heading: {
    id: 'generate_heading',
    label: 'Suggest Heading',
    description: 'Suggest a heading for section',
    icon: 'Heading',
    group: 'extract',
    scope: 'selection',
    mode: 'replace',
    maxTokens: 20,
    temperature: 0.3,
    stop: ['<|im_end|>', '\n'],
    loraTask: 'doc_creative',
    buildPrompt: (selection) => ({
      system: 'Generate a single concise heading for the text. No quotes. Output only the heading.',
      user: selection,
    }),
  },

  // --- Generate (topic-scoped) -------------------------------------------

  continue_writing: {
    id: 'continue_writing',
    label: 'Continue Writing',
    description: 'Continue from where you left off',
    icon: 'Sparkles',
    group: 'generate',
    scope: 'topic',
    mode: 'insert',
    maxTokens: 150,
    temperature: 0.6,
    stop: ['<|im_end|>'],
    loraTask: 'doc_creative',
    buildPrompt: (_input, context) => ({
      system: 'Continue the text naturally. Keep the same style. Write 2-3 sentences. Output only the continuation.',
      user: context ?? '',
    }),
  },

  brainstorm_ideas: {
    id: 'brainstorm_ideas',
    label: 'Brainstorm Ideas',
    description: 'Generate ideas on a topic',
    icon: 'Lightbulb',
    group: 'generate',
    scope: 'topic',
    mode: 'insert',
    maxTokens: 600,
    temperature: 0.7,
    stop: ['<|im_end|>'],
    loraTask: 'doc_creative',
    responsePrefix: '- ',
    needsTopic: true,
    buildPrompt: (topic) => ({
      system: 'Generate 5-7 creative ideas as bullet points (- ). Be specific and actionable. Output only the bullets.',
      user: `Brainstorm ideas for: ${topic}`,
    }),
  },

  generate_outline: {
    id: 'generate_outline',
    label: 'Generate Outline',
    description: 'Create a document outline from a topic',
    icon: 'ListTree',
    group: 'generate',
    scope: 'topic',
    mode: 'insert',
    maxTokens: 800,
    temperature: 0.4,
    stop: ['<|im_end|>'],
    loraTask: 'doc_creative',
    responsePrefix: '# ',
    needsTopic: true,
    supportsKeywords: true,
    buildPrompt: (topic, _context, keywords) => ({
      system:
        'Generate a document outline as markdown headings (# for title, ## for sections, ### for subsections). ' +
        'Use bullet points (-) for details under each section. ' +
        'Cover the given keywords. Output only the outline.',
      user: `Create an outline for: ${topic}${keywordLine(keywords)}`,
    }),
  },

  write_section: {
    id: 'write_section',
    label: 'Write Section',
    description: 'Write a section from an instruction',
    icon: 'PenLine',
    group: 'generate',
    scope: 'topic',
    mode: 'insert',
    maxTokens: 600,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    loraTask: 'doc_creative',
    needsTopic: true,
    needsFullDocument: true,
    supportsKeywords: true,
    topicLabel: 'Instruction',
    buildPrompt: (topic, context, keywords) => {
      // Use only the outline (extracted from the full document) as context,
      // not the full document text. Including both doubles token usage and
      // overflows the context window on moderately-sized documents.
      const outline = context?.trim() ? extractOutline(context) : ''
      const outlineLine = outline ? `\nFull document outline:\n${outline}` : ''
      return {
        system:
          'Write a document section following the instruction. ' +
          'Cover the keywords naturally. ' +
          'If an outline is provided, fit coherently and do not duplicate other sections. ' +
          'Write 2-4 paragraphs. Output only the content, no headings.',
        user: `Instruction: ${topic}${keywordLine(keywords)}${outlineLine}`,
      }
    },
  },

  generate_document: {
    id: 'generate_document',
    label: 'Generate Document',
    description: 'Generate a full document from a brief',
    icon: 'Sparkles',
    group: 'generate',
    scope: 'topic',
    mode: 'insert',
    maxTokens: 1500,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    loraTask: 'doc_creative',
    responsePrefix: '# ',
    needsTopic: true,
    supportsKeywords: true,
    buildPrompt: (topic, _context, keywords) => ({
      system:
        'Generate a complete document based on the brief. ' +
        'Use markdown headings (##) for sections and (-) for bullet lists. ' +
        'Cover the keywords. Write clear, well-structured content. Output only the document.',
      user: `Write a document about: ${topic}${keywordLine(keywords)}`,
    }),
  },

  // --- Document (whole-doc scoped) ---------------------------------------

  summarize_document: {
    id: 'summarize_document',
    label: 'Summarize Document',
    description: 'Summarize the entire document in bullet points',
    icon: 'FileText',
    group: 'document',
    scope: 'document',
    mode: 'replace',
    maxTokens: 400,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'summarize_catchup',
    responsePrefix: '- ',
    needsFullDocument: true,
    buildPrompt: (_input, context) => ({
      system: 'Summarize the document in 3-5 bullet points (- ). Capture the key points. Output only the bullets.',
      user: `Summarize this document:\n\n${context ?? ''}`,
    }),
  },

  improve_document: {
    id: 'improve_document',
    label: 'Improve Document',
    description: 'Review and improve the entire document',
    icon: 'Wand2',
    group: 'document',
    scope: 'document',
    mode: 'replace',
    maxTokens: 1500,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    needsFullDocument: true,
    buildPrompt: (_input, context) => ({
      system:
        'Improve the document for clarity, flow, and professionalism. Fix grammar and structure. Keep the meaning.\n' +
        'Markdown rules: blank line before/after headings, one heading per line, one paragraph per line.\n' +
        'Use # for title, ## for sections, - for bullets.\n' +
        'Output only the improved document.',
      user: `Improve this document:\n\n${context ?? ''}`,
    }),
  },

  format_document: {
    id: 'format_document',
    label: 'Format Document',
    description: 'Reformat with proper headings, lists, and structure',
    icon: 'AlignLeft',
    group: 'document',
    scope: 'document',
    mode: 'replace',
    maxTokens: 1500,
    temperature: 0.2,
    stop: ['<|im_end|>'],
    loraTask: 'rewrite_grammar',
    needsFullDocument: true,
    buildPrompt: (_input, context) => ({
      system:
        'Reformat the text into a well-structured markdown document.\n' +
        'Rules: # for title, ## for sections, ### for subsections. Blank line before/after headings. ' +
        'Use - for bullets, 1. 2. for numbered lists. One paragraph per line.\n' +
        'Do NOT change wording or fix grammar. Preserve all information. Output only the formatted document.',
      user: `Format this document:\n\n${context ?? ''}`,
    }),
  },

  suggest_title: {
    id: 'suggest_title',
    label: 'Suggest Title',
    description: 'Generate a title for the document',
    icon: 'Heading',
    group: 'document',
    scope: 'document',
    mode: 'replace',
    maxTokens: 60,
    temperature: 0.6,
    stop: ['<|im_end|>', '\n'],
    loraTask: 'doc_creative',
    needsFullDocument: true,
    useOutlineContext: true,
    buildPrompt: (_input, context) => ({
      system: 'Generate a single concise, engaging title for the document. No quotes. Output only the title.',
      user: `Document outline and section summaries:\n${context ?? ''}`,
    }),
  },

  write_intro: {
    id: 'write_intro',
    label: 'Write Intro',
    description: 'Write an engaging introduction',
    icon: 'AlignStartHorizontal',
    group: 'document',
    scope: 'document',
    mode: 'replace',
    maxTokens: 400,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    loraTask: 'doc_creative',
    needsFullDocument: true,
    useOutlineContext: true,
    buildPrompt: (_input, context) => ({
      system: 'Write an engaging introduction paragraph for the document. Hook the reader and preview the key topics based on the outline. Output only the introduction, no heading.',
      user: `Document outline and section summaries:\n${context ?? ''}`,
    }),
  },

  write_conclusion: {
    id: 'write_conclusion',
    label: 'Write Conclusion',
    description: 'Write a conclusion that summarizes key points',
    icon: 'AlignEndHorizontal',
    group: 'document',
    scope: 'document',
    mode: 'replace',
    maxTokens: 400,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    loraTask: 'doc_creative',
    needsFullDocument: true,
    useOutlineContext: true,
    buildPrompt: (_input, context) => ({
      system: 'Write a conclusion paragraph that summarizes the key points and provides closure. Output only the conclusion, no heading.',
      user: `Document outline and section summaries:\n${context ?? ''}`,
    }),
  },
}

// --- Derived lists for convenient consumption ---------------------------

export const ACTION_LIST = Object.values(AI_ACTIONS)

/** Actions shown in the highlight menu (selection-scoped only). */
export const SELECTION_ACTIONS = ACTION_LIST.filter((a) => a.scope === 'selection')

/** Actions shown in the slash menu (all actions + custom). */
export const SLASH_ACTIONS = ACTION_LIST

/** Actions grouped by their group field, for panel section headers. */
export const ACTIONS_BY_GROUP: Record<AIActionGroup, AIActionDef[]> = {
  refine: ACTION_LIST.filter((a) => a.group === 'refine'),
  extract: ACTION_LIST.filter((a) => a.group === 'extract'),
  generate: ACTION_LIST.filter((a) => a.group === 'generate'),
  document: ACTION_LIST.filter((a) => a.group === 'document'),
}

export const GROUP_LABELS: Record<AIActionGroup, string> = {
  refine: 'Refine',
  extract: 'Extract',
  generate: 'Generate',
  document: 'Document',
}

export const GROUP_ORDER: AIActionGroup[] = ['refine', 'extract', 'generate', 'document']
