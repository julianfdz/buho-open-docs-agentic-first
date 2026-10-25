import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { diffLines, diffStats } from '@shared/diff'
import type { ChangeKind, HistoryEntry, HistoryItem } from '@shared/types'

/**
 * Historial de cambios por documento, con autor:
 *   user     → lo escrito en la app (las rachas de escritura seguidas se agrupan en una entrada)
 *   ai       → cambios por la API/CLI, o guardados en disco anunciados antes con `buho-docs tag`
 *   external → el archivo cambió en disco sin aviso (otro editor, un script)
 * Cada entrada guarda el documento entero: así se puede volver a cualquier versión.
 */
const MAX_ENTRIES = 300
/** Lo que escribes en la app dentro de este margen va a la misma entrada. */
const MERGE_MS = 3 * 60 * 1000

const dir = (): string => join(app.getPath('userData'), 'history')
const fileFor = (path: string): string => join(dir(), createHash('sha1').update(path.toLowerCase()).digest('hex') + '.json')

/** Autores anunciados por agentes para el próximo cambio en disco de un documento. */
const tags = new Map<string, { author: string; until: number }>()

export function tagNextChange(path: string, author: string, seconds = 120): void {
  tags.set(path.toLowerCase(), { author, until: Date.now() + seconds * 1000 })
}

function read(path: string): HistoryEntry[] {
  try {
    return JSON.parse(readFileSync(fileFor(path), 'utf8')) as HistoryEntry[]
  } catch {
    return []
  }
}

function write(path: string, list: HistoryEntry[]): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(fileFor(path), JSON.stringify(list.slice(0, MAX_ENTRIES)))
}

export const listHistory = (path: string, limit = 100): HistoryItem[] => read(path).slice(0, limit).map(({ content: _c, ...rest }) => rest)
export const historyEntry = (path: string, id: string): HistoryEntry | null => read(path).find((e) => e.id === id) ?? null

/** Contenido anterior a una entrada (la siguiente más antigua), o null si es la primera. */
export function historyBefore(path: string, id: string): string | null {
  const list = read(path)
  const i = list.findIndex((e) => e.id === id)
  return i >= 0 && i + 1 < list.length ? list[i + 1].content : null
}

/** Al abrir un documento sin historial se guarda la versión de partida (para poder volver a ella). */
export function ensureBaseline(path: string, content: string): void {
  const list = read(path)
  if (list.length && list[0].content === content) return
  if (list.length) {
    // Cambió estando la app cerrada: queda como cambio externo.
    addHistory(path, { kind: 'external', author: 'Fuera de la app', summary: 'Cambiado con la app cerrada' }, content)
    return
  }
  write(path, [{ id: randomUUID(), at: Date.now(), kind: 'external', author: '—', summary: 'Versión al abrir por primera vez', added: 0, removed: 0, content }])
}

export function lastContent(path: string): string | null {
  return read(path)[0]?.content ?? null
}

export function addHistory(path: string, e: { kind: ChangeKind; author: string; summary: string }, content: string): HistoryEntry | null {
  const list = read(path)
  let entry = { ...e }
  if (entry.kind === 'external') {
    const t = tags.get(path.toLowerCase())
    if (t && t.until > Date.now()) entry = { ...entry, kind: 'ai', author: t.author, summary: entry.summary === 'Cambiado en disco' ? 'Editado con sus propias herramientas' : entry.summary }
    // La firma vale para un solo guardado.
    tags.delete(path.toLowerCase())
  }
  const prev = list[0]
  if (prev && prev.content === content) return null
  // Rachas de escritura del usuario: una sola entrada.
  if (entry.kind === 'user' && prev?.kind === 'user' && Date.now() - prev.at < MERGE_MS && list[1]) {
    const st = diffStats(diffLines(list[1].content, content))
    list[0] = { ...prev, at: Date.now(), content, ...st }
    write(path, list)
    return list[0]
  }
  const st = diffStats(diffLines(prev?.content ?? '', content))
  const full: HistoryEntry = { id: randomUUID(), at: Date.now(), ...entry, ...st, content }
  write(path, [full, ...list])
  return full
}
