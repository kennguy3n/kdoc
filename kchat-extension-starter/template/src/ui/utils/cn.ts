/**
 * Utility for combining class names with Tailwind CSS conflict resolution.
 * Mirrors the helper used in the host app at `@/core/utils/cn` so component
 * authoring stays consistent across the host and extension surfaces.
 */

import {type ClassValue, clsx} from 'clsx'
import {twMerge} from 'tailwind-merge'

/**
 * Combine class names, resolving Tailwind conflicts deterministically.
 *
 * @example
 * cn('px-2 py-1', isActive && 'bg-primary text-primary-foreground')
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
