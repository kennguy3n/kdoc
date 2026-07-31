import {FileText} from 'lucide-react'
import {Link} from 'react-router-dom'

import {EmptyState} from '@/ui/components/primitives'
import {cn} from '@/ui/utils'

export function NotFoundPage() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={FileText}
        title="Nothing here"
        description="This page doesn't exist or has been moved."
        action={
          <Link
            to="/home"
            className={cn(
              'inline-flex h-9 items-center justify-center rounded-lg bg-surface-2 px-4 text-sm font-medium text-fg',
              'transition-colors hover:bg-surface-3',
            )}
          >
            Back to Home
          </Link>
        }
      />
    </div>
  )
}
