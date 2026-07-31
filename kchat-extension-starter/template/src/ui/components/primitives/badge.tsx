/**
 * Badge primitive — small label / chip used for tags, status, metadata.
 */

import {cva, type VariantProps} from 'class-variance-authority'
import {type ComponentProps} from 'react'

import {cn} from '@/ui/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        primary: 'bg-primary-soft text-primary',
        success: 'bg-success/12 text-success',
        warning: 'bg-warning/15 text-warning-foreground',
        outline: 'border border-border text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({className, variant, ...props}: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({variant}), className)}
      {...props}
    />
  )
}

export {badgeVariants}
