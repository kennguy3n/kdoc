export interface KDocDocument {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'kdoc:documents'

function getStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readIndex(): Record<string, {title: string; createdAt: number; updatedAt: number}> {
  const storage = getStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeIndex(index: Record<string, {title: string; createdAt: number; updatedAt: number}>) {
  const storage = getStorage()
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify(index))
}

export function listDocuments(): KDocDocument[] {
  const index = readIndex()
  return Object.entries(index)
    .map(([id, meta]) => ({
      id,
      title: meta.title,
      content: '',
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getDocument(id: string): KDocDocument | null {
  const storage = getStorage()
  if (!storage) return null
  const index = readIndex()
  const meta = index[id]
  if (!meta) return null
  const raw = storage.getItem(`${STORAGE_KEY}:content:${id}`)
  return {
    id,
    title: meta.title,
    content: raw ?? '',
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

export function createDocument(title = 'Untitled', content = ''): KDocDocument {
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  const index = readIndex()
  index[id] = {title, createdAt: now, updatedAt: now}
  writeIndex(index)
  const storage = getStorage()
  if (storage) {
    storage.setItem(`${STORAGE_KEY}:content:${id}`, content)
  }
  return {id, title, content, createdAt: now, updatedAt: now}
}

export function saveDocument(id: string, content: string, title?: string): void {
  const storage = getStorage()
  if (!storage) return
  const index = readIndex()
  const meta = index[id]
  if (!meta) return
  storage.setItem(`${STORAGE_KEY}:content:${id}`, content)
  if (title !== undefined) {
    meta.title = title
  }
  meta.updatedAt = Date.now()
  index[id] = meta
  writeIndex(index)
}

export function deleteDocument(id: string): void {
  const storage = getStorage()
  if (!storage) return
  const index = readIndex()
  delete index[id]
  writeIndex(index)
  storage.removeItem(`${STORAGE_KEY}:content:${id}`)
}

export function renameDocument(id: string, title: string): void {
  const index = readIndex()
  const meta = index[id]
  if (!meta) return
  meta.title = title
  meta.updatedAt = Date.now()
  writeIndex(index)
}
