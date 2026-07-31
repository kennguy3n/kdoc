import {
  ClipboardList,
  FileText,
  Lightbulb,
  ListChecks,
  Mail,
  PenLine,
  Plus,
  Search,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import {useCallback, useEffect, useMemo, useState, type MouseEvent} from 'react'
import {useNavigate} from 'react-router-dom'

import {EmptyState} from '@/ui/components/primitives'
import {Button} from '@/ui/components/primitives'
import {createDocument, deleteDocument, listDocuments, type KDocDocument} from '@/ui/lib/doc-storage'
import {DOC_TEMPLATES, type DocTemplate} from '@/ui/lib/doc-templates'
import {cn} from '@/ui/utils'

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  FileText,
  Users,
  PenLine,
  ClipboardList,
  Mail,
  Lightbulb,
  ListChecks,
}

export function HomePage() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<KDocDocument[]>([])
  const [search, setSearch] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)

  const refresh = useCallback(() => {
    setDocuments(listDocuments())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    if (!search.trim()) return documents
    return documents.filter((d) => d.title.toLowerCase().includes(search.toLowerCase()))
  }, [documents, search])

  const handleCreateFromTemplate = useCallback(
    (template: DocTemplate) => {
      const doc = createDocument(template.initialTitle, template.initialContent)
      setShowTemplates(false)
      navigate(`/editor?doc=${doc.id}`)
    },
    [navigate],
  )

  const handleDelete = useCallback(
    (id: string, e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      deleteDocument(id)
      refresh()
    },
    [refresh],
  )

  const handleOpen = useCallback(
    (id: string) => {
      navigate(`/editor?doc=${id}`)
    },
    [navigate],
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold text-fg">KDoc</h1>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowTemplates(true)}>
          <Plus className="h-4 w-4" />
          New Document
        </Button>
      </header>

      <div className="px-6 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              'w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg',
              'placeholder:text-muted focus:border-brand focus:outline-none',
            )}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={search ? 'No documents found' : 'No documents yet'}
            description={search ? 'Try a different search term.' : 'Create your first document to get started.'}
            action={
              !search && (
                <Button variant="primary" onClick={() => setShowTemplates(true)}>
                  <Plus className="h-4 w-4" />
                  Create Document
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                role="button"
                tabIndex={0}
                onClick={() => handleOpen(doc.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleOpen(doc.id)
                }}
                className={cn(
                  'group flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 text-left',
                  'transition-colors hover:border-brand/50 hover:bg-surface-2 cursor-pointer',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <button
                    type="button"
                    onClick={(e) => handleDelete(doc.id, e)}
                    className={cn(
                      'rounded p-1 text-muted opacity-0 transition-opacity',
                      'hover:bg-danger/10 hover:text-danger group-hover:opacity-100',
                    )}
                    aria-label="Delete document"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <h3 className="truncate text-sm font-medium text-fg">{doc.title}</h3>
                <p className="text-xs text-muted">
                  {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTemplates && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setShowTemplates(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-fg">Choose a Template</h2>
              <button
                type="button"
                onClick={() => setShowTemplates(false)}
                className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {DOC_TEMPLATES.map((template) => {
                const Icon = TEMPLATE_ICONS[template.icon] ?? FileText
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleCreateFromTemplate(template)}
                    className={cn(
                      'flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left',
                      'transition-colors hover:border-brand/50 hover:bg-surface-2',
                    )}
                  >
                    <Icon className="h-5 w-5 text-brand" />
                    <span className="text-sm font-medium text-fg">{template.label}</span>
                    <span className="text-xs text-muted">{template.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
