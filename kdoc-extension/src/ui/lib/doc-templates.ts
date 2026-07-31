export interface DocTemplate {
  id: string
  label: string
  description: string
  icon: string
  category: 'blank' | 'business' | 'creative' | 'personal'
  initialTitle: string
  initialContent: string
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: 'blank',
    label: 'Blank Document',
    description: 'Start from scratch',
    icon: 'FileText',
    category: 'blank',
    initialTitle: 'Untitled',
    initialContent: '',
  },
  {
    id: 'meeting_notes',
    label: 'Meeting Notes',
    description: 'Structured notes with agenda and action items',
    icon: 'Users',
    category: 'business',
    initialTitle: 'Meeting Notes',
    initialContent: '<h1>Meeting Notes</h1><h2>Date & Attendees</h2><p></p><h2>Agenda</h2><ul><li></li></ul><h2>Discussion</h2><p></p><h2>Action Items</h2><ul data-type="taskList"><li><label><input type="checkbox"></label><div><p></p></div></li></ul>',
  },
  {
    id: 'blog_post',
    label: 'Blog Post',
    description: 'Article with intro, body, and conclusion',
    icon: 'PenLine',
    category: 'creative',
    initialTitle: 'Blog Post',
    initialContent: '<h1></h1><h2>Introduction</h2><p></p><h2>Main Content</h2><p></p><h2>Conclusion</h2><p></p>',
  },
  {
    id: 'report',
    label: 'Report',
    description: 'Formal report with sections and summary',
    icon: 'ClipboardList',
    category: 'business',
    initialTitle: 'Report',
    initialContent: '<h1></h1><h2>Executive Summary</h2><p></p><h2>Background</h2><p></p><h2>Findings</h2><p></p><h2>Recommendations</h2><p></p>',
  },
  {
    id: 'email',
    label: 'Email Draft',
    description: 'Professional email with subject and body',
    icon: 'Mail',
    category: 'business',
    initialTitle: 'Email Draft',
    initialContent: '<p><strong>Subject:</strong> </p><p></p><p>Best regards,</p><p></p>',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    description: 'Ideas and notes organized by topic',
    icon: 'Lightbulb',
    category: 'creative',
    initialTitle: 'Brainstorm',
    initialContent: '<h1></h1><h2>Topic</h2><p></p><h2>Ideas</h2><ul><li></li></ul><h2>Next Steps</h2><ul><li></li></ul>',
  },
  {
    id: 'letter',
    label: 'Letter',
    description: 'Formal letter format',
    icon: 'FileText',
    category: 'personal',
    initialTitle: 'Letter',
    initialContent: '<p></p><p></p><p>Dear ,</p><p></p><p>Sincerely,</p><p></p>',
  },
  {
    id: 'todo',
    label: 'Task List',
    description: 'Organized task list with priorities',
    icon: 'ListChecks',
    category: 'personal',
    initialTitle: 'Task List',
    initialContent: '<h1>Task List</h1><ul data-type="taskList"><li><label><input type="checkbox"></label><div><p></p></div></li></ul>',
  },
]

export function getTemplate(id: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((t) => t.id === id)
}
