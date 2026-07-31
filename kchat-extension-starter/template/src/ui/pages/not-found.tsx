/**
 * Not-found fallback for unmatched extension routes.
 */

import {FolderSearch} from 'lucide-react'
import {memo, type ReactElement} from 'react'
import {Link} from 'react-router-dom'

import {EmptyState} from '@/ui/components/primitives'

export const NotFound = memo(function NotFound(): ReactElement {
  return (
    <section
      aria-label="Not found"
      className="flex h-full items-center justify-center bg-background px-6 py-10"
    >
      <EmptyState
        icon={FolderSearch}
        title="Nothing here"
        description="That route is not registered for this extension."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/agent"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open Agent
            </Link>
            <Link
              to="/knowledge"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              Open Knowledge
            </Link>
          </div>
        }
      />
    </section>
  )
})

NotFound.displayName = 'NotFound'
