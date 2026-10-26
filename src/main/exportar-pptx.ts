import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import type Token from 'markdown-it/lib/token.mjs'
import { kindOf, metaGet, splitFront, splitSlides } from '@shared/doc'
import { newBuhoMd, parseAttrs } from '@shared/mdcore'
import { PALETA, type DatosGrafico } from '@shared/grafico'
import { temaDe } from '@shared/temas'
import { resolverTema } from './temas'
import { siguiente, type Rasterizada } from './exportar-word'
import wordmarkPath from '../renderer/src/brand/wordmark.png?asset'
import arbolPath from '../renderer/src/brand/arbol-deck.jpg?asset'

/**
 * Exportar una presentación a PowerPoint (.pptx) editable: cada diapositiva con su diseño (portada,
 * sección, cierre, cita…), etiqueta y título; el texto como cuadros de texto de verdad, tarjetas,
 * cifras y pasos como formas, tablas y gráficos nativos (con sus datos), imágenes y notas del orador.
 * Colores y letras del tema. Sirve para PowerPoint, Keynote y Google Slides.
 */

type Run = PptxGenJS.TextProps
interface Parr {
  runs: Run[]
  bullet?: 'bullet' | 'num'
  nivel?: number
  estilo?: 'h3' | 'p' | 'cita' | 'nota'
}
type El =
  | { k: 'texto'; parrafos: Parr[] }
  | { k: 'tarjetas'; cols: number; items: { titulo: Run[]; cuerpo: Parr[] }[] }
  | { k: 'cifras'; cols: number; items: { num: string; texto: string }[] }
  | { k: 'pasos'; horizontal: boolean; items: { titulo: Run[]; cuerpo: Parr[] }[] }
  | { k: 'tabla'; filas: { head: boolean; celdas: Run[][] }[] }
  | { k: 'grafico'; datos: DatosGrafico }
  | { k: 'imagen'; src: string }
  | { k: 'png'; png: Buffer; w: number; h: number }
  | { k: 'codigo'; texto: string; lang: string }
  | { k: 'caja'; oscura: boolean; parrafos: Parr[] }
  | { k: 'columnas'; cols: El[][] }

