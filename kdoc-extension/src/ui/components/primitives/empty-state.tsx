import type {LucideIcon} from 'lucide-react'
import type {ReactNode} from 'react'

import {cn} from '@/ui/utils'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({icon: Icon, title, description, action, className}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12 text-center', className)}>
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2">
          <Icon className="h-6 w-6 text-muted" aria-hidden="true" />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-base font-medium text-fg">{title}</h3>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
