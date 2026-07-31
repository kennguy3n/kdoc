/**
 * Button primitive — interactive action.
 *
 * Slimmed-down version of the host button: same variant vocabulary
 * (default / outline / ghost / link / destructive) so contributors writing
 * extension UI use the same mental model.
 */

import {cva, type VariantProps} from 'class-variance-authority'
import {type ComponentProps, forwardRef} from 'react'

import {cn} from '@/ui/utils'

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'font-medium leading-none select-none',
    'transition-[background-color,border-color,color,opacity,transform]',
    'duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]',
        outline:
          'border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'h-9 px-4 text-sm has-[>svg]:px-3',
        sm: 'h-8 px-3 text-[13px] gap-1.5 has-[>svg]:px-2.5',
        xs: 'h-7 px-2.5 text-xs gap-1 has-[>svg]:px-2',
        lg: 'h-10 px-5 text-sm has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-xs': 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({className, variant, size, type = 'button', ...props}, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="button"
        className={cn(buttonVariants({variant, size}), className)}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'

export {buttonVariants}
