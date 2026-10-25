import { kindOf, metaGet, splitFront } from './doc'

/**
 * Índice para IAs: el documento partido en bloques (títulos, párrafos, elementos de lista, tablas,
 * cajas…) con un identificador estable, su texto limpio (sin sintaxis ni maquetación), la sección a la
 * que pertenece y cuántos tokens ocupa. Con esto un agente:
 *   - ve el mapa del documento y cuánto le cuesta leer cada parte (mapa),
 *   - lee solo lo que necesita y en limpio (leer),
 *   - encuentra dónde se habla de algo (buscar),
 *   - y cambia un bloque por su id sin buscarlo (editar #b…).
 *
 * El id sale del texto del bloque (y su tipo): no cambia aunque se edite otra parte del documento.
 * Todo es determinista: el mismo documento da siempre el mismo índice.
 */

export type BlockType = 'titulo' | 'parrafo' | 'item' | 'tabla' | 'bloque' | 'codigo' | 'salto' | 'imagen' | 'diapositiva'

export interface IndexBlock {
  id: string
  type: BlockType
  /** Nivel del título (1-6) o nombre del bloque (caja, tarjetas…). */
  level?: number
  kind?: string
  /** Líneas (1) del archivo, ambas incluidas. */
  line: number
  end: number
  /** Texto limpio, sin sintaxis. */
  text: string
  /** Títulos que lo contienen («2. Modelo › Filtros»). */
  path: string
  tokens: number
  /** Diapositiva (presentaciones). */
  slide?: number
}

export interface IndexSection {
  id: string
  title: string
  level: number
  line: number
  end: number
  path: string
  /** Tokens de la sección entera (con sus subsecciones). */
  tokens: number
  blocks: number
}

export interface DocIndex {
  hash: string
  title: string
  kind: string
  tokens: number
  blocks: IndexBlock[]
  sections: IndexSection[]
}

/** Tokens aproximados (español: ~3,6 caracteres por token). */
export const tokensOf = (s: string): number => Math.ceil(s.length / 3.6)

/** Texto sin sintaxis Markdown ni marcas de Búho Docs. */
export function cleanInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)(\{[^}]*\})?/g, (_m, alt) => (alt ? `[imagen: ${alt}]` : '[imagen]'))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*\{[^{}\n]*\}\s*$/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
const isTableRow = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l)
const isSep = (l: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)

/** Hash de 53 bits (cyrb53), sin dependencias: sirve igual en la app y en la vista. */
function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

function makeId(type: string, text: string, used: Map<string, number>): string {
  const base = 'b' + hash53(type + '\u0000' + text).toString(36).padStart(5, '0').slice(-5)
  const n = used.get(base) ?? 0
  used.set(base, n + 1)
  return n ? `${base}${n + 1}` : base
}

