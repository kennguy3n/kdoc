import {cva, type VariantProps} from 'class-variance-authority'
import {forwardRef, type ButtonHTMLAttributes} from 'react'

import {cn} from '@/ui/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-surface-2 text-fg hover:bg-surface-3',
        primary: 'bg-brand text-brand-fg hover:bg-brand/90',
        outline: 'border border-border bg-transparent text-fg hover:bg-surface-2',
        ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
        link: 'bg-transparent text-brand underline-offset-4 hover:underline',
        destructive: 'bg-danger text-danger-fg hover:bg-danger/90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-10 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({className, variant, size, ...props}, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({variant, size}), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
