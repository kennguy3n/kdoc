import {Mark} from '@tiptap/core'

export const GhostMark = Mark.create({
  name: 'ghostMark',

  inclusive: false,

  parseHTML() {
    return [
      {tag: 'span[data-ghost]'},
    ]
  },

  renderHTML() {
    return ['span', {
      'data-ghost': 'true',
      class: 'ghost-text',
    }, 0]
  },

  addCSS() {
    return `
      .ghost-text {
        background-color: color-mix(in oklch, var(--brand) 12%, transparent);
        border-radius: 3px;
        padding: 0 1px;
        transition: background-color 0.2s;
      }
      .ghost-text::after {
        content: '';
        display: inline-block;
        width: 2px;
        height: 1em;
        margin-left: 1px;
        background: var(--brand);
        vertical-align: text-bottom;
        animation: ghost-cursor-blink 1s step-end infinite;
      }
      @keyframes ghost-cursor-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
    `
  },
})
