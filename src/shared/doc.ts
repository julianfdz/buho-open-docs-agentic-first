import { parse, parseDocument } from 'yaml'
import type { DocKind } from './types'

/**
 * Modelo del documento: un Markdown con cabecera YAML (frontmatter).
 *
 *   ---
 *   tipo: documento | presentacion
 *   titulo: …
 *   ---
 *   # Contenido…
 *
 * En las presentaciones cada diapositiva se separa con una línea `---` (con una línea en blanco antes)
 * y puede empezar con directivas `@diseño: portada`, `@etiqueta: TEXTO`.
 * Todo son operaciones de texto puras: las usan la app, la API y la vista previa.
 */

export interface Front {
  meta: Record<string, unknown>
  /** Índice (0) de la primera línea del cuerpo, después del frontmatter. */
  bodyStart: number
  body: string
  /** Error de YAML, si lo hay (el documento se sigue pintando). */
  error?: string
}

const lines = (s: string): string[] => s.split(/\r?\n/)
const eol = (s: string): string => (s.includes('\r\n') ? '\r\n' : '\n')

export function splitFront(src: string): Front {
  const ls = lines(src)
  if (ls[0]?.trim() !== '---') return { meta: {}, bodyStart: 0, body: src }
  const end = ls.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
  if (end < 0) return { meta: {}, bodyStart: 0, body: src, error: 'Falta la línea --- que cierra la cabecera' }
  let meta: Record<string, unknown> = {}
  let error: string | undefined
  try {
    const m = parse(ls.slice(1, end).join('\n'))
    if (m && typeof m === 'object' && !Array.isArray(m)) meta = m as Record<string, unknown>
  } catch (e) {
    error = `Cabecera YAML no válida: ${(e as Error).message.split('\n')[0]}`
  }
  return { meta, bodyStart: end + 1, body: ls.slice(end + 1).join('\n'), error }
}

/** Lee un campo de la cabecera aceptando su nombre en español o en inglés. */
export function metaGet(meta: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = meta[k]
    if (v === undefined || v === null || v === '') continue
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return String(v)
  }
  return undefined
}

export function kindOf(meta: Record<string, unknown>): DocKind {
  const t = (metaGet(meta, 'tipo', 'kind', 'type') ?? '').toLowerCase()
  return /^(presentaci[oó]n|slides?|diapositivas|deck)$/.test(t) ? 'presentacion' : 'documento'
}

