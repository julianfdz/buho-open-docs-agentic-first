import { watch, type FSWatcher, readFileSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

/**
 * Vigila los documentos abiertos y avisa cuando otro programa (una IA con su propia herramienta de
 * edición, un script, otro editor) los guarda. Se vigila la carpeta y no el archivo: muchos programas
 * guardan escribiendo un temporal y renombrándolo, y eso rompe un watch sobre el propio archivo.
 */
type OnChange = (path: string, text: string) => void

interface Entry {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
  sig: string
}

const entries = new Map<string, Entry>()
const norm = (p: string): string => p.toLowerCase()

function signature(path: string): string {
  try {
    const s = statSync(path)
    return `${s.size}:${s.mtimeMs}`
  } catch {
    return 'missing'
  }
}

/** Lee con reintentos: justo al guardar, el otro programa puede tener el archivo bloqueado un instante. */
async function readStable(path: string): Promise<string | null> {
  for (let i = 0; i < 8; i++) {
    try {
      return readFileSync(path, 'utf8').replace(/^﻿/, '')
    } catch {
      await new Promise((r) => setTimeout(r, 120 * (i + 1)))
    }
  }
  return null
}

export function watchFile(path: string, onChange: OnChange): void {
  const key = norm(path)
  if (entries.has(key)) return
  const name = basename(path).toLowerCase()
  try {
    const w = watch(dirname(path), { persistent: false }, (_ev, file) => {
      if (file && file.toString().toLowerCase() !== name) return
      const e = entries.get(key)
      if (!e) return
      // Un guardado genera varias señales seguidas: se agrupan.
      if (e.timer) clearTimeout(e.timer)
      e.timer = setTimeout(async () => {
        e.timer = null
        const sig = signature(path)
        if (sig === e.sig || sig === 'missing') return
        const text = await readStable(path)
        if (text === null) return
        e.sig = signature(path)
        onChange(path, text)
      }, 140)
    })
    entries.set(key, { watcher: w, timer: null, sig: signature(path) })
  } catch {
    /* carpeta no vigilable (algunas unidades de red): sin recarga en vivo */
  }
}

export function unwatchFile(path: string): void {
  const e = entries.get(norm(path))
  if (!e) return
  e.watcher.close()
  if (e.timer) clearTimeout(e.timer)
  entries.delete(norm(path))
}

/** Tras guardar desde la app: se anota la nueva versión para no tomarla por un cambio externo. */
export function markOwnWrite(path: string): void {
  const e = entries.get(norm(path))
  if (e) e.sig = signature(path)
}
