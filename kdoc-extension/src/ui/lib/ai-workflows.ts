export interface AIWorkflowDef {
  id: string
  label: string
  description: string
  icon: string
  needsTopic: boolean
  needsSelection: boolean
  supportsKeywords?: boolean
  /** When true, pass the full document text as context instead of a 500-char
   *  preview. Used by whole-document workflows like format/improve. */
  needsFullDocument?: boolean
  topicLabel?: string
  maxTokens: number
  temperature: number
  stop?: string[]
  buildPrompt: (
    topic: string,
    selection: string,
    context?: string,
    keywords?: string,
  ) => { system: string; user: string }
}

function keywordLine(keywords?: string): string {
  const trimmed = keywords?.trim()
  return trimmed ? `\nKeywords to cover: "${trimmed}"` : ''
}

export const AI_WORKFLOWS: Record<string, AIWorkflowDef> = {
  generate_outline: {
    id: 'generate_outline',
    label: 'Generate Outline',
    description: 'Create a document outline from a topic',
    icon: 'ListTree',
    needsTopic: true,
    needsSelection: false,
    supportsKeywords: true,
    maxTokens: 800,
    temperature: 0.4,
    stop: ['<|im_end|>'],
    buildPrompt: (topic, _selection, _context, keywords) => ({
      system:
        'You are a writing assistant. Generate a document outline as markdown headings (## for sections, ### for subsections). Use bullet points with - for details. Make sure the outline covers the given keywords. Output only the outline. No explanations.',
      user: `Create an outline for: "${topic}"${keywordLine(keywords)}`,
    }),
  },
  write_section_by_instruction: {
    id: 'write_section_by_instruction',
    label: 'Write Section by Instruction',
    description: 'Write a section from an instruction: topic, keywords, requirements',
    icon: 'PenLine',
    needsTopic: true,
    needsSelection: false,
    supportsKeywords: true,
    topicLabel: 'Instruction',
    maxTokens: 600,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    buildPrompt: (topic, _selection, context, keywords) => ({
      system:
        'You are a writing assistant. Write a document section following the instruction. Cover the given keywords naturally. Match the document style when context is provided. Write 2-4 paragraphs. Output only the content, no headings, no explanations.',
      user: `Instruction: "${topic}"${keywordLine(keywords)}${context?.trim() ? `\nDocument context: "${context}"` : ''}`,
    }),
  },
  write_section: {
    id: 'write_section',
    label: 'Write Section',
    description: 'Write content for a section heading',
    icon: 'PenLine',
    needsTopic: false,
    needsSelection: true,
    maxTokens: 600,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    buildPrompt: (_topic, selection, context) => ({
      system:
        'You are a writing assistant. Write content for the given section heading. Match the document style. Write 2-4 paragraphs. Output only the content, no heading.',
      user: `Section heading: "${selection}"\nDocument context: "${context ?? ''}"`,
    }),
  },
  generate_from_brief: {
    id: 'generate_from_brief',
    label: 'Generate from Brief',
    description: 'Generate a full document from a brief description',
    icon: 'Sparkles',
    needsTopic: true,
    needsSelection: false,
    supportsKeywords: true,
    maxTokens: 1500,
    temperature: 0.5,
    stop: ['<|im_end|>'],
    buildPrompt: (topic, _selection, _context, keywords) => ({
      system:
        'You are a writing assistant. Generate a complete document based on the brief. Use markdown headings (##) for sections. Use bullet points with - for lists. Cover the given keywords. Write clear, well-structured content. Output only the document.',
      user: `Write a document about: "${topic}"${keywordLine(keywords)}`,
    }),
  },
  brainstorm_ideas: {
    id: 'brainstorm_ideas',
    label: 'Brainstorm Ideas',
    description: 'Generate ideas on a topic',
    icon: 'Lightbulb',
    needsTopic: true,
    needsSelection: false,
    maxTokens: 600,
    temperature: 0.7,
    stop: ['<|im_end|>'],
    buildPrompt: (topic) => ({
      system:
        'You are a brainstorming assistant. Generate 5-7 creative ideas as bullet points. Be specific and actionable. Output only the bullet points.',
      user: `Brainstorm ideas for: "${topic}"`,
    }),
  },
  generate_title: {
    id: 'generate_title',
    label: 'Suggest Title',
    description: 'Generate title suggestions for the document',
    icon: 'Heading',
    needsTopic: false,
    needsSelection: false,
    maxTokens: 60,
    temperature: 0.6,
    stop: ['<|im_end|>', '\n'],
    buildPrompt: (_topic, _selection, context) => ({
      system:
        'You are a title generator. Generate a single concise, engaging title for the document. No quotes, no explanations. Output only the title.',
      user: `Document content: "${context?.slice(0, 300) ?? ''}"`,
    }),
  },
  improve_document: {
    id: 'improve_document',
    label: 'Improve Document',
    description: 'Review and improve the entire document',
    icon: 'Wand2',
    needsTopic: false,
    needsSelection: false,
    needsFullDocument: true,
    maxTokens: 2000,
    temperature: 0.3,
    stop: ['<|im_end|>'],
    buildPrompt: (_topic, _selection, context) => ({
      system:
        'You are an expert editor. Improve the document for clarity, flow, and professionalism. ' +
        'Fix grammar and structure. Keep the meaning and all information.\n\n' +
        'CRITICAL MARKDOWN FORMATTING RULES:\n' +
        '- Always put a BLANK LINE before and after every heading.\n' +
        '- One heading per line. Never concatenate two headings on the same line.\n' +
        '- One paragraph per line. Never join multiple paragraphs on one line.\n' +
        '- Put a blank line before and after every list.\n' +
        '- Use ## for section headings, ### for subsections, # for the document title.\n' +
        '- Use - for bullet points, 1. 2. 3. for numbered lists.\n\n' +
        'CORRECT example:\n# Title\n\n## Section\n\nFirst paragraph here.\n\nSecond paragraph here.\n\n- Item one\n- Item two\n\n## Next Section\n\nMore text.\n\n' +
        'WRONG (do not do this): # Title## SectionFirst paragraphSecond paragraph\n\n' +
        'Output only the improved document in markdown. No explanations.',
      user: `Improve this document:\n\n${context ?? ''}`,
    }),
  },
  format_document: {
    id: 'format_document',
    label: 'Format Document',
    description: 'Reformat the entire document with proper headings, lists, and structure',
    icon: 'AlignLeft',
    needsTopic: false,
    needsSelection: false,
    needsFullDocument: true,
    maxTokens: 2000,
    temperature: 0.2,
    stop: ['<|im_end|>'],
    buildPrompt: (_topic, _selection, context) => ({
      system:
        'You are a document formatter. Reformat the text into a well-structured document using markdown.\n\n' +
        'FORMATTING RULES:\n' +
        '- Add clear headings: # for document title, ## for sections, ### for subsections.\n' +
        '- Use bullet points (-) for unordered lists.\n' +
        '- Use numbered lists (1. 2. 3.) for steps or sequences.\n' +
        '- Break long paragraphs into shorter ones (3-5 sentences each).\n\n' +
        'CRITICAL MARKDOWN SYNTAX RULES:\n' +
        '- ALWAYS put a BLANK LINE before and after every heading.\n' +
        '- One heading per line. NEVER put two headings on the same line.\n' +
        '- One paragraph per line. NEVER join paragraphs on the same line.\n' +
        '- Put a blank line before and after every list.\n\n' +
        'CORRECT example:\n# Document Title\n\n## Section One\n\nFirst paragraph of text.\n\nSecond paragraph of text.\n\n- Bullet one\n- Bullet two\n\n## Section Two\n\nMore text here.\n\n' +
        'WRONG (never do this): # Title## SectionFirst paragraphSecond paragraph- Bullet one\n\n' +
        'Do NOT change the wording, fix grammar, or rewrite content — only restructure and format. ' +
        'Preserve all original information. Output only the formatted document in markdown. No explanations.',
      user: `Format this document:\n\n${context ?? ''}`,
    }),
  },
}

export const WORKFLOW_LIST = Object.values(AI_WORKFLOWS)
