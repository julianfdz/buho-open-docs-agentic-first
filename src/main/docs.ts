import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { kindOf, splitFront, titleOf } from '@shared/doc'
import type { ChangeKind, DocChange, OpenDoc, RecentDoc } from '@shared/types'
import { addHistory, ensureBaseline } from './history'
import { markOwnWrite, unwatchFile, watchFile } from './watcher'

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
  return { changed: true, content: after, path }
}

/** El archivo cambió en disco sin pasar por la app (otro programa o una IA editándolo directamente). */
function onDiskChange(path: string, text: string): void {
  if (known.get(key(path)) === text) return
  known.set(key(path), text)
  const entry = addHistory(path, { kind: 'external', author: 'Otro programa', summary: 'Cambiado en disco' }, text)
  const kind = entry?.kind ?? 'external'
  bridge.send('doc-change', { path, content: text, kind, author: entry?.author ?? 'Otro programa', summary: entry?.summary ?? 'Cambiado en disco', focus: kind === 'ai' } satisfies DocChange)
}
