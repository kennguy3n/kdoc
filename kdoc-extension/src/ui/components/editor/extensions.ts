import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import Underline from '@tiptap/extension-underline'
import {StarterKit} from '@tiptap/starter-kit'
import {createLowlight, common} from 'lowlight'
import {Markdown} from 'tiptap-markdown'

import {SlashCommand} from './SlashCommand'
import {BlockDragHandle} from './DragHandle'
import {GhostMark} from './GhostMark'

const lowlight = createLowlight(common)

export function buildExtensions() {
  return [
    StarterKit.configure({
      heading: {levels: [1, 2, 3, 4]},
      codeBlock: false,
    }),
    Underline,
    Typography,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {rel: 'noopener noreferrer nofollow'},
    }),
    Placeholder.configure({
      placeholder: 'Start writing or press / for commands...',
    }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'plaintext',
    }),
    Image.configure({
      inline: false,
      allowBase64: true,
    }),
    Table.configure({resizable: true}),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({nested: true}),
    Markdown.configure({
      html: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    SlashCommand,
    BlockDragHandle,
    GhostMark,
  ]
}