export function buildIndex(src: string): DocIndex {
  const f = splitFront(src)
  const ls = src.split(/\r?\n/)
  const deck = kindOf(f.meta) === 'presentacion'
  const used = new Map<string, number>()
  const blocks: IndexBlock[] = []
  const heads: { level: number; title: string; idx: number }[] = []
  let slide = 1
  const pathNow = (): string => heads.map((h) => h.title).join(' › ')
  const push = (type: BlockType, line: number, end: number, text: string, extra: Partial<IndexBlock> = {}): void => {
    const clean = text.trim()
    if (!clean && type !== 'salto') return
    blocks.push({ id: makeId(type + (extra.kind ?? ''), clean || `${type}-${line}`, used), type, line: line + 1, end: end + 1, text: clean, path: pathNow(), tokens: tokensOf(clean), ...(deck ? { slide } : {}), ...extra })
  }
  let i = f.bodyStart
  let fence = false
  while (i < ls.length) {
    const l = ls[i]
    const t = l.trim()
    if (/^\s*(```|~~~)/.test(l)) {
      const start = i
      fence = true
      i++
      while (i < ls.length && !/^\s*(```|~~~)/.test(ls[i])) i++
      fence = false
      push('codigo', start, Math.min(i, ls.length - 1), ls.slice(start + 1, i).join('\n'))
      i++
      continue
    }
    void fence
    if (!t) {
      i++
      continue
    }
    if (deck && /^---\s*$/.test(t)) {
      slide++
      i++
      continue
    }
    if (/^@[\wñáéíóú-]+\s*:/.test(t)) {
      i++
      continue
    }
    const h = t.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      while (heads.length && heads[heads.length - 1].level >= level) heads.pop()
      const title = cleanInline(h[2])
      heads.push({ level, title, idx: blocks.length })
      push('titulo', i, i, title, { level })
      i++
      continue
    }
    if (/^\\(pagebreak|newpage|salto)$/.test(t)) {
      push('salto', i, i, '')
      i++
      continue
    }
    // Contenedor ::: nombre … ::: (su texto, sin marcas; los títulos de dentro forman parte del bloque)
    const c = t.match(/^(:{3,})\s*([\p{L}\w-]+)(.*)$/u)
    if (c) {
      const start = i
      let depth = 1
      i++
      const inner: string[] = []
      while (i < ls.length) {
        const x = ls[i].trim()
        if (/^:{3,}$/.test(x)) {
          if (--depth === 0) break
        } else if (/^:{3,}\s*[\p{L}\w-]/u.test(x)) depth++
        if (!/^:{3,}/.test(x) && !/^\+{3,}$/.test(x)) inner.push(x.replace(/^#{1,6}\s+/, '').replace(/^([-*+]|\d+[.)])\s+/, '• '))
        i++
      }
      const name = c[2].toLowerCase()
      const label = name === 'hueco' ? `[pendiente: ${(c[3].match(/texto=(?:"([^"]*)"|(\S+))/) ?? [])[1] ?? (c[3].match(/id=(\S+)/) ?? [])[1] ?? ''}]` : inner.map((x) => cleanInline(x)).filter(Boolean).join('\n')
      if (name !== 'indice') push('bloque', start, Math.min(i, ls.length - 1), label, { kind: name })
      i++
      continue
    }
    if (isTableRow(l)) {
      const start = i
      const rows: string[] = []
      while (i < ls.length && isTableRow(ls[i])) {
        if (!isSep(ls[i])) rows.push(ls[i].trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((x) => cleanInline(x)).join(' | '))
        i++
      }
      push('tabla', start, i - 1, rows.join('\n'))
      continue
    }
    const li = l.match(LIST)
    if (li) {
      // Cada elemento de lista es un bloque (con sus líneas de continuación).
      const start = i
      let text = l.replace(LIST, '')
      i++
      while (i < ls.length && ls[i].trim() && !LIST.test(ls[i]) && !/^\s*(#{1,6}\s|:{3,}|\|)/.test(ls[i])) {
        text += ' ' + ls[i].trim()
        i++
      }
      push('item', start, i - 1, cleanInline(text))
      continue
    }
    // Párrafo: hasta la línea en blanco o el siguiente bloque.
    const start = i
    const parts: string[] = []
    while (i < ls.length && ls[i].trim() && !/^\s*(#{1,6}\s|:{3,}|```|~~~)/.test(ls[i]) && !isTableRow(ls[i]) && !LIST.test(ls[i]) && !(deck && /^---\s*$/.test(ls[i].trim()))) {
      parts.push(ls[i].trim())
      i++
    }
    const text = parts.join(' ')
    push(/^!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?$/.test(text) ? 'imagen' : 'parrafo', start, i - 1, cleanInline(text))
  }
  // Secciones: cada título hasta el siguiente de su nivel o superior.
  const sections: IndexSection[] = []
  blocks.forEach((b, k) => {
    if (b.type !== 'titulo') return
    let e = blocks.length
    for (let j = k + 1; j < blocks.length; j++) {
      if (blocks[j].type === 'titulo' && (blocks[j].level ?? 9) <= (b.level ?? 9)) {
        e = j
        break
      }
    }
    const inner = blocks.slice(k, e)
    sections.push({ id: b.id, title: b.text, level: b.level ?? 1, line: b.line, end: inner[inner.length - 1].end, path: b.path, tokens: inner.reduce((s, x) => s + x.tokens, 0), blocks: inner.length })
  })
  return {
    hash: hash53(src).toString(36),
    title: metaGet(f.meta, 'titulo', 'título', 'title') ?? sections[0]?.title ?? '',
    kind: deck ? 'presentacion' : 'documento',
    tokens: blocks.reduce((s, b) => s + b.tokens, 0),
    blocks,
    sections
  }
}

// ─── Leer en limpio ────────────────────────────────────────────────────────────────────────────

export interface ReadOptions {
  /** Sección (título, sin tildes ni mayúsculas, o su id). */
  section?: string
  /** Un bloque por id, o empezar en ese bloque. */
  block?: string
  from?: string
  maxTokens?: number
  /** Prefijar cada bloque con [#id]. */
  ids?: boolean
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function findSectionIdx(ix: DocIndex, q: string): IndexSection | undefined {
  const id = q.replace(/^#/, '')
  const want = norm(q)
  return ix.sections.find((s) => s.id === id) ?? ix.sections.find((s) => norm(s.title) === want) ?? ix.sections.find((s) => norm(s.title).includes(want))
}

export function readClean(ix: DocIndex, o: ReadOptions = {}): { text: string; tokens: number; next?: string; blocks: number } {
  let list = ix.blocks
  if (o.section) {
    const s = findSectionIdx(ix, o.section)
    if (!s) throw new Error(`No encuentro la sección «${o.section}» (mira buho-docs mapa)`)
    list = list.filter((b) => b.line >= s.line && b.end <= s.end)
  }
  if (o.block) {
    const b = ix.blocks.find((x) => x.id === o.block!.replace(/^#/, ''))
    if (!b) throw new Error(`No existe el bloque ${o.block} (los ids cambian si cambia el texto del bloque: vuelve a mirar el mapa)`)
    list = [b]
  }
  if (o.from) {
    const k = list.findIndex((x) => x.id === o.from!.replace(/^#/, ''))
    if (k < 0) throw new Error(`No existe el bloque ${o.from}`)
    list = list.slice(k)
  }
  const out: string[] = []
  let tokens = 0
  let next: string | undefined
  for (const b of list) {
    if (o.maxTokens && tokens + b.tokens > o.maxTokens && out.length) {
      next = b.id
      break
    }
    const body = b.type === 'titulo' ? `${'#'.repeat(b.level ?? 1)} ${b.text}` : b.type === 'item' ? `• ${b.text}` : b.type === 'salto' ? '' : b.text
    if (!body) continue
    out.push(o.ids ? `[#${b.id}] ${body}` : body)
    tokens += b.tokens
  }
  return { text: out.join('\n\n'), tokens, next, blocks: out.length }
}

// ─── Buscar (determinista: palabras + frase exacta + parecido para erratas) ──────────────────────

export interface SearchHit {
  id: string
  score: number
  path: string
  line: number
  type: BlockType
  snippet: string
}

const words = (s: string): string[] => norm(s).split(' ').filter((w) => w.length > 1)
const STOP = new Set('de la el los las un una unos unas y o en a al del que se por con para es su sus lo como mas pero sin sobre este esta ese esa no si ya le les nos the of and to in'.split(' '))

function trigrams(w: string): Set<string> {
  const s = `  ${w} `
  const out = new Set<string>()
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3))
  return out
}
function similar(a: string, b: string): number {
  if (a === b) return 1
  if (Math.abs(a.length - b.length) > 3) return 0
  const A = trigrams(a)
  const B = trigrams(b)
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

/**
 * Ranking BM25 sobre los bloques, con extra por frase exacta y por coincidir en títulos, y palabras
 * parecidas (≥ 0,5 de trigramas) para erratas y variantes («facturacion» ~ «facturas»). Sin modelos.
 */
export function search(ix: DocIndex, query: string, limit = 10): SearchHit[] {
  const q = words(query).filter((w) => !STOP.has(w))
  if (!q.length) return []
  const docs = ix.blocks.filter((b) => b.text).map((b) => ({ b, w: words(b.text) }))
  const N = docs.length || 1
  const avg = docs.reduce((s, d) => s + d.w.length, 0) / N || 1
  const vocab = new Set(docs.flatMap((d) => d.w))
  // Cada palabra de la consulta se expande a las del documento que se le parecen.
  const expand = new Map<string, { w: string; sim: number }[]>()
  for (const t of q) {
    const list: { w: string; sim: number }[] = []
    for (const v of vocab) {
      const sim = v === t ? 1 : v.startsWith(t) && t.length >= 4 ? 0.8 : t.length >= 4 ? similar(t, v) : 0
      if (sim >= 0.5) list.push({ w: v, sim })
    }
    expand.set(t, list)
  }
  const df = new Map<string, number>()
  for (const d of docs) for (const w of new Set(d.w)) df.set(w, (df.get(w) ?? 0) + 1)
  const phrase = norm(query)
  const hits: SearchHit[] = []
  for (const d of docs) {
    const tf = new Map<string, number>()
    for (const w of d.w) tf.set(w, (tf.get(w) ?? 0) + 1)
    let score = 0
    let matched = 0
    for (const t of q) {
      let best = 0
      for (const { w, sim } of expand.get(t) ?? []) {
        const f = tf.get(w)
        if (!f) continue
        const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5))
        const s = sim * idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.w.length / avg))))
        if (s > best) best = s
      }
      if (best > 0) matched++
      score += best
    }
    if (!score) continue
    score *= 0.5 + (0.5 * matched) / q.length
    if (phrase.includes(' ') && norm(d.b.text).includes(phrase)) score *= 2
    if (d.b.type === 'titulo') score *= 1.5
    hits.push({ id: d.b.id, score: Math.round(score * 100) / 100, path: d.b.path, line: d.b.line, type: d.b.type, snippet: snippet(d.b.text, q) })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

function snippet(text: string, q: string[]): string {
  const plain = text.replace(/\s+/g, ' ')
  const n = norm(plain)
  let at = -1
  for (const t of q) {
    at = n.indexOf(t.slice(0, Math.max(4, t.length - 2)))
    if (at >= 0) break
  }
  const start = Math.max(0, at - 60)
  const s = plain.slice(start, start + 200)
  return (start ? '…' : '') + s + (start + 200 < plain.length ? '…' : '')
}

// ─── Editar por id ─────────────────────────────────────────────────────────────────────────────

export type BlockEditMode = 'replace' | 'before' | 'after' | 'delete'

/** Cambia un bloque localizado por su id (líneas exactas del índice). */
export function editBlock(src: string, id: string, mode: BlockEditMode, content = ''): string {
  const ix = buildIndex(src)
  const b = ix.blocks.find((x) => x.id === id.replace(/^#/, ''))
  if (!b) throw new Error(`No existe el bloque #${id.replace(/^#/, '')}: su texto ha cambiado o el id es de otra versión. Mira de nuevo con buho-docs mapa o buscar.`)
  const nl = src.includes('\r\n') ? '\r\n' : '\n'
  const ls = src.split(/\r?\n/)
  const add = content.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n')
  const s = b.line - 1
  const e = b.end - 1
  // Un elemento de lista sustituido por texto sin marca conserva la suya.
  if (mode === 'replace' && b.type === 'item' && !LIST.test(add[0])) add[0] = (ls[s].match(LIST)?.[0] ?? '- ') + add[0]
  if (mode === 'replace' && b.type === 'titulo' && !/^#{1,6}\s/.test(add[0])) add[0] = '#'.repeat(b.level ?? 2) + ' ' + add[0]
  const sep = b.type === 'item' ? [] : ['']
  if (mode === 'replace') ls.splice(s, e - s + 1, ...add)
  else if (mode === 'delete') ls.splice(s, e - s + 1)
  else if (mode === 'before') ls.splice(s, 0, ...add, ...sep)
  else if (mode === 'after') ls.splice(e + 1, 0, ...sep, ...add)
  return ls.join(nl).replace(/(\r?\n){3,}/g, nl + nl)
}
