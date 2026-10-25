import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { TEMAS_BASE, validarTema, type Tema } from '@shared/temas'

/**
 * Temas del usuario: <datos>/temas/<id>/tema.json, con su logo (logo.png/svg/jpg) y un estilo.css
 * opcional. Se pueden copiar a otro PC tal cual (son carpetas).
 */
export const temasDir = (): string => join(app.getPath('userData'), 'temas')
const fileUrl = (p: string): string => `buho://file/${encodeURIComponent(p.replace(/\\/g, '/'))}`

function cargar(id: string): Tema | null {
  const dir = join(temasDir(), id)
  const f = join(dir, 'tema.json')
  if (!existsSync(f)) return null
  try {
    const t = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) as Tema
    const logo = t.logo && !/^(https?:|data:|buho:)/.test(t.logo) ? join(dir, t.logo) : null
    const css = existsSync(join(dir, 'estilo.css')) ? readFileSync(join(dir, 'estilo.css'), 'utf8') : t.css
    return { ...t, id, base: t.base === 'buho' ? 'buho' : 'blanco', logo: logo && existsSync(logo) ? fileUrl(logo) : t.logo, css, propio: true }
  } catch {
    return null
  }
}

export function listarTemas(): Tema[] {
  const propios = existsSync(temasDir())
    ? readdirSync(temasDir())
        .map(cargar)
        .filter((t): t is Tema => !!t)
    : []
  return [...TEMAS_BASE.filter((b) => !propios.some((p) => p.id === b.id)), ...propios]
}

export function resolverTema(id: string): Tema {
  return cargar(id) ?? TEMAS_BASE.find((t) => t.id === id) ?? TEMAS_BASE[0]
}

export interface NuevoTema {
  id: string
  nombre?: string
  principal: string
  acento: string
  suave?: string
  texto?: string
  titulos?: string
  fuenteTexto?: string
  logo?: string
  marca?: string
  pie?: string
  portada?: 'arbol' | 'simple' | 'ninguna'
  base?: 'buho' | 'blanco'
}

export function crearTema(n: NuevoTema): Tema {
  const tema: Tema = {
    id: n.id,
    nombre: n.nombre || n.id,
    base: n.base ?? 'blanco',
    colores: { principal: n.principal, acento: n.acento, ...(n.suave ? { suave: n.suave } : {}), ...(n.texto ? { texto: n.texto } : {}) },
    ...(n.titulos || n.fuenteTexto ? { fuentes: { titulos: n.titulos, texto: n.fuenteTexto } } : {}),
    ...(n.marca !== undefined ? { marca: n.marca } : {}),
    ...(n.pie ? { pie: n.pie } : {}),
    portada: n.portada ?? 'simple'
  }
  const errores = validarTema(tema)
  if (errores.length) throw new Error('Tema no válido: ' + errores.join('; '))
  const dir = join(temasDir(), n.id)
  mkdirSync(dir, { recursive: true })
  if (n.logo) {
    if (!existsSync(n.logo)) throw new Error(`No existe el logo ${n.logo}`)
    const name = 'logo' + extname(n.logo).toLowerCase()
    copyFileSync(n.logo, join(dir, name))
    tema.logo = name
  }
  writeFileSync(join(dir, 'tema.json'), JSON.stringify(tema, null, 2))
  return resolverTema(n.id)
}
