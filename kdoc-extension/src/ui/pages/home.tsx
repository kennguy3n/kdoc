import {
  ClipboardList,
  FileText,
  Lightbulb,
  ListChecks,
  Loader2,
  Mail,
  PenLine,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '@/ui/components/primitives'
import { Button } from '@/ui/components/primitives'
import {
  createDocument,
  deleteDocument,
  listDocuments,
  type KDocDocument,
} from '@/ui/lib/doc-storage'
import { DOC_TEMPLATES, type DocTemplate } from '@/ui/lib/doc-templates'
import { importDocxToHtml } from '@/ui/lib/docx-import'
import { cn } from '@/ui/utils'

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
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleImportClick = useCallback(() => {
    setImportError('')
    fileInputRef.current?.click()
  }, [])

  const handleImportFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Reset input so the same file can be re-selected later.
      e.target.value = ''
      if (!file) return
      if (!/\.docx$/i.test(file.name)) {
        setImportError('Please select a .docx file.')
        return
      }
      setImporting(true)
      setImportError('')
      try {
        const { html, title } = await importDocxToHtml(file)
        const doc = createDocument(title, html)
        navigate(`/editor?doc=${doc.id}`)
      } catch (err) {
        console.error('docx import failed:', err)
        setImportError(err instanceof Error ? err.message : 'Failed to import .docx file.')
      } finally {
        setImporting(false)
      }
    },
    [navigate],
  )

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <FileText className="text-brand h-5 w-5" />
          <h1 className="text-fg text-lg font-semibold">KDoc</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleImportClick} disabled={importing}>
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Import .docx
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowTemplates(true)}>
            <Plus className="h-4 w-4" />
            New Document
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </header>

      {importError && (
        <div className="border-danger/30 bg-danger/10 text-danger mx-6 mt-3 rounded-lg border px-3 py-2 text-xs">
          {importError}
        </div>
      )}

      <div className="px-6 py-3">
        <div className="relative">
          <Search className="text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              'border-border bg-surface text-fg w-full rounded-lg border py-2 pr-3 pl-9 text-sm',
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
            description={
              search ? 'Try a different search term.' : 'Create your first document to get started.'
            }
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
                  'group border-border bg-surface flex flex-col gap-1 rounded-xl border p-4 text-left',
                  'hover:border-brand/50 hover:bg-surface-2 cursor-pointer transition-colors',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <FileText className="text-muted mt-0.5 h-4 w-4 shrink-0" />
                  <button
                    type="button"
                    onClick={(e) => handleDelete(doc.id, e)}
                    className={cn(
                      'text-muted rounded p-1 opacity-0 transition-opacity',
                      'hover:bg-danger/10 hover:text-danger group-hover:opacity-100',
                    )}
                    aria-label="Delete document"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <h3 className="text-fg truncate text-sm font-medium">{doc.title}</h3>
                <p className="text-muted text-xs">
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
            className="border-border bg-surface w-full max-w-2xl rounded-2xl border p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-fg text-lg font-semibold">Choose a Template</h2>
              <button
                type="button"
                onClick={() => setShowTemplates(false)}
                className="text-muted hover:bg-surface-2 hover:text-fg rounded p-1"
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
                      'border-border flex flex-col items-start gap-2 rounded-xl border p-4 text-left',
                      'hover:border-brand/50 hover:bg-surface-2 transition-colors',
                    )}
                  >
                    <Icon className="text-brand h-5 w-5" />
                    <span className="text-fg text-sm font-medium">{template.label}</span>
                    <span className="text-muted text-xs">{template.description}</span>
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
