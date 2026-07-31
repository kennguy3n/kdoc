import {Check, Loader2, X} from 'lucide-react'

import {cn} from '@/ui/utils'

export type GhostBlockState = 'streaming' | 'done' | 'error'

export interface GhostBlockProps {
  state: GhostBlockState
  position: {top: number; left: number} | null
  errorMessage?: string
  onAccept: () => void
  onReject: () => void
}

export function GhostBlock({state, position, errorMessage, onAccept, onReject}: GhostBlockProps) {
  if (state === 'error') {
    return (
      <div
        className="absolute z-30 flex items-center gap-2 rounded-lg border border-danger/30 bg-surface px-3 py-1.5 shadow-lg"
        style={position ? {top: position.top, left: position.left} : undefined}
      >
        <span className="text-xs text-danger">{errorMessage || 'Failed to generate'}</span>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            onReject()
          }}
          className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'absolute z-30 flex items-center gap-1 rounded-lg border border-border bg-surface px-1.5 py-1 shadow-lg',
        'animate-in fade-in slide-in-from-bottom-1 duration-150',
      )}
      style={position ? {top: position.top, left: position.left} : undefined}
    >
      {state === 'streaming' && (
        <span className="flex items-center gap-1.5 px-1.5 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Generating...
        </span>
      )}
      {state === 'done' && (
        <>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              onAccept()
            }}
            className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/20"
          >
            <Check className="h-3 w-3" />
            Accept
            <kbd className="ml-0.5 rounded bg-brand/10 px-1 text-[10px] font-normal">Tab</kbd>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              onReject()
            }}
            className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-3"
          >
            <X className="h-3 w-3" />
            Reject
            <kbd className="ml-0.5 rounded bg-surface-3 px-1 text-[10px] font-normal">Esc</kbd>
          </button>
        </>
      )}
    </div>
  )
}