const W = 13.333
const H = 7.5
const hex = (c: string | undefined, d: string): string => (c ?? d).replace('#', '').toUpperCase()
const font = (f: string | undefined, d: string): string => (f ?? d).split(',')[0].replace(/['"]/g, '').trim()
const textoDe = (runs: Run[]): string => runs.map((r) => r.text ?? '').join('')

function closeOf(toks: Token[], i: number): number {
  let depth = 0
  for (let k = i; k < toks.length; k++) {
    depth += toks[k].nesting
    if (depth === 0) return k
  }
  return toks.length - 1
}

/** Una fórmula LaTeX sencilla, en texto legible. */
function latexPlano(t: string): string {
  const sup: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', '-': '⁻', '+': '⁺' }
  let s = t
  for (let k = 0; k < 4; k++) s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
  s = s.replace(/\^\{([^{}]*)\}|\^(\w)/g, (_m, a: string | undefined, b: string | undefined) => [...(a ?? b ?? '')].map((ch) => sup[ch] ?? '^' + ch).join(''))
  s = s.replace(/_\{([^{}]*)\}/g, '_$1')
  const sim: Record<string, string> = { cdot: '·', times: '×', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', approx: '≈', sum: 'Σ', pi: 'π', alpha: 'α', beta: 'β', eta: 'η', lambda: 'λ', mu: 'μ', sigma: 'σ', Delta: 'Δ', infty: '∞', to: '→', rightarrow: '→', pm: '±', sqrt: '√' }
  s = s.replace(/\\([a-zA-Z]+)/g, (_m, n: string) => sim[n] ?? '')
  return s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

/** Texto en línea → trozos con negrita, cursiva, enlaces. */
function runs(tok: Token | undefined, base: PptxGenJS.TextPropsOptions = {}): Run[] {
  const out: Run[] = []
  let bold = !!base.bold
  let italic = !!base.italic
  let strike = false
  let href: string | null = null
  for (const c of tok?.children ?? []) {
    switch (c.type) {
      case 'text':
      case 'html_inline':
      case 'code_inline': {
        const text = c.type === 'html_inline' ? c.content.replace(/<[^>]+>/g, '') : c.content
        if (text) out.push({ text, options: { ...base, bold, italic, ...(strike ? { strike: 'sngStrike' as const } : {}), ...(c.type === 'code_inline' ? { fontFace: 'Consolas' } : {}), ...(href ? { hyperlink: { url: href } } : {}) } })
        break
      }
      case 'math_inline':
        // PowerPoint no entiende LaTeX: la fórmula, legible (a/b, ·, ², índices).
        out.push({ text: latexPlano(c.content), options: { ...base, italic: true, fontFace: 'Cambria Math' } })
        break
      case 'softbreak':
        out.push({ text: ' ', options: base })
        break
      case 'hardbreak':
        out.push({ text: '', options: { ...base, breakLine: true } })
        break
      case 'strong_open':
        bold = true
        break
      case 'strong_close':
        bold = !!base.bold
        break
      case 'em_open':
        italic = true
        break
      case 'em_close':
        italic = !!base.italic
        break
      case 's_open':
        strike = true
        break
      case 's_close':
        strike = false
        break
      case 'link_open':
        href = /^https?:/.test(c.attrGet('href') ?? '') ? c.attrGet('href') : null
        break
      case 'link_close':
        href = null
        break
    }
  }
  return out
}

/** Párrafos de texto (párrafos, listas, ### , citas) de una serie de tokens. */
function parrafos(toks: Token[], estilo: Parr['estilo'] = 'p', nivel = 0, tipo?: 'bullet' | 'num'): Parr[] {
  const out: Parr[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type === 'heading_open') {
      out.push({ runs: runs(toks[i + 1], { bold: true }), estilo: 'h3' })
      i = closeOf(toks, i)
    } else if (t.type === 'paragraph_open') {
      out.push({ runs: runs(toks[i + 1]), estilo, ...(tipo && toks[i - 1]?.type === 'list_item_open' ? { bullet: tipo, nivel } : {}) })
      i = closeOf(toks, i)
    } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const e = closeOf(toks, i)
      out.push(...parrafos(toks.slice(i + 1, e), estilo, tipo ? nivel + 1 : 0, t.type === 'bullet_list_open' ? 'bullet' : 'num'))
      i = e
    } else if (t.type === 'blockquote_open') {
      const e = closeOf(toks, i)
      out.push(...parrafos(toks.slice(i + 1, e), 'cita'))
      i = e
    }
  }
  return out
}

/** Grupos que empiezan en cada ### (tarjetas, pasos, panel). */
function porH3(toks: Token[]): { titulo: Run[]; cuerpo: Parr[] }[] {
  const g: { titulo: Run[]; cuerpo: Parr[] }[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type === 'heading_open' && t.tag === 'h3') {
      g.push({ titulo: runs(toks[i + 1], { bold: true }), cuerpo: [] })
      i = closeOf(toks, i)
      continue
    }
    const e = t.nesting === 1 ? closeOf(toks, i) : i
    if (g.length) g[g.length - 1].cuerpo.push(...parrafos(toks.slice(i, e + 1)))
    i = e
  }
  return g
}

/** Imágenes ya dibujadas (diagramas, SVG, fórmulas) en el orden del documento. */
let cola: Rasterizada[] = []

/** Tokens de una diapositiva → elementos (el texto seguido se junta en un solo cuadro). */
function elementos(toks: Token[]): El[] {
  const out: El[] = []
  const texto = (ps: Parr[]): void => {
    if (!ps.length) return
    const last = out[out.length - 1]
    if (last?.k === 'texto') last.parrafos.push(...ps)
    else out.push({ k: 'texto', parrafos: ps })
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type === 'contenedor_open') {
      const e = closeOf(toks, i)
      const inner = toks.slice(i + 1, e)
      const a = (t.meta ?? { classes: [], kv: {} }) as ReturnType<typeof parseAttrs> & { grafico?: DatosGrafico }
      const n = Number(a.classes.find((c) => /^is-\d$/.test(c))?.slice(3)) || 0
      switch (t.info) {
        case 'tarjetas':
          out.push({ k: 'tarjetas', cols: n || 0, items: porH3(inner) })
          break
        case 'cifras': {
          const items: { num: string; texto: string }[] = []
          for (let k = 0; k < inner.length; k++) {
            if (inner[k].type !== 'inline') continue
            const kids = inner[k].children ?? []
            const si = kids.findIndex((x) => x.type === 'strong_open')
            items.push({ num: si >= 0 ? kids[si + 1]?.content ?? '' : '', texto: (si >= 0 ? kids.slice(si + 3) : kids).map((x) => x.content).join('').trim() })
          }
          out.push({ k: 'cifras', cols: n || items.length, items })
          break
        }
        case 'pasos':
          out.push({ k: 'pasos', horizontal: a.classes.includes('is-horizontal'), items: porH3(inner) })
          break
        case 'columnas': {
          const cols: El[][] = []
          for (let k = 0; k < inner.length; k++)
            if (inner[k].type === 'col_open') {
              const ce = closeOf(inner, k)
              cols.push(elementos(inner.slice(k + 1, ce)))
              k = ce
            }
          out.push({ k: 'columnas', cols: cols.length ? cols : [elementos(inner)] })
          break
        }
        case 'grafico':
          if (a.grafico) out.push({ k: 'grafico', datos: a.grafico })
          texto(parrafos(inner, 'nota'))
          break
        case 'caja':
        case 'panel':
          out.push({ k: 'caja', oscura: t.info === 'panel' || a.classes.includes('is-navy') || a.classes.includes('is-oscura'), parrafos: parrafos(inner) })
          break
        case 'nota':
          texto(parrafos(inner, 'nota'))
          break
        case 'cita':
          texto(parrafos(inner, 'cita'))
          break
        case 'hueco':
          texto([{ runs: [{ text: `[Pendiente: ${a.kv.texto ?? a.kv.id ?? ''}]`, options: { italic: true, color: '888888' } }] }])
          break
        default:
          texto(parrafos(inner))
      }
      i = e
    } else if (t.type === 'fence' || t.type === 'math_block') {
      const lang = t.type === 'math_block' ? 'math' : (t.info ?? '').trim().split(/\s+/)[0].toLowerCase()
      const im = lang === 'mermaid' || lang === 'svg' || lang === 'math' ? siguiente(cola, lang) : undefined
      if (im) out.push({ k: 'png', png: im.png, w: im.w, h: im.h })
      else out.push({ k: 'codigo', texto: t.content.replace(/\n$/, ''), lang })
    } else if (t.type === 'table_open') {
      const e = closeOf(toks, i)
      const filas: { head: boolean; celdas: Run[][] }[] = []
      for (let k = i; k < e; k++) {
        if (toks[k].type === 'tr_open') filas.push({ head: false, celdas: [] })
        if (toks[k].type === 'th_open' || toks[k].type === 'td_open') {
          filas[filas.length - 1].head = toks[k].type === 'th_open'
          filas[filas.length - 1].celdas.push(runs(toks[k + 1]))
        }
      }
      out.push({ k: 'tabla', filas })
      i = e
    } else if (t.type === 'paragraph_open' && toks[i + 1]?.children?.length === 1 && toks[i + 1].children![0].type === 'image') {
      out.push({ k: 'imagen', src: toks[i + 1].children![0].attrGet('src') ?? '' })
      i = closeOf(toks, i)
    } else if (t.nesting === 1) {
      const e = closeOf(toks, i)
      texto(parrafos(toks.slice(i, e + 1)))
      i = e
    }
  }
  return out
}

