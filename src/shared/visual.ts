import { setMeta } from './doc'

/**
 * Edición visual (como en Word): la vista previa manda «este bloque ahora dice esto» y aquí se traduce
 * a cambios en las líneas del Markdown, conservando lo que la persona no ve (marcas de lista, nivel de
 * título, atributos {icon=…}, el resto de celdas de una tabla…).
 * Las líneas van en base 1 e incluyen `end` (última línea del bloque).
 */

export type BlockTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'li' | 'td' | 'th' | 'blockquote'

export interface BlockRef {
  line: number
  end: number
  tag: BlockTag
  /** Columna de la celda (tablas). */
  cell?: number
  /** Campo de la cabecera (portada). */
  meta?: string
}

const LI = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/
const ATTRS = /\s*\{[^{}\n]*\}\s*$/

function linesOf(src: string): { ls: string[]; nl: string } {
  return { ls: src.split(/\r?\n/), nl: src.includes('\r\n') ? '\r\n' : '\n' }
}

/** Prefijo que hay que conservar en la primera línea del bloque. */
function prefixOf(first: string, tag: BlockTag): string {
  if (/^h[1-6]$/.test(tag)) return first.match(/^(\s*#{1,6}\s+)/)?.[1] ?? '#'.repeat(Number(tag[1])) + ' '
  if (tag === 'li') return first.match(LI)?.[1] ?? '- '
  // [ \t] y no \s: el espacio no separable de un párrafo vacío no es sangría.
  const q = first.match(/^([ \t]*(?:>[ \t]?)+)/)
  return q ? q[1] : first.match(/^([ \t]*)/)?.[1] ?? ''
}

function splitRow(row: string): { lead: string; cells: string[]; trail: string } {
  const lead = row.match(/^\s*\|?/)?.[0] ?? ''
  const trail = row.match(/\|?\s*$/)?.[0] ?? ''
  const inner = row.slice(lead.length, row.length - trail.length)
  return { lead, cells: inner.split(/(?<!\\)\|/), trail }
}

/** Sustituye el texto de un bloque. */
export function replaceBlock(src: string, b: BlockRef, text: string): string {
  if (b.meta) return setMeta(src, b.meta, text)
  const { ls, nl } = linesOf(src)
  const i = b.line - 1
  if (i < 0 || i >= ls.length) return src
  const one = text.replace(/\s*\n\s*/g, ' ').trim()
  if (b.tag === 'td' || b.tag === 'th') {
    const r = splitRow(ls[i])
    if (b.cell === undefined || b.cell >= r.cells.length) return src
    r.cells[b.cell] = ` ${one.replace(/\|/g, '\\|')} `
    ls[i] = r.lead + r.cells.join('|') + r.trail
    return ls.join(nl)
  }
  const end = Math.max(i, Math.min(ls.length - 1, b.end - 1))
  const attrs = ls[end].match(ATTRS)?.[0] ?? ''
  const pre = prefixOf(ls[i], b.tag)
  ls.splice(i, end - i + 1, pre + one + (attrs && !one.endsWith('}') ? attrs : ''))
  return ls.join(nl)
}

/** Intro en mitad de un bloque: lo parte en dos (párrafo → dos párrafos, elemento de lista → dos). */
export function splitBlock(src: string, b: BlockRef, before: string, after: string): { src: string; focusLine: number } {
  const { ls, nl } = linesOf(src)
  const i = b.line - 1
  const end = Math.max(i, Math.min(ls.length - 1, b.end - 1))
  const pre = prefixOf(ls[i], b.tag)
  // Un párrafo vacío no existe en Markdown: se deja un espacio no separable para poder escribir en él.
  const one = (t: string): string => t.replace(/\s*\n\s*/g, ' ').trim() || '\u00a0'
  let add: string[]
  let focus: number
  if (b.tag === 'li') {
    const nextPre = pre.replace(/\[[xX]\]/, '[ ]').replace(/^(\s*)(\d+)([.)])/, (_m, s, n, d) => `${s}${Number(n) + 1}${d}`)
    add = [pre + one(before), nextPre + one(after)]
    focus = b.line + 1
  } else if (/^h[1-6]$/.test(b.tag)) {
    add = [pre + one(before), '', one(after)]
    focus = b.line + 2
  } else {
    const q = pre.includes('>') ? pre : ''
    add = [pre + one(before), q.trimEnd(), q + one(after)]
    focus = b.line + 2
  }
  ls.splice(i, end - i + 1, ...add)
  return { src: ls.join(nl), focusLine: focus }
}

/** Retroceso al principio de un bloque: lo une al anterior (párrafos y elementos de lista). */
export function mergeWithPrevious(src: string, b: BlockRef, prev: BlockRef, text: string, prevText: string): { src: string; focusLine: number; offset: number } {
  const { ls, nl } = linesOf(src)
  const i = b.line - 1
  const end = Math.max(i, Math.min(ls.length - 1, b.end - 1))
  const pi = prev.line - 1
  const pend = Math.max(pi, Math.min(ls.length - 1, prev.end - 1))
  const pre = prefixOf(ls[pi], prev.tag)
  const joined = `${prevText.trim()}${prevText.trim() && text.trim() ? ' ' : ''}${text.trim()}`
  // Se quita el bloque actual (y las líneas en blanco entre los dos) y se rehace el anterior.
  ls.splice(pi, end - pi + 1, pre + joined)
  void pend
  return { src: ls.join(nl), focusLine: prev.line, offset: prevText.trim().length + (prevText.trim() && text.trim() ? 1 : 0) }
}

export type BlockStyle = 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote'

/** Cambia el tipo de bloque (párrafo, título, lista, cita) manteniendo el texto. */
export function setBlockStyle(src: string, b: BlockRef, style: BlockStyle, text: string): string {
  if (b.meta || b.tag === 'td' || b.tag === 'th') return src
  const { ls, nl } = linesOf(src)
  const i = b.line - 1
  const end = Math.max(i, Math.min(ls.length - 1, b.end - 1))
  const attrs = /^h/.test(style) && /^h[1-6]$/.test(b.tag) ? ls[i].match(ATTRS)?.[0] ?? '' : ''
  const one = text.replace(/\s*\n\s*/g, ' ').trim()
  const pre: Record<BlockStyle, string> = { p: '', h1: '# ', h2: '## ', h3: '### ', ul: '- ', ol: '1. ', quote: '> ' }
  const lines = [pre[style] + one + attrs]
  // Un título o un párrafo que sale de una lista necesita líneas en blanco alrededor.
  if (b.tag === 'li' && style !== 'ul' && style !== 'ol') {
    lines.unshift('')
    lines.push('')
  }
  ls.splice(i, end - i + 1, ...lines)
  return ls.join(nl).replace(/(\r?\n){3,}/g, nl + nl)
}

/** Inserta un bloque de Markdown después de la línea `after` (base 1; 0 = al principio del cuerpo). */
export function insertAfter(src: string, after: number, block: string): { src: string; line: number } {
  const { ls, nl } = linesOf(src)
  const at = Math.max(0, Math.min(ls.length, after))
  const add = ['', ...block.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n'), '']
  ls.splice(at, 0, ...add)
  return { src: ls.join(nl).replace(/(\r?\n){3,}/g, nl + nl), line: at + 2 }
}

/** HTML de un bloque editado → Markdown en línea (negrita, cursiva, código, enlaces). */
export function inlineMd(el: Node): string {
  let out = ''
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      out += (n.textContent ?? '').replace(/ /g, ' ')
      return
    }
    if (n.nodeType !== 1) return
    const e = n as HTMLElement
    if (e.classList.contains('ic') || e.tagName === 'UL' || e.tagName === 'OL') return
    const inner = inlineMd(e)
    const wrap = (m: string): string => {
      const t = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)!
      return t[2] ? `${t[1]}${m}${t[2]}${m}${t[3]}` : inner
    }
    switch (e.tagName) {
      case 'STRONG':
      case 'B':
        out += wrap('**')
        break
      case 'EM':
      case 'I':
        out += wrap('*')
        break
      case 'CODE':
        out += wrap('`')
        break
      case 'S':
      case 'DEL':
      case 'STRIKE':
        out += wrap('~~')
        break
      case 'A':
        out += `[${inner}](${e.getAttribute('href') ?? ''})`
        break
      case 'BR':
        out += ' '
        break
      case 'IMG':
        out += `![${e.getAttribute('alt') ?? ''}](${e.getAttribute('data-src') ?? e.getAttribute('src') ?? ''})`
        break
      default:
        out += inner
    }
  })
  return out.replace(/\*\*\*\*/g, '').replace(/ {2,}/g, ' ')
}

/** Texto de un bloque tal como está en el Markdown, sin marcas de título, lista o cita. */
export function blockText(src: string, b: BlockRef): string {
  const ls = src.split(/\r?\n/)
  const i = b.line - 1
  const end = Math.max(i, Math.min(ls.length - 1, b.end - 1))
  return ls
    .slice(i, end + 1)
    .map((l, k) => (k === 0 ? l.replace(/^\s*#{1,6}\s+/, '').replace(LI, '') : l).replace(/^\s*(?:>\s?)+/, '').trim())
    .join(' ')
    .replace(ATTRS, '')
    .trim()
}
