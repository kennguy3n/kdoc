import {cva, type VariantProps} from 'class-variance-authority'
import {forwardRef, type HTMLAttributes} from 'react'

import {cn} from '@/ui/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-surface-2 text-muted',
        primary: 'bg-brand/10 text-brand',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        outline: 'border border-border text-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({className, variant, ...props}, ref) => {
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({variant}), className)}
        {...props}
      />
    )
  },
)
Badge.displayName = 'Badge'
