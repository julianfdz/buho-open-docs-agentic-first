import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { trozos, type Comentario, type Propuesta } from '@shared/propuestas'

/**
 * Revisión de un documento: propuestas de cambio pendientes, comentarios y el «modo revisión»
 * (con él activado, todo cambio de un agente llega como propuesta en vez de escribirse).
 * Se guarda en <datos>\revision\<hash de la ruta>.json; nunca junto al documento.
 */
interface Estado {
  path: string
  modo: boolean
  propuestas: Propuesta[]
  comentarios: Comentario[]
}

const dir = (): string => join(app.getPath('userData'), 'revision')
const fileFor = (path: string): string => join(dir(), createHash('sha1').update(path.toLowerCase()).digest('hex') + '.json')

function leer(path: string): Estado {
  try {
    return { path, modo: false, propuestas: [], comentarios: [], ...(JSON.parse(readFileSync(fileFor(path), 'utf8')) as Partial<Estado>) }
  } catch {
    return { path, modo: false, propuestas: [], comentarios: [] }
  }
}

let avisar: (path: string) => void = () => {}
/** Para avisar a la ventana de que cambió la revisión de un documento. */
export const onCambio = (fn: (path: string) => void): void => {
  avisar = fn
}

function escribir(e: Estado): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(fileFor(e.path), JSON.stringify(e))
  avisar(e.path)
}

const nuevoId = (prefijo: string): string => prefijo + randomUUID().replace(/-/g, '').slice(0, 7)

export const estado = (path: string): Estado => leer(path)
export const modoRevision = (path: string): boolean => leer(path).modo

export function setModo(path: string, on: boolean): void {
  const e = leer(path)
  e.modo = on
  escribir(e)
}

// ─── Propuestas ───────────────────────────────────────────────────────────────────────────────

export function proponer(path: string, antes: string, despues: string, autor: string, resumen: string, comentario?: string, torneo?: { grupo: string; variante: number }): Propuesta | null {
  const ts = trozos(antes, despues)
  if (!ts.length) return null
  const e = leer(path)
  const p: Propuesta = { id: nuevoId('p'), at: Date.now(), autor, resumen, trozos: ts, ...(comentario ? { comentario } : {}), ...(torneo ?? {}) }
  e.propuestas.push(p)
  escribir(e)
  return p
}

export const propuestas = (path: string): Propuesta[] => leer(path).propuestas

/** Quita propuestas (al aceptarlas o rechazarlas). `ids` vacío = todas. */
export function quitarPropuestas(path: string, ids: string[]): Propuesta[] {
  const e = leer(path)
  const quitar = e.propuestas.filter((p) => !ids.length || ids.includes(p.id))
  e.propuestas = e.propuestas.filter((p) => !quitar.includes(p))
  escribir(e)
  return quitar
}

// ─── Comentarios ──────────────────────────────────────────────────────────────────────────────

export function comentar(path: string, c: { autor: string; texto: string; cita: string; linea: number; seleccion?: string }): Comentario {
  const e = leer(path)
  const nuevo: Comentario = { id: nuevoId('c'), at: Date.now(), estado: 'abierto', respuestas: [], ...c }
  e.comentarios.push(nuevo)
  escribir(e)
  return nuevo
}

export const comentarios = (path: string): Comentario[] => leer(path).comentarios

function buscarComentario(e: Estado, id: string): Comentario {
  const c = e.comentarios.find((x) => x.id === id.replace(/^#/, ''))
  if (!c) throw new Error(`No existe el comentario ${id} (mira buho-docs comentarios)`)
  return c
}

export function responder(path: string, id: string, autor: string, texto: string, resolver = false): Comentario {
  const e = leer(path)
  const c = buscarComentario(e, id)
  if (texto) c.respuestas.push({ autor, texto, at: Date.now() })
  if (resolver) c.estado = 'resuelto'
  escribir(e)
  return c
}

export function reabrir(path: string, id: string): void {
  const e = leer(path)
  buscarComentario(e, id).estado = 'abierto'
  escribir(e)
}

export function borrarComentario(path: string, id: string): void {
  const e = leer(path)
  const c = buscarComentario(e, id)
  e.comentarios = e.comentarios.filter((x) => x !== c)
  escribir(e)
}