export function titleOf(src: string, fallback = 'Sin título'): string {
  const f = splitFront(src)
  const t = metaGet(f.meta, 'titulo', 'título', 'title')
  if (t) return t
  const h = lines(f.body).find((l) => /^#\s+/.test(l))
  return h ? h.replace(/^#\s+/, '').replace(/\s*\{[^}]*\}\s*$/, '').trim() : fallback
}

// ─── Presentaciones: diapositivas ───────────────────────────────────────────────────────────────

export interface Slide {
  /** 1 = primera. */
  n: number
  /** Líneas [start, end) del documento entero (0 = primera línea del archivo). */
  start: number
  end: number
  /** Primera línea de la diapositiva sin contar el separador `---`. */
  from: number
  directives: Record<string, string>
  /** Línea (0) donde empieza el Markdown de la diapositiva, después de las directivas. */
  contentStart: number
  content: string
  title: string
}

const isFence = (l: string): boolean => /^\s*(```|~~~)/.test(l)

/** Directivas de diapositiva: `@diseño: portada`, `@layout: portada`, `@etiqueta: …`. */
const DIRECTIVE = /^@([\wñáéíóú-]+)\s*:\s*(.*)$/i
const DIRECTIVE_ALIAS: Record<string, string> = { layout: 'diseño', diseno: 'diseño', kicker: 'etiqueta', label: 'etiqueta', notes: 'notas', background: 'fondo' }

export function splitSlides(src: string): Slide[] {
  const f = splitFront(src)
  const ls = lines(src)
  const cuts: number[] = [f.bodyStart]
  let fence = false
  for (let i = f.bodyStart; i < ls.length; i++) {
    if (isFence(ls[i])) fence = !fence
    if (fence) continue
    if (/^---\s*$/.test(ls[i]) && (i === f.bodyStart || ls[i - 1].trim() === '' || cuts.includes(i - 1) || /^@/.test(ls[i - 1]))) cuts.push(i)
  }
  const out: Slide[] = []
  for (let k = 0; k < cuts.length; k++) {
    const start = k === 0 ? cuts[0] : cuts[k] + 1
    const end = k + 1 < cuts.length ? cuts[k + 1] : ls.length
    const directives: Record<string, string> = {}
    let c = start
    while (c < end && (ls[c].trim() === '' || DIRECTIVE.test(ls[c].trim()))) {
      const m = ls[c].trim().match(DIRECTIVE)
      if (m) {
        const key = m[1].toLowerCase()
        directives[DIRECTIVE_ALIAS[key] ?? key] = m[2].trim()
      }
      c++
    }
    const content = ls.slice(c, end).join('\n')
    // Una «diapositiva» vacía al principio (cuerpo que empieza por ---) no cuenta.
    if (k === 0 && !content.trim() && !Object.keys(directives).length && cuts.length > 1) continue
    const h = ls.slice(c, end).find((l) => /^#{1,3}\s+/.test(l))
    out.push({
      n: out.length + 1,
      start: k === 0 ? start : cuts[k],
      end,
      from: start,
      directives,
      contentStart: c,
      content,
      title: h ? h.replace(/^#+\s+/, '').replace(/\s*\{[^}]*\}\s*$/, '').trim() : directives['diseño'] ?? ''
    })
  }
  return out
}

// ─── Esquema ────────────────────────────────────────────────────────────────────────────────────

export interface OutlineItem {
  level: number
  text: string
  /** Línea (1 = primera) en el archivo. */
  line: number
  slide?: number
}

export function outline(src: string): OutlineItem[] {
  const f = splitFront(src)
  const ls = lines(src)
  const slides = kindOf(f.meta) === 'presentacion' ? splitSlides(src) : null
  const slideAt = (i: number): number | undefined => slides?.find((s) => i >= s.start && i < s.end)?.n
  const out: OutlineItem[] = []
  let fence = false
  for (let i = f.bodyStart; i < ls.length; i++) {
    if (isFence(ls[i])) fence = !fence
    const m = !fence && ls[i].match(/^(#{1,6})\s+(.*)$/)
    if (m) out.push({ level: m[1].length, text: m[2].replace(/\s*\{[^}]*\}\s*$/, '').trim(), line: i + 1, slide: slideAt(i) })
  }
  return out
}

// ─── Ediciones (las usa la API: así una IA cambia una parte sin reescribirlo todo) ──────────────

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Busca una sección por su título (sin importar mayúsculas ni tildes) o por «#3» (tercer título). */
export function findSection(src: string, heading: string): { start: number; end: number; level: number; text: string } {
  const ls = lines(src)
  const heads = outline(src)
  let h: OutlineItem | undefined
  const byIndex = heading.match(/^#(\d+)$/)
  if (byIndex) h = heads[Number(byIndex[1]) - 1]
  else {
    const want = norm(heading.replace(/^#+\s*/, ''))
    const exact = heads.filter((x) => norm(x.text) === want)
    const partial = heads.filter((x) => norm(x.text).includes(want))
    const pool = exact.length ? exact : partial
    if (pool.length > 1) throw new Error(`Hay ${pool.length} secciones que encajan con «${heading}»: ${pool.map((x) => `«${x.text}» (línea ${x.line})`).join(', ')}. Usa el título exacto o #N (buho-docs outline).`)
    h = pool[0]
  }
  if (!h) throw new Error(`No encuentro la sección «${heading}». Mira los títulos con: buho-docs outline <archivo>`)
  const start = h.line - 1
  // La sección acaba en el siguiente título de su nivel o superior (o en el corte de diapositiva).
  let end = ls.length
  const next = heads.find((x) => x.line > h!.line && x.level <= h!.level)
  if (next) end = next.line - 1
  const slide = kindOf(splitFront(src).meta) === 'presentacion' ? splitSlides(src).find((s) => start >= s.start && start < s.end) : undefined
  if (slide && slide.end < end) end = slide.end
  // Sin las líneas en blanco del final, para que lo nuevo quede bien separado.
  while (end > start + 1 && ls[end - 1].trim() === '') end--
  return { start, end, level: h.level, text: h.text }
}

export type SectionMode = 'replace' | 'body' | 'append' | 'before' | 'after' | 'delete'

/**
 * Cambia una sección:
 *   replace → sustituye la sección entera (título incluido) por `content`
 *   body    → mantiene el título y sustituye lo de debajo
 *   append  → añade `content` al final de la sección
 *   before / after → inserta `content` antes o después de la sección
 *   delete  → la quita
 */
export function editSection(src: string, heading: string, content: string, mode: SectionMode = 'body'): string {
  const ls = lines(src)
  const nl = eol(src)
  const s = findSection(src, heading)
  const add = content.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n')
  let out: string[]
  switch (mode) {
    case 'replace':
      out = [...ls.slice(0, s.start), ...add, ...ls.slice(s.end)]
      break
    case 'body':
      out = [...ls.slice(0, s.start + 1), '', ...add, ...ls.slice(s.end)]
      break
    case 'append':
      out = [...ls.slice(0, s.end), '', ...add, ...ls.slice(s.end)]
      break
    case 'before':
      out = [...ls.slice(0, s.start), ...add, '', ...ls.slice(s.start)]
      break
    case 'after':
      out = [...ls.slice(0, s.end), '', ...add, ...ls.slice(s.end)]
      break
    case 'delete': {
      let e = s.end
      while (e < ls.length && ls[e].trim() === '') e++
      out = [...ls.slice(0, s.start), ...ls.slice(e)]
      break
    }
    default:
      throw new Error(`Modo desconocido: ${mode}`)
  }
  return tidy(out.join(nl), nl)
}

/** Como mucho una línea en blanco seguida y un salto de línea al final. */
function tidy(s: string, nl: string): string {
  return s.replace(/(\r?\n){3,}/g, nl + nl).replace(/\s*$/, nl)
}

export type SlideMode = 'replace' | 'insert' | 'delete' | 'move'

/**
 * Cambia diapositivas (presentaciones):
 *   replace n  → sustituye la diapositiva n (directivas incluidas) por `content`
 *   insert n   → inserta `content` como nueva diapositiva n (0 o más que el total = al final)
 *   delete n   → la quita
 *   move n to  → la mueve a la posición `to`
 */
export function editSlide(src: string, n: number, mode: SlideMode, content = '', to?: number): string {
  const nl = eol(src)
  const ls = lines(src)
  const slides = splitSlides(src)
  const f = splitFront(src)
  const body = (s: Slide): string[] => ls.slice(s.from, s.end)
  let blocks = slides.map((s) => trimBlock(body(s)))
  const add = trimBlock(content.replace(/\r\n/g, '\n').split('\n').filter((l, i, a) => !(i === 0 && /^---\s*$/.test(l) && a.length > 1)))
  const idx = n - 1
  if (mode !== 'insert' && (idx < 0 || idx >= blocks.length)) throw new Error(`No existe la diapositiva ${n} (hay ${blocks.length})`)
  if (mode === 'replace') blocks[idx] = add
  else if (mode === 'insert') blocks.splice(n <= 0 || n > blocks.length ? blocks.length : idx, 0, add)
  else if (mode === 'delete') blocks.splice(idx, 1)
  else if (mode === 'move') {
    if (!to || to < 1 || to > blocks.length) throw new Error(`Posición de destino no válida: ${to}`)
    const [b] = blocks.splice(idx, 1)
    blocks.splice(to - 1, 0, b)
  }
  blocks = blocks.filter((b) => b.length)
  const head = ls.slice(0, f.bodyStart)
  const out = [...head, ...(head.length ? [''] : []), ...blocks.flatMap((b, i) => (i ? ['', '---', '', ...b] : b))]
  return tidy(out.join(nl), nl)
}

function trimBlock(b: string[]): string[] {
  let s = 0
  let e = b.length
  while (s < e && b[s].trim() === '') s++
  while (e > s && b[e - 1].trim() === '') e--
  return b.slice(s, e)
}

/** Sustituye un texto exacto (para erratas). Si aparece varias veces exige `all` o un texto más largo. */
export function replaceText(src: string, find: string, repl: string, all = false): { content: string; count: number } {
  if (!find) throw new Error('Falta el texto a buscar')
  const count = src.split(find).length - 1
  if (!count) {
    const loose = src.toLowerCase().includes(find.toLowerCase())
    throw new Error(`No encuentro «${find}»${loose ? ' (sí aparece con otras mayúsculas: cópialo exacto)' : ''}`)
  }
  if (count > 1 && !all) throw new Error(`«${find}» aparece ${count} veces: añade más texto alrededor para que sea único o usa --all`)
  return { content: all ? src.split(find).join(repl) : src.replace(find, () => repl), count: all ? count : 1 }
}

/** Cambia (o borra, con value = null) un campo de la cabecera sin tocar el resto ni los comentarios. */
export function setMeta(src: string, key: string, value: unknown): string {
  const nl = eol(src)
  const ls = lines(src)
  const f = splitFront(src)
  const hasFront = ls[0]?.trim() === '---' && f.bodyStart > 0
  const doc = parseDocument(hasFront ? ls.slice(1, f.bodyStart - 1).join('\n') : '')
  if (value === null || value === undefined || value === '') doc.delete(key)
  else doc.set(key, value)
  const yaml = doc.toString({ lineWidth: 0 }).replace(/\s+$/, '')
  const rest = hasFront ? ls.slice(f.bodyStart) : ['', ...ls]
  return ['---', ...(yaml && yaml !== '{}' ? yaml.split('\n') : []), '---', ...rest].join(nl)
}

/** Interpreta un valor de la línea de comandos: true/false, números y listas JSON; el resto, texto. */
export function parseValue(v: string): unknown {
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (/^[[{]/.test(v)) {
    try {
      return JSON.parse(v)
    } catch {
      /* texto */
    }
  }
  return v
}

/** Palabras del texto (sin cabecera ni sintaxis), para la barra de estado. */
export function wordCount(src: string): number {
  const b = splitFront(src).body.replace(/```[\s\S]*?```/g, ' ').replace(/^@.*$/gm, ' ').replace(/[#>*_`|:[\]()!-]+/g, ' ')
  return (b.match(/[\p{L}\p{N}]+/gu) ?? []).length
}

// ─── Lotes: varios cambios en una sola llamada (y una sola entrada del historial) ───────────────

export interface Op {
  op: 'write' | 'replace' | 'section' | 'slide' | 'append' | 'meta'
  content?: string
  find?: string
  replace?: string
  all?: boolean
  heading?: string
  mode?: string
  n?: number
  to?: number
  key?: string
  value?: unknown
}

/** Aplica los cambios en orden. Si uno falla no se aplica ninguno (el error dice cuál). */
export function applyOps(src: string, ops: Op[]): { content: string; labels: string[] } {
  let s = src
  const labels: string[] = []
  ops.forEach((o, i) => {
    try {
      switch (o.op) {
        case 'write':
          s = o.content ?? ''
          labels.push('documento reescrito')
          break
        case 'replace':
          s = replaceText(s, o.find ?? '', o.replace ?? '', !!o.all).content
          labels.push(`«${(o.find ?? '').slice(0, 30)}» → «${(o.replace ?? '').slice(0, 30)}»`)
          break
        case 'section':
          s = editSection(s, o.heading ?? '', o.content ?? '', (o.mode ?? 'body') as SectionMode)
          labels.push(`sección «${o.heading}»`)
          break
        case 'slide':
          s = editSlide(s, Number(o.n), (o.mode ?? 'replace') as SlideMode, o.content ?? '', o.to)
          labels.push(`diapositiva ${o.n}`)
          break
        case 'append':
          s = s.replace(/\s*$/, '') + '\n\n' + (o.content ?? '').replace(/\s*$/, '') + '\n'
          labels.push('texto añadido')
          break
        case 'meta':
          s = setMeta(s, o.key ?? '', typeof o.value === 'string' ? parseValue(o.value) : o.value)
          labels.push(`cabecera ${o.key}`)
          break
        default:
          throw new Error(`operación desconocida «${(o as { op: string }).op}» (write, replace, section, slide, append, meta)`)
      }
    } catch (e) {
      throw new Error(`Cambio ${i + 1} (${o.op}): ${(e as Error).message}. No se ha aplicado ninguno.`)
    }
  })
  return { content: s, labels }
}
