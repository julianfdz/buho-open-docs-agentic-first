import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildIndex, type DocIndex } from '@shared/index-ai'

/**
 * Caché de índices para IAs: cada documento se indexa una vez por versión (~10 ms cada 15 páginas) y se
 * guarda en <datos>/indices/<hash de la ruta>.json, que cualquier herramienta puede leer sin la app.
 * No se escribe nada junto a los documentos del usuario.
 */
const mem = new Map<string, { mtime: number; index: DocIndex }>()
const dir = (): string => join(app.getPath('userData'), 'indices')
const fileFor = (path: string): string => join(dir(), createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16) + '.json')

/** Índice del contenido actual (si se pasa `src`, de ese texto). */
export function indexOf(path: string, src?: string): DocIndex {
  const key = path.toLowerCase()
  if (src !== undefined) {
    const ix = buildIndex(src)
    const c = mem.get(key)
    if (!c || c.index.hash !== ix.hash) store(path, ix, Date.now())
    return ix
  }
  const mtime = statSync(path).mtimeMs
  const c = mem.get(key)
  if (c && c.mtime === mtime) return c.index
  const ix = buildIndex(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  store(path, ix, mtime)
  return ix
}

function store(path: string, ix: DocIndex, mtime: number): void {
  mem.set(path.toLowerCase(), { mtime, index: ix })
  try {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(fileFor(path), JSON.stringify({ path, ...ix }))
  } catch {
    /* sin caché en disco */
  }
}

/** Todos los .md de una carpeta (y subcarpetas, hasta 4 niveles; sin node_modules ni carpetas ocultas). */
export function mdFiles(folder: string, depth = 4): string[] {
  const out: string[] = []
  const walk = (d: string, n: number): void => {
    let entries: string[] = []
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      if (e.startsWith('.') || e === 'node_modules') continue
      const p = join(d, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory() && n > 0) walk(p, n - 1)
      else if (/\.(md|markdown)$/i.test(e)) out.push(p)
    }
  }
  if (existsSync(folder)) walk(folder, depth)
  return out.slice(0, 2000)
}
