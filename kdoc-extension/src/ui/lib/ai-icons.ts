/**
 * Shared icon registry for AI actions.
 *
 * Both AISelectionMenu and AIPanel import from here so that an action
 * uses the same icon regardless of which surface it appears in.
 */
import {
  AlignEndHorizontal,
  AlignLeft,
  AlignStartHorizontal,
  CheckCheck,
  FileText,
  Heading,
  KeyRound,
  Languages,
  Lightbulb,
  ListChecks,
  ListTree,
  Maximize2,
  MessageSquare,
  Minimize2,
  PenLine,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react'

export const ACTION_ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Wand2,
  Lightbulb,
  FileText,
  CheckCheck,
  Heading,
  ListChecks,
  MessageSquare,
  Maximize2,
  Minimize2,
  KeyRound,
  Languages,
  ListTree,
  PenLine,
  AlignLeft,
  AlignStartHorizontal,
  AlignEndHorizontal,
}

/** Fallback icon for unknown action icon names. */
export const DEFAULT_ACTION_ICON = Sparkles
