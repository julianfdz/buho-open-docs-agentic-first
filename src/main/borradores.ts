import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

/**
 * Documentos sin guardar (borradores): «Nuevo» o abrir un Word o un PDF no obliga a elegir dónde
 * guardarlo. Cada borrador es un archivo real en <datos>\sin-guardar\<id>\<nombre>.md, así que la
 * vista, el historial y los agentes funcionan igual; sus imágenes viven en la misma carpeta.
 * «Guardar» lo copia (con sus imágenes) donde se elija. Si la app se cierra, se recuperan al abrirla.
 */
export const borradoresDir = (): string => join(app.getPath('userData'), 'sin-guardar')

export function esBorrador(path: string): boolean {
  const rel = relative(borradoresDir(), resolve(path))
  return !!rel && !rel.startsWith('..') && !/^[a-z]:/i.test(rel)
}

/** Carpeta nueva para un borrador; devuelve la ruta del .md (aún sin escribir). */
export function rutaNueva(nombre: string): string {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const dir = join(borradoresDir(), id)
  mkdirSync(dir, { recursive: true })
  const limpio = nombre.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Sin título'
  return join(dir, limpio.endsWith('.md') ? limpio : limpio + '.md')
}

let contador = 0
/** «Sin título 1», «Sin título 2»… (sin repetir entre los borradores abiertos). */
export function nombreSinTitulo(): string {
  const usados = new Set(listar().map((p) => basename(p, '.md')))
  let n = ++contador
  while (usados.has(`Sin título ${n}`)) n++
  contador = n
  return `Sin título ${n}`
}

export function crear(nombre: string, contenido: string): string {
  const path = rutaNueva(nombre)
  writeFileSync(path, contenido)
  return path
}

/** Borradores que quedaron de la última vez (se reabren al arrancar). */
export function listar(): string[] {
  const d = borradoresDir()
  if (!existsSync(d)) return []
  const out: string[] = []
  for (const id of readdirSync(d)) {
    const dir = join(d, id)
    try {
      if (!statSync(dir).isDirectory()) continue
      const md = readdirSync(dir).find((f) => f.endsWith('.md'))
      if (md) out.push(join(dir, md))
      else rmSync(dir, { recursive: true, force: true })
    } catch {
      /* carpeta rara: se ignora */
    }
  }
  return out
}

/** Copia el borrador (y lo que haya a su lado, como sus imágenes) a `destino` y lo borra de la caché. */
export function guardarEn(path: string, destino: string): string {
  const dir = dirname(path)
  const destDir = dirname(destino)
  mkdirSync(destDir, { recursive: true })
  cpSync(path, destino)
  for (const f of readdirSync(dir)) {
    if (f === basename(path)) continue
    const extra = join(destDir, f)
    if (!existsSync(extra)) cpSync(join(dir, f), extra, { recursive: true })
  }
  descartar(path)
  return destino
}

export function descartar(path: string): void {
  if (!esBorrador(path)) return
  rmSync(dirname(path), { recursive: true, force: true })
}
