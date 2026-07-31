import type {Node as PMNode} from '@tiptap/pm/model'

export function findBlockStart(pos: number, doc: PMNode): number | null {
  let $pos = doc.resolve(pos)
  while ($pos.depth > 0) {
    $pos = doc.resolve($pos.before($pos.depth))
  }
  return $pos.pos
}

export function isTopLevelBlock(pos: number, doc: PMNode): boolean {
  const $block = doc.resolve(pos)
  if ($block.depth !== 1) return false
  const node = doc.nodeAt(pos)
  if (!node) return false
  if (node.type.name === 'listItem' || node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
    return false
  }
  return true
}
