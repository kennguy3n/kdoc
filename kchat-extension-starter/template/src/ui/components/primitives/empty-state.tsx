/**
 * Empty state primitive — used for "no results", "nothing selected",
 * and "not found" surfaces across the extension.
 */

import {type LucideIcon} from 'lucide-react'
import {type ReactElement, type ReactNode} from 'react'

import {cn} from '@/ui/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div
      role="status"
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Icon aria-hidden className="size-5" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="max-w-[40ch] text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
