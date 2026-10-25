import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { kindOf, splitFront, titleOf } from '@shared/doc'
import type { ChangeKind, DocChange, OpenDoc, RecentDoc } from '@shared/types'
import { addHistory, ensureBaseline } from './history'
import { markOwnWrite, unwatchFile, watchFile } from './watcher'
import { forget, warm } from './exporter'

/**
 * Documentos abiertos. El archivo en disco es la fuente de verdad: la app guarda lo que escribes
 * (al dejar de escribir), la IA cambia el archivo por la API o directamente, y todo pasa por aquí
 * para quedar en el historial y llegar a la ventana en directo.
 */
export interface Bridge {
  /** Manda un mensaje a la ventana. */
  send(channel: string, payload: unknown): void
  /** Pide a la ventana que guarde lo pendiente de ese documento (antes de que escriba la IA). */
  flush(path: string): Promise<void>
}

let bridge: Bridge = { send: () => {}, flush: async () => {} }
export const setBridge = (b: Bridge): void => {
  bridge = b
}

const known = new Map<string, string>() // ruta (minúsculas) → último contenido conocido
const opened: string[] = [] // rutas abiertas, en orden
const key = (p: string): string => p.toLowerCase()

export function normPath(p: string): string {
  return resolve(p.replace(/^["']|["']$/g, ''))
}

function readText(path: string): string {
  return readFileSync(path, 'utf8').replace(/^﻿/, '')
}

function toOpen(path: string, content: string): OpenDoc {
  return { path, name: basename(path), kind: kindOf(splitFront(content).meta), title: titleOf(content, basename(path)), content }
}

// ─── Recientes ─────────────────────────────────────────────────────────────────────────────────

const recentFile = (): string => join(app.getPath('userData'), 'recent.json')
function readRecent(): Omit<RecentDoc, 'exists'>[] {
  try {
    return JSON.parse(readFileSync(recentFile(), 'utf8'))
  } catch {
    return []
  }
}
function touchRecent(d: OpenDoc): void {
  const list = [{ path: d.path, name: d.name, kind: d.kind, title: d.title, at: Date.now() }, ...readRecent().filter((r) => key(r.path) !== key(d.path))].slice(0, 30)
  try {
    writeFileSync(recentFile(), JSON.stringify(list, null, 2))
  } catch {
    /* sin recientes */
  }
}
export const recent = (): RecentDoc[] => readRecent().map((r) => ({ ...r, exists: existsSync(r.path) }))

// ─── Abrir, cerrar, guardar ────────────────────────────────────────────────────────────────────

export function isOpen(path: string): boolean {
  return known.has(key(path))
}

export function openDocs(): { path: string; name: string; kind: string; title: string }[] {
  return opened.map((p) => {
    const d = toOpen(p, known.get(key(p)) ?? '')
    return { path: d.path, name: d.name, kind: d.kind, title: d.title }
  })
}

/** Abre (o devuelve) un documento. `announce` lo enseña en la ventana (cuando lo pide un agente). */
export function openDoc(path: string, announce = false): OpenDoc {
  path = normPath(path)
  if (!existsSync(path)) throw new Error(`No existe ${path}`)
  if (!/\.(md|markdown|txt)$/i.test(path)) throw new Error('Búho Docs abre documentos Markdown (.md)')
  const content = readText(path)
  if (!known.has(key(path))) {
    known.set(key(path), content)
    opened.push(path)
    ensureBaseline(path, content)
    watchFile(path, onDiskChange)
    warm(path, content, 400)
  }
  const d = toOpen(path, known.get(key(path))!)
  touchRecent(d)
  if (announce) bridge.send('open', d)
  return d
}

export function closeDoc(path: string): void {
  const i = opened.findIndex((p) => key(p) === key(path))
  if (i >= 0) opened.splice(i, 1)
  known.delete(key(path))
  unwatchFile(path)
  forget(path)
}

export function createDoc(path: string, content: string, author: string, kind: ChangeKind): OpenDoc {
  path = normPath(path)
  if (!/\.md$/i.test(path)) path += '.md'
  if (existsSync(path)) throw new Error(`Ya existe ${path}`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  const d = openDoc(path, false)
  addHistory(path, { kind, author, summary: 'Documento creado' }, content)
  return d
}

/** Lo que escribes en la app. */
export function saveUser(path: string, content: string): void {
  path = normPath(path)
  if (known.get(key(path)) === content) return
  writeFileSync(path, content)
  markOwnWrite(path)
  known.set(key(path), content)
  addHistory(path, { kind: 'user', author: 'Tú', summary: 'Editado en la app' }, content)
  // Mientras escribes no se imprime nada: el PDF se prepara cuando paras un momento.
  warm(path, content, 1500)
}

/** Contenido actual (lo que hay en disco; si la app tiene cambios sin guardar, los guarda antes). */
export async function current(path: string): Promise<string> {
  path = normPath(path)
  if (isOpen(path)) await bridge.flush(path)
  return readText(path)
}

/**
 * Cambio de un agente o restauración: guarda pendientes de la app, aplica `fn` sobre lo que hay en
 * disco, escribe, anota en el historial y lo enseña en directo con el cambio resaltado.
 */
export async function applyChange(path: string, fn: (src: string) => string, who: { kind: ChangeKind; author: string; summary: string }): Promise<{ changed: boolean; content: string; path: string }> {
  path = normPath(path)
  if (!isOpen(path)) openDoc(path, true)
  const before = await current(path)
  const after = fn(before)
  if (after === before) return { changed: false, content: after, path }
  writeFileSync(path, after)
  markOwnWrite(path)
  known.set(key(path), after)
  addHistory(path, who, after)
  const change: DocChange = { path, content: after, kind: who.kind, author: who.author, summary: who.summary, focus: who.kind === 'ai' }
  bridge.send('doc-change', change)
  warm(path, after, 0)
  return { changed: true, content: after, path }
}

/** El archivo cambió en disco sin pasar por la app (otro programa o una IA editándolo directamente). */
function onDiskChange(path: string, text: string): void {
  if (known.get(key(path)) === text) return
  known.set(key(path), text)
  const entry = addHistory(path, { kind: 'external', author: 'Otro programa', summary: 'Cambiado en disco' }, text)
  warm(path, text, 200)
  const kind = entry?.kind ?? 'external'
  bridge.send('doc-change', { path, content: text, kind, author: entry?.author ?? 'Otro programa', summary: entry?.summary ?? 'Cambiado en disco', focus: kind === 'ai' } satisfies DocChange)
}

// ─── Escritura en directo (streaming): el texto aparece mientras la IA lo genera ───────────────
//
// Varias escrituras a la vez en el mismo documento (generación en paralelo): cada una tiene su marca
// en una «base» común; lo que se enseña es la base con cada marca sustituida por lo que lleva escrito.
// Nada se guarda en disco hasta que termina la última.

interface Live {
  path: string
  base: string
  texts: Map<string, string>
  active: Set<string>
  author: string
  summary: string
  timer: NodeJS.Timeout | null
}
const lives = new Map<string, Live>()
const streams = new Map<string, { key: string; mark: string }>()
const starting = new Map<string, Promise<void>>()
let seq = 0

function compose(l: Live): string {
  let s = l.base
  for (const [mark, text] of l.texts) s = s.replace(mark, text)
  return s
}

/** Las actualizaciones se agrupan (cada 60 ms) para no saturar la ventana con muchas IAs a la vez. */
function scheduleSend(l: Live): void {
  if (l.timer) return
  l.timer = setTimeout(() => {
    l.timer = null
    bridge.send('doc-change', { path: l.path, content: compose(l), kind: 'ai', author: l.author, summary: 'escribiendo…', focus: true, streaming: true } satisfies DocChange)
  }, 60)
}

/**
 * Empieza a escribir en directo. `place` coloca la marca donde irá el texto (al final, en una sección,
 * en un hueco…). Se puede llamar varias veces seguidas para escribir en paralelo.
 */
export async function streamStart(path: string, place: (src: string, mark: string) => string, author: string, summary: string): Promise<string> {
  path = normPath(path)
  if (!isOpen(path)) openDoc(path, true)
  const k = key(path)
  // Muchas escrituras pueden empezar a la vez: el estado del documento se crea una sola vez.
  let ready = starting.get(k)
  if (!lives.has(k) && !ready) {
    ready = current(path).then((base) => {
      lives.set(k, { path, base, texts: new Map(), active: new Set(), author, summary, timer: null })
      starting.delete(k)
    })
    starting.set(k, ready)
  }
  if (ready) await ready
  const l = lives.get(k)!
  const mark = `\u0000BUHO_STREAM_${++seq}\u0000`
  const base = place(l.base, mark)
  if (!base.includes(mark)) throw new Error('No se ha podido colocar el texto en el documento')
  l.base = base
  l.texts.set(mark, '')
  l.active.add(mark)
  if (l.active.size > 1) l.summary = `${l.active.size} textos escritos en paralelo`
  const id = Math.random().toString(36).slice(2, 10)
  streams.set(id, { key: k, mark })
  return id
}

export function streamChunk(id: string, text: string): void {
  const st = streams.get(id)
  const l = st && lives.get(st.key)
  if (!st || !l) throw new Error('Esa escritura en directo ya ha terminado o no existe')
  l.texts.set(st.mark, (l.texts.get(st.mark) ?? '') + text)
  scheduleSend(l)
}

export async function streamEnd(id: string): Promise<{ changed: boolean; path: string; chars: number; pending: number }> {
  const st = streams.get(id)
  const l = st && lives.get(st.key)
  if (!st || !l) throw new Error('Esa escritura en directo ya ha terminado o no existe')
  streams.delete(id)
  // Sin las vallas de código con que algunos modelos envuelven la respuesta.
  const text = (l.texts.get(st.mark) ?? '')
    .replace(/^\s*```(?:markdown|md)?[ \t]*\r?\n/, '')
    .replace(/\r?\n```\s*$/, '')
    .replace(/\s+$/, '')
  l.base = l.base.replace(st.mark, text)
  l.texts.delete(st.mark)
  l.active.delete(st.mark)
  if (l.active.size) {
    scheduleSend(l)
    return { changed: true, path: l.path, chars: text.length, pending: l.active.size }
  }
  if (l.timer) clearTimeout(l.timer)
  lives.delete(st.key)
  const final = l.base
  const r = await applyChange(l.path, () => final, { kind: 'ai', author: l.author, summary: l.summary })
  return { changed: r.changed, path: r.path, chars: text.length, pending: 0 }
}