/** Divide el Markdown de una diapositiva por `+++` de primer nivel (fuera de bloques :::). */
function columnasDe(md: string): string[] {
  const out: string[] = [[]].map(() => '')
  let depth = 0
  for (const l of md.split(/\r?\n/)) {
    const t = l.trim()
    if (/^:{3,}\s*[\p{L}\w-]/u.test(t)) depth++
    else if (/^:{3,}$/.test(t)) depth = Math.max(0, depth - 1)
    if (depth === 0 && /^\+{3,}$/.test(t)) {
      out.push('')
      continue
    }
    out[out.length - 1] += l + '\n'
  }
  return out
}

export async function exportPptx(source: string, docPath: string, baseDir: string, imagenes: Rasterizada[] = []): Promise<{ buffer: Buffer; slides: number }> {
  cola = [...imagenes]
  const f = splitFront(source)
  const g = (...k: string[]): string | undefined => metaGet(f.meta, ...k)
  if (kindOf(f.meta) !== 'presentacion') throw new Error('PowerPoint es para presentaciones (tipo: presentacion). Para documentos, exporta a Word con --word')
  const tema = resolverTema(temaDe(f.meta))
  const P = hex(tema.colores.principal, '#0a1f3a')
  const A = hex(tema.colores.acento, '#00c1b8')
  const S = hex(tema.colores.suave, '#e8f8f7')
  const T = hex(tema.colores.texto, '#1c2a3b')
  const serif = font(tema.fuentes?.titulos, tema.base === 'buho' ? 'Georgia' : 'Calibri')
  const sans = font(tema.fuentes?.texto, 'Calibri')
  const md = newBuhoMd()
  const titulo = g('titulo', 'título', 'title') ?? ''
  const logo = tema.logo ?? (tema.id === 'buho' ? wordmarkPath : undefined)

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = titulo
  pptx.author = g('autor', 'author') ?? 'Búho Docs'
  pptx.company = tema.marca ?? ''
  pptx.theme = { headFontFace: serif, bodyFontFace: sans }

  const ruta = (src: string): string | null => {
    let p = src.replace(/^buho:\/\/file\//, '')
    p = decodeURIComponent(p)
    if (!isAbsolute(p)) p = join(baseDir, p)
    return existsSync(p) && /\.(png|jpe?g|gif|svg)$/i.test(p) ? p : null
  }

  // ─── Medidas aproximadas (pulgadas) para repartir el alto ───
  const lineas = (s: string, w: number, pt: number): number => Math.max(1, Math.ceil((s.length * pt * 0.0072) / Math.max(0.5, w)))
  const altoParr = (ps: Parr[], w: number, pt: number): number => ps.reduce((h, p) => h + lineas(textoDe(p.runs), w - (p.bullet ? 0.4 : 0), p.estilo === 'nota' ? pt - 4 : pt) * pt * 0.0185 + 0.08, 0.1)
  const altoEl = (e: El, w: number): number => {
    switch (e.k) {
      case 'texto':
        return altoParr(e.parrafos, w, 18)
      case 'tarjetas': {
        const cols = e.cols || Math.min(4, e.items.length)
        const cw = (w - (cols - 1) * 0.25) / cols
        const filas = Math.ceil(e.items.length / cols)
        return filas * Math.max(...e.items.map((it) => 0.55 + altoParr(it.cuerpo, cw - 0.4, 14))) + (filas - 1) * 0.2
      }
      case 'cifras':
        return 1.45 * Math.ceil(e.items.length / Math.min(4, e.cols || e.items.length))
      case 'pasos':
        return e.horizontal ? 1.9 : e.items.reduce((h, it) => h + 0.45 + altoParr(it.cuerpo, w - 0.8, 14), 0)
      case 'tabla':
        return e.filas.length * 0.42
      case 'grafico':
        return 3.4
      case 'imagen':
        return 3.4
      case 'png':
        return Math.min(4.2, (w * e.h) / e.w)
      case 'codigo':
        return e.texto.split('\n').length * 0.24 + 0.3
      case 'caja':
        return altoParr(e.parrafos, w - 0.5, 16) + 0.35
      case 'columnas':
        return Math.max(...e.cols.map((c) => c.reduce((h, x) => h + altoEl(x, (w - 0.4 * (e.cols.length - 1)) / e.cols.length) + 0.2, 0)))
    }
  }

  const props = (p: Parr, pt: number, color: string): Run[] => {
    const base: PptxGenJS.TextPropsOptions = {
      fontSize: p.estilo === 'nota' ? pt - 5 : p.estilo === 'h3' ? pt + 1 : p.estilo === 'cita' ? pt + 4 : pt,
      color: p.estilo === 'nota' ? '7C8A9B' : p.estilo === 'h3' ? P : color,
      fontFace: p.estilo === 'cita' ? serif : sans,
      italic: p.estilo === 'cita' || undefined,
      paraSpaceAfter: 6,
      ...(p.bullet ? { bullet: p.bullet === 'num' ? { type: 'number' } : { indent: 18 }, indentLevel: p.nivel ?? 0 } : {})
    }
    const rs = p.runs.length ? p.runs : [{ text: ' ' }]
    return rs.map((r, k) => ({ text: r.text, options: { ...base, ...r.options, ...(k === rs.length - 1 ? { breakLine: true } : {}) } }))
  }
  const cuadroTexto = (s: PptxGenJS.Slide, ps: Parr[], x: number, y: number, w: number, h: number, pt: number, color = T): void => {
    if (!ps.length) return
    const rs = ps.flatMap((p) => props(p, pt, color))
    const last = rs[rs.length - 1]
    if (last?.options) delete last.options.breakLine
    s.addText(rs, { x, y, w, h, valign: 'top', margin: 0, fit: 'shrink', lineSpacingMultiple: 1.05 })
  }

  /** Dibuja los elementos en la caja (x, y, w, h), repartiendo el alto. */
  const dibujar = (s: PptxGenJS.Slide, els: El[], x: number, y0: number, w: number, h: number, oscuro: boolean): void => {
    const gap = 0.22
    const pedidos = els.map((e) => altoEl(e, w))
    const total = pedidos.reduce((a, b) => a + b, 0) + gap * Math.max(0, els.length - 1)
    // Si no cabe se encoge todo; lo que se estira (gráficos, imágenes) aprovecha el hueco que sobre.
    const flex = els.filter((e) => e.k === 'grafico' || e.k === 'imagen').length
    const sobra = h - total
    const factor = total > h ? h / total : 1
    // Como en el PDF: el contenido, centrado en el alto que queda (salvo si hay gráficos o imágenes que lo llenan).
    let y = y0 + (sobra > 0 && !flex ? sobra / 2 : 0)
    const tinta = oscuro ? 'FFFFFF' : T
    els.forEach((e, i) => {
      let eh = pedidos[i] * factor + ((e.k === 'grafico' || e.k === 'imagen') && sobra > 0 && flex ? Math.min(sobra / flex, 1.5) : 0)
      eh = Math.max(0.3, eh)
      switch (e.k) {
        case 'texto':
          cuadroTexto(s, e.parrafos, x, y, w, eh, 18, tinta)
          break
        case 'caja':
          s.addShape('roundRect', { x, y, w, h: eh, fill: { color: e.oscura ? P : S }, line: { color: e.oscura ? P : S }, rectRadius: 0.08 })
          s.addShape('rect', { x, y, w: 0.06, h: eh, fill: { color: A }, line: { color: A } })
          cuadroTexto(s, e.parrafos, x + 0.3, y + 0.17, w - 0.5, eh - 0.3, 16, e.oscura ? 'FFFFFF' : T)
          break
        case 'tarjetas': {
          const cols = e.cols || Math.min(4, e.items.length)
          const cw = (w - (cols - 1) * 0.25) / cols
          const filas = Math.ceil(e.items.length / cols)
          const ch = (eh - (filas - 1) * 0.2) / filas
          e.items.forEach((it, k) => {
            const cx = x + (k % cols) * (cw + 0.25)
            const cy = y + Math.floor(k / cols) * (ch + 0.2)
            s.addShape('roundRect', { x: cx, y: cy, w: cw, h: ch, fill: { color: oscuro ? '13305A' : k % 2 ? 'EDF1F7' : S }, line: { color: oscuro ? '13305A' : 'FFFFFF' }, rectRadius: 0.1 })
            s.addShape('rect', { x: cx, y: cy + 0.18, w: 0.06, h: 0.36, fill: { color: A }, line: { color: A } })
            s.addText(it.titulo.map((r) => ({ text: r.text, options: { ...r.options, bold: true } })), { x: cx + 0.22, y: cy + 0.12, w: cw - 0.4, h: 0.5, fontSize: 17, color: oscuro ? 'FFFFFF' : P, fontFace: sans, margin: 0, valign: 'middle', fit: 'shrink' })
            cuadroTexto(s, it.cuerpo, cx + 0.22, cy + 0.66, cw - 0.4, ch - 0.8, 14, oscuro ? 'D8E2EE' : T)
          })
          break
        }
        case 'cifras': {
          const cols = Math.min(4, e.cols || e.items.length)
          const cw = (w - (cols - 1) * 0.3) / cols
          e.items.forEach((it, k) => {
            const cx = x + (k % cols) * (cw + 0.3)
            const cy = y + Math.floor(k / cols) * 1.45 * factor
            s.addText(it.num, { x: cx, y: cy, w: cw, h: 0.8, fontSize: 40, bold: true, color: oscuro ? A : P, fontFace: serif, margin: 0, valign: 'bottom', fit: 'shrink' })
            s.addText(it.texto, { x: cx, y: cy + 0.82, w: cw, h: 0.55, fontSize: 14, color: oscuro ? 'D8E2EE' : '5D6B7C', fontFace: sans, margin: 0, valign: 'top', fit: 'shrink' })
          })
          break
        }
        case 'pasos': {
          if (e.horizontal) {
            const n = e.items.length
            const cw = (w - (n - 1) * 0.3) / n
            e.items.forEach((it, k) => {
              const cx = x + k * (cw + 0.3)
              s.addShape('ellipse', { x: cx, y, w: 0.5, h: 0.5, fill: { color: A }, line: { color: A } })
              s.addText(String(k + 1), { x: cx, y, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 })
              s.addText(it.titulo, { x: cx, y: y + 0.6, w: cw, h: 0.45, fontSize: 16, bold: true, color: oscuro ? 'FFFFFF' : P, fontFace: sans, margin: 0, fit: 'shrink' })
              cuadroTexto(s, it.cuerpo, cx, y + 1.05, cw, eh - 1.05, 14, tinta)
            })
          } else {
            let py = y
            const unit = eh / Math.max(0.1, e.items.reduce((hh, it) => hh + 0.45 + altoParr(it.cuerpo, w - 0.8, 14), 0))
            e.items.forEach((it, k) => {
              const ih = (0.45 + altoParr(it.cuerpo, w - 0.8, 14)) * unit
              s.addShape('ellipse', { x, y: py, w: 0.42, h: 0.42, fill: { color: A }, line: { color: A } })
              s.addText(String(k + 1), { x, y: py, w: 0.42, h: 0.42, fontSize: 14, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 })
              s.addText(it.titulo, { x: x + 0.6, y: py, w: w - 0.6, h: 0.42, fontSize: 16, bold: true, color: oscuro ? 'FFFFFF' : P, fontFace: sans, margin: 0, valign: 'middle', fit: 'shrink' })
              cuadroTexto(s, it.cuerpo, x + 0.6, py + 0.45, w - 0.6, ih - 0.5, 14, tinta)
              py += ih
            })
          }
          break
        }
        case 'tabla': {
          const cols = Math.max(...e.filas.map((f) => f.celdas.length))
          const rows: PptxGenJS.TableRow[] = e.filas.map((f, r) =>
            f.celdas.map((c) => ({
              text: c.length ? c : [{ text: '' }],
              options: { fill: { color: f.head ? P : r % 2 ? 'F6F9FB' : 'FFFFFF' }, color: f.head ? 'FFFFFF' : T, bold: f.head || undefined, fontSize: f.head ? 13 : 14, fontFace: sans, valign: 'middle' as const, margin: [0.05, 0.1, 0.05, 0.1] as [number, number, number, number] }
            }))
          )
          s.addTable(rows, { x, y, w, colW: Array(cols).fill(w / cols), rowH: Math.min(0.5, eh / e.filas.length), border: { type: 'solid', pt: 0.5, color: 'DFE5EC' }, autoPage: false })
          break
        }
        case 'grafico':
          graficoPptx(pptx, s, e.datos, x, y, w, eh, sans)
          break
        case 'imagen': {
          const p = ruta(e.src)
          if (p) s.addImage({ path: p, x, y, w, h: eh, sizing: { type: 'contain', w, h: eh } })
          break
        }
        case 'png': {
          // A su proporción, centrado, sin pasar de la caja.
          const ratio = e.h / e.w
          const iw = Math.min(w, eh / ratio)
          s.addImage({ data: 'image/png;base64,' + e.png.toString('base64'), x: x + (w - iw) / 2, y, w: iw, h: iw * ratio })
          break
        }
        case 'codigo':
          s.addShape('roundRect', { x, y, w, h: eh, fill: { color: 'F7F9FB' }, line: { color: 'DFE5EC' }, rectRadius: 0.06 })
          s.addText(e.texto, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: eh - 0.24, fontFace: 'Consolas', fontSize: 13, color: '1C2A3B', valign: 'top', margin: 0, fit: 'shrink' })
          break
        case 'columnas': {
          const n = e.cols.length
          const cw = (w - 0.4 * (n - 1)) / n
          e.cols.forEach((c, k) => dibujar(s, c, x + k * (cw + 0.4), y, cw, eh, oscuro))
          break
        }
      }
      y += eh + gap
    })
  }

  const slides = splitSlides(source)
  slides.forEach((sl, idx) => {
    const d = sl.directives
    const diseno = (d['diseño'] ?? (idx === 0 ? 'portada' : 'normal')).toLowerCase()
    const fondo = (d.fondo ?? '').toLowerCase()
    const oscuro = diseno === 'seccion' || diseno === 'cierre' || fondo === 'navy'
    const s = pptx.addSlide()
    s.background = { color: oscuro ? P : fondo === 'turquesa' ? S : fondo === 'gris' ? 'F2F4F7' : 'FFFFFF' }
    const toks = md.parse(sl.content, {}) as Token[]
    // Título: el primer # o ## de la diapositiva.
    const hi = toks.findIndex((t) => t.type === 'heading_open' && (t.tag === 'h1' || t.tag === 'h2'))
    const tit = hi >= 0 ? runs(toks[hi + 1]) : []
    const resto = hi >= 0 ? [...toks.slice(0, hi), ...toks.slice(closeOf(toks, hi) + 1)] : toks
    const etiqueta = d.etiqueta
    const tinta = oscuro ? 'FFFFFF' : P

    if (diseno === 'portada') {
      if (logo && existsSync(logo)) s.addImage({ path: logo, x: 0.7, y: 0.6, w: 1.9, h: 0.5, sizing: { type: 'contain', w: 1.9, h: 0.5 } })
      if (tema.id === 'buho' && existsSync(arbolPath)) s.addImage({ path: arbolPath, x: W - 5.6, y: 0, w: 5.6, h: H, sizing: { type: 'cover', w: 5.6, h: H } })
      const tw = tema.id === 'buho' ? 7.2 : W - 1.4
      if (etiqueta) s.addText(etiqueta.toUpperCase(), { x: 0.7, y: 2.2, w: tw, h: 0.4, fontSize: 13, bold: true, color: A, fontFace: sans, margin: 0, charSpacing: 1 })
      s.addText(tit.length ? tit : [{ text: titulo }], { x: 0.7, y: 2.65, w: tw, h: 1.9, fontSize: 40, bold: true, color: P, fontFace: serif, margin: 0, valign: 'top', fit: 'shrink' })
      cuadroTexto(s, parrafos(resto), 0.7, 4.7, tw, 1.8, 20)
    } else {
      const cita = diseno === 'cita'
      let y = 0.55
      if (etiqueta) {
        s.addText(etiqueta.toUpperCase(), { x: 0.7, y, w: W - 1.4, h: 0.35, fontSize: 12, bold: true, color: A, fontFace: sans, margin: 0, charSpacing: 1 })
        y += 0.42
      }
      if (tit.length) {
        const grande = diseno === 'seccion' || diseno === 'cierre'
        s.addText(tit.map((r) => ({ text: r.text, options: { ...r.options, bold: true } })), { x: 0.7, y: grande ? 2.3 : y, w: W - 1.4, h: grande ? 1.4 : 0.85, fontSize: grande ? 40 : 30, color: tinta, fontFace: serif, margin: 0, valign: grande ? 'bottom' : 'top', fit: 'shrink' })
        y = grande ? 3.9 : y + 1.0
      }
      const els = elementos(resto)
      const imgDir = d.imagen ? ruta(d.imagen) : null
      const ancho = imgDir ? W / 2 - 1.0 : W - 1.4
      if (cita) cuadroTexto(s, parrafos(resto, 'cita'), 1.2, Math.max(y, 2), W - 2.4, H - Math.max(y, 2) - 1, 28, tinta)
      else {
        // Columnas de primer nivel (+++): cada una se dibuja en su franja.
        const cols = columnasDe(sl.content.replace(/^\s*#{1,2} .*$/m, ''))
        if (cols.length > 1) {
          const n = cols.length
          const cw = (ancho - 0.4 * (n - 1)) / n
          cols.forEach((c, k) => dibujar(s, elementos(md.parse(c, {}) as Token[]), 0.7 + k * (cw + 0.4), y, cw, H - y - 0.75, oscuro))
        } else dibujar(s, els, 0.7, y, ancho, H - y - 0.75, oscuro)
      }
      if (imgDir) s.addImage({ path: imgDir, x: W / 2, y: 0, w: W / 2, h: H, sizing: { type: 'cover', w: W / 2, h: H } })
      // Pie: título del documento y número.
      s.addText(titulo, { x: 0.7, y: H - 0.45, w: 8, h: 0.3, fontSize: 10, color: oscuro ? '9FB0C4' : '8D99A8', fontFace: sans, margin: 0 })
      s.addText(String(idx + 1), { x: W - 1.2, y: H - 0.45, w: 0.5, h: 0.3, fontSize: 10, color: oscuro ? '9FB0C4' : '8D99A8', fontFace: sans, margin: 0, align: 'right' })
    }
    if (d.notas) s.addNotes(d.notas)
  })

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  void docPath
  return { buffer, slides: slides.length }
}

/** Gráfico nativo de PowerPoint, con los colores y el orden de la vista. */
function graficoPptx(pptx: PptxGenJS, s: PptxGenJS.Slide, g: DatosGrafico, x: number, y: number, w: number, h: number, sans: string): void {
  const colores = PALETA.map((c) => c.replace('#', ''))
  const fmt = g.unidad === '%' ? '0" %"' : g.unidad === '€' ? '#,##0" €"' : '#,##0.##'
  const tarta = g.tipo === 'tarta' || g.tipo === 'donut'
  const data = (tarta ? g.series.slice(0, 1) : g.series).map((se) => ({ name: se.nombre, labels: g.categorias, values: se.valores.map((v) => v ?? 0) }))
  const tipo = tarta ? (g.tipo === 'tarta' ? pptx.ChartType.pie : pptx.ChartType.doughnut) : g.tipo === 'lineas' ? pptx.ChartType.line : g.tipo === 'area' ? pptx.ChartType.area : pptx.ChartType.bar
  s.addChart(tipo, data, {
    x,
    y,
    w,
    h,
    barDir: g.tipo === 'barras' ? 'bar' : 'col',
    barGapWidthPct: 80,
    // Una sola serie: todas las barras del mismo color (la identidad es la serie, no la categoría).
    chartColors: !tarta && g.series.length === 1 ? [colores[0]] : colores,
    showTitle: !!g.titulo,
    title: g.titulo,
    titleFontSize: 14,
    titleColor: '1C2A3B',
    titleFontFace: sans,
    showLegend: tarta || g.series.length > 1,
    legendPos: tarta ? 'r' : 'b',
    legendFontSize: 12,
    legendFontFace: sans,
    showValue: !tarta && g.categorias.length * g.series.length <= 14,
    showPercent: tarta,
    dataLabelFormatCode: fmt,
    dataLabelFontSize: 11,
    catAxisLabelFontSize: 12,
    valAxisLabelFontSize: 11,
    catAxisLabelFontFace: sans,
    valAxisLabelFontFace: sans,
    valAxisLabelFormatCode: fmt,
    valGridLine: { color: 'E3E8EE', size: 0.75 },
    catGridLine: { style: 'none' },
    lineSize: 2,
    lineDataSymbolSize: 7
  })
}
