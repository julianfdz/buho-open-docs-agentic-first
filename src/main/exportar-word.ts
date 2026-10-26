import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild
} from 'docx'
import type Token from 'markdown-it/lib/token.mjs'
import { kindOf, metaGet, splitFront, splitSlides } from '@shared/doc'
import { newBuhoMd, parseAttrs } from '@shared/mdcore'
import { temaDe, type Tema } from '@shared/temas'
import { resolverTema } from './temas'
import { ChartRun, type ChartRunOptions } from 'docx/charts'
import { PALETA, type DatosGrafico } from '@shared/grafico'
import wordmarkPath from '../renderer/src/brand/wordmark.png?asset'

/**
 * Exportar a Word (.docx) de verdad, editable: estilos de título que Word reconoce (Título 1, 2, 3),
 * listas y numeraciones, tablas con cabecera del color del tema, cajas, tarjetas, cifras, pasos,
 * columnas y panel como tablas sombreadas, imágenes, portada, cabecera y pie con «página X de Y», y
 * el índice como tabla de contenidos que Word actualiza al abrir. Letras y colores salen del tema.
 */

type Child = Paragraph | Table
interface Ctx {
  color?: string
  size?: number
  italic?: boolean
  align?: (typeof AlignmentType)[keyof typeof AlignmentType]
}

const hex = (c: string | undefined, d: string): string => (c ?? d).replace('#', '').toUpperCase()
const font = (f: string | undefined, d: string): string => (f ?? d).split(',')[0].replace(/['"]/g, '').trim()

/** Tamaño de una imagen PNG o JPEG (para que salga a su proporción). */
function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
      i += 2 + len
    }
  }
  return null
}

function imagen(src: string, baseDir: string, maxW = 600): ImageRun | TextRun {
  let p = src
  if (/^buho:\/\/file\//.test(p)) p = decodeURIComponent(p.replace(/^buho:\/\/file\//, ''))
  if (!isAbsolute(p)) p = join(baseDir, p)
  if (!existsSync(p) || !/\.(png|jpe?g|gif|bmp)$/i.test(p)) return new TextRun({ text: `[imagen: ${src}]`, italics: true, color: '888888' })
  const data = readFileSync(p)
  const s = imageSize(data) ?? { w: 600, h: 400 }
  const w = Math.min(maxW, s.w)
  const type = /\.png$/i.test(p) ? 'png' : /\.gif$/i.test(p) ? 'gif' : /\.bmp$/i.test(p) ? 'bmp' : 'jpg'
  return new ImageRun({ data, type, transformation: { width: w, height: Math.round((w * s.h) / s.w) } })
}

export async function exportDocx(source: string, docPath: string, baseDir: string): Promise<{ buffer: Buffer; pages?: number }> {
  const f = splitFront(source)
  const meta = f.meta
  const g = (...k: string[]): string | undefined => metaGet(meta, ...k)
  const tema: Tema = resolverTema(temaDe(meta))
  const P = hex(tema.colores.principal, '#0a1f3a')
  const A = hex(tema.colores.acento, '#00c1b8')
  const S = hex(tema.colores.suave, '#f3f5f8')
  const T = hex(tema.colores.texto, '#1c2a3b')
  const serif = font(tema.fuentes?.titulos, tema.base === 'buho' ? 'Georgia' : 'Calibri')
  const sans = font(tema.fuentes?.texto, 'Calibri')
  const deck = kindOf(meta) === 'presentacion'
  const md = newBuhoMd()

  // ─── Texto en línea ─────────────────────────────────────────────────────────────────────────
  function runs(tok: Token | undefined, ctx: Ctx = {}): ParagraphChild[] {
    const out: ParagraphChild[] = []
    let bold = false
    let italics = !!ctx.italic
    let strike = false
    let code = false
    let link: { href: string; kids: TextRun[] } | null = null
    const push = (r: TextRun | ImageRun): void => {
      if (link && r instanceof TextRun) link.kids.push(r)
      else out.push(r)
    }
    for (const c of tok?.children ?? []) {
      switch (c.type) {
        case 'text':
        case 'html_inline':
          if (c.content) push(new TextRun({ text: c.content.replace(/<[^>]+>/g, ''), bold, italics, strike, font: code ? 'Consolas' : undefined, color: link ? A : ctx.color, size: ctx.size, underline: link ? {} : undefined }))
          break
        case 'code_inline':
          push(new TextRun({ text: c.content, font: 'Consolas', color: ctx.color, size: ctx.size, shading: { type: ShadingType.CLEAR, fill: 'EEF1F5', color: 'auto' } }))
          break
        case 'softbreak':
          push(new TextRun({ text: ' ', size: ctx.size }))
          break
        case 'hardbreak':
          push(new TextRun({ break: 1 }))
          break
        case 'strong_open':
          bold = true
          break
        case 'strong_close':
          bold = false
          break
        case 'em_open':
          italics = true
          break
        case 'em_close':
          italics = !!ctx.italic
          break
        case 's_open':
          strike = true
          break
        case 's_close':
          strike = false
          break
        case 'link_open':
          link = { href: c.attrGet('href') ?? '', kids: [] }
          break
        case 'link_close':
          if (link) out.push(/^https?:/.test(link.href) ? new ExternalHyperlink({ link: link.href, children: link.kids }) : (link.kids[0] ?? new TextRun('')))
          link = null
          break
        case 'image':
          out.push(imagen(c.attrGet('src') ?? '', baseDir))
          break
        default:
          code = false
      }
    }
    return out
  }

  const titulos: { title: string; level: number }[] = []
  const recoger = (toks: Token[]): void => {
    for (let k = 0; k < toks.length; k++) if (toks[k].type === 'heading_open') titulos.push({ title: (toks[k + 1].content ?? '').replace(/\s*\{[^}]*\}\s*$/, ''), level: Number(toks[k].tag[1]) })
  }
  // ─── Bloques ────────────────────────────────────────────────────────────────────────────────
  const numberingInstances = { n: 0 }
  /** Índice del cierre que corresponde a la apertura en `i`. */
  const closeOf = (toks: Token[], i: number): number => {
    let depth = 0
    for (let k = i; k < toks.length; k++) {
      depth += toks[k].nesting
      if (depth === 0) return k
    }
    return toks.length - 1
  }
  const cellBorders = (c = 'DFE5EC') => ({ top: { style: BorderStyle.SINGLE, size: 4, color: c }, bottom: { style: BorderStyle.SINGLE, size: 4, color: c }, left: { style: BorderStyle.SINGLE, size: 4, color: c }, right: { style: BorderStyle.SINGLE, size: 4, color: c } })
  const sinBordes = { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } }
  /** Una celda que no puede quedar vacía (Word exige al menos un párrafo). */
  const cellKids = (kids: Child[]): Child[] => (kids.length ? kids : [new Paragraph('')])
  const caja = (kids: Child[], fill: string, borde: string): Table =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: [new TableCell({ children: cellKids(kids), shading: { type: ShadingType.CLEAR, fill, color: 'auto' }, borders: { ...sinBordes, left: { style: BorderStyle.SINGLE, size: 24, color: borde } }, margins: { top: 120, bottom: 120, left: 200, right: 200 } })] })]
    })
  const rejilla = (celdas: Child[][], cols: number, fills: string[]): Table => {
    const rows: TableRow[] = []
    for (let i = 0; i < celdas.length; i += cols) {
      const fila = celdas.slice(i, i + cols)
      while (fila.length < cols) fila.push([])
      rows.push(
        new TableRow({
          children: fila.map((c, k) => new TableCell({ children: cellKids(c), width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE }, shading: c.length ? { type: ShadingType.CLEAR, fill: fills[(i + k) % fills.length], color: 'auto' } : undefined, borders: cellBorders('FFFFFF'), margins: { top: 120, bottom: 120, left: 160, right: 160 } }))
        })
      )
    }
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
  }
  /** Parte los hijos de un bloque en grupos que empiezan en cada ### (tarjetas, pasos, panel). */
  /** Título de una tarjeta o paso: en negrita, sin el {icon=…}. */
  const porH3Titulo = (tok: Token, ctx: Ctx): ParagraphChild[] => {
    const kids = (tok.children ?? []).map((c) => (c.type === 'text' ? Object.assign(Object.create(Object.getPrototypeOf(c)), c, { content: c.content.replace(/\s*\{[^}]*\}\s*$/, '') }) : c))
    return runs({ ...tok, children: [Object.assign(Object.create(Object.getPrototypeOf(tok)), { type: 'strong_open' }), ...kids] } as Token, ctx)
  }
  const porH3 = (toks: Token[], ctx: Ctx): { titulo: ParagraphChild[]; tok: Token; cuerpo: Child[] }[] => {
    const grupos: { titulo: ParagraphChild[]; tok: Token; cuerpo: Child[] }[] = []
    let i = 0
    let pre: Token[] = []
    while (i < toks.length) {
      const t = toks[i]
      if (t.type === 'heading_open' && t.tag === 'h3') {
        grupos.push({ titulo: runs(toks[i + 1], { ...ctx }), tok: toks[i + 1], cuerpo: [] })
        i = closeOf(toks, i) + 1
        continue
      }
      const e = t.nesting === 1 ? closeOf(toks, i) : i
      const piezas = bloques(toks.slice(i, e + 1), ctx)
      if (grupos.length) grupos[grupos.length - 1].cuerpo.push(...piezas)
      else pre = pre.concat(toks.slice(i, e + 1))
      i = e + 1
    }
    void pre
    return grupos
  }

  function bloques(toks: Token[], ctx: Ctx = {}, lista: { tipo: 'bullet' | 'num'; inst: number }[] = []): Child[] {
    const out: Child[] = []
    let i = 0
    const pOpts = (extra: Partial<IParagraphOptions> = {}): Partial<IParagraphOptions> => ({ alignment: ctx.align, spacing: { after: 120 }, ...extra })
    while (i < toks.length) {
      const t = toks[i]
      switch (t.type) {
        case 'heading_open': {
          const n = Number(t.tag[1])
          const lv = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][Math.min(3, n - 1)]
          out.push(new Paragraph({ heading: lv, children: runs(toks[i + 1], { color: ctx.color }), keepNext: true }))
          i = closeOf(toks, i) + 1
          continue
        }
        case 'paragraph_open':
          out.push(new Paragraph({ ...pOpts(), children: runs(toks[i + 1], ctx) }))
          i = closeOf(toks, i) + 1
          continue
        case 'bullet_list_open':
        case 'ordered_list_open': {
          const e = closeOf(toks, i)
          const nueva = { tipo: t.type === 'bullet_list_open' ? ('bullet' as const) : ('num' as const), inst: ++numberingInstances.n }
          out.push(...bloques(toks.slice(i + 1, e), ctx, [...lista, nueva]))
          i = e + 1
          continue
        }
        case 'list_item_open': {
          const e = closeOf(toks, i)
          const l = lista[lista.length - 1]
          const nivel = Math.max(0, lista.length - 1)
          let k = i + 1
          if (toks[k]?.type === 'paragraph_open') {
            out.push(
              new Paragraph({
                ...pOpts({ spacing: { after: 60 } }),
                children: runs(toks[k + 1], ctx),
                ...(l?.tipo === 'num' ? { numbering: { reference: 'buho-num', level: nivel, instance: l.inst } } : { bullet: { level: nivel } })
              })
            )
            k = closeOf(toks, k) + 1
          }
          out.push(...bloques(toks.slice(k, e), ctx, lista))
          i = e + 1
          continue
        }
        case 'blockquote_open': {
          const e = closeOf(toks, i)
          out.push(caja(bloques(toks.slice(i + 1, e), { ...ctx, italic: true, color: P }), 'FFFFFF', A))
          i = e + 1
          continue
        }
        case 'table_open': {
          const e = closeOf(toks, i)
          const filas: { head: boolean; celdas: Token[] }[] = []
          for (let k = i; k < e; k++) {
            if (toks[k].type === 'tr_open') filas.push({ head: false, celdas: [] })
            if (toks[k].type === 'th_open' || toks[k].type === 'td_open') {
              filas[filas.length - 1].head = toks[k].type === 'th_open'
              filas[filas.length - 1].celdas.push(toks[k + 1])
            }
          }
          const cols = Math.max(...filas.map((f) => f.celdas.length))
          out.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: filas.map(
                (f, r) =>
                  new TableRow({
                    tableHeader: f.head,
                    children: f.celdas.map(
                      (c) =>
                        new TableCell({
                          width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
                          shading: f.head ? { type: ShadingType.CLEAR, fill: P, color: 'auto' } : r % 2 === 0 ? { type: ShadingType.CLEAR, fill: 'F6F9FB', color: 'auto' } : undefined,
                          borders: cellBorders(),
                          margins: { top: 80, bottom: 80, left: 120, right: 120 },
                          children: [new Paragraph({ children: runs(c, f.head ? { color: 'FFFFFF', size: 18 } : { size: 19 }).map((x) => (f.head && x instanceof TextRun ? x : x)) })]
                        })
                    )
                  })
              )
            }),
            new Paragraph({ text: '', spacing: { after: 80 } })
          )
          i = e + 1
          continue
        }
        case 'fence':
        case 'code_block':
          for (const l of t.content.replace(/\n$/, '').split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: l, font: 'Consolas', size: 18 })], shading: { type: ShadingType.CLEAR, fill: 'EEF1F5', color: 'auto' } }))
          break
        case 'hr':
          out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DFE5EC', space: 1 } } }))
          break
        case 'salto':
          out.push(new Paragraph({ children: [new PageBreak()] }))
          break
        case 'contenedor_open': {
          const e = closeOf(toks, i)
          const inner = toks.slice(i + 1, e)
          const a = (t.meta ?? { classes: [], kv: {} }) as ReturnType<typeof parseAttrs>
          const cls = a.classes ?? []
          const n = Number(cls.find((c) => /^is-\d$/.test(c))?.slice(3)) || 3
          switch (t.info) {
            case 'caja': {
              const navy = cls.includes('is-navy') || cls.includes('is-oscura')
              const aviso = cls.includes('is-aviso')
              const gris = cls.includes('is-gris')
              out.push(caja(bloques(inner, navy ? { ...ctx, color: 'FFFFFF' } : ctx), navy ? P : aviso ? 'FFF6E6' : gris ? 'F2F4F7' : cls.includes('is-blanca') ? 'FFFFFF' : S, aviso ? 'F0A020' : A), new Paragraph({ text: '', spacing: { after: 60 } }))
              break
            }
            case 'tarjetas': {
              const grupos = porH3(inner, ctx).map((gr) => [new Paragraph({ children: porH3Titulo(gr.tok, { color: P, size: 23 }), spacing: { after: 80 } }), ...gr.cuerpo])
              out.push(rejilla(grupos, Math.min(4, n), [S, 'EDF1F7']), new Paragraph({ text: '', spacing: { after: 60 } }))
              break
            }
            case 'cifras': {
              const celdas: Child[][] = []
              for (let k = 0; k < inner.length; k++) {
                if (inner[k].type !== 'list_item_open') continue
                const inl = inner.slice(k, closeOf(inner, k)).find((x) => x.type === 'inline')
                const kids = inl?.children ?? []
                const si = kids.findIndex((x) => x.type === 'strong_open')
                const num = si >= 0 ? kids[si + 1]?.content ?? '' : ''
                const resto = { ...inl!, children: si >= 0 ? kids.slice(si + 3) : kids } as Token
                celdas.push([new Paragraph({ children: [new TextRun({ text: num, bold: true, size: 44, color: P, font: serif })] }), new Paragraph({ children: runs(resto, { color: '5D6B7C' }) })])
              }
              out.push(rejilla(celdas, Math.min(4, n), ['FFFFFF']), new Paragraph({ text: '', spacing: { after: 60 } }))
              break
            }
            case 'pasos': {
              porH3(inner, ctx).forEach((gr, k) => {
                out.push(new Paragraph({ children: [new TextRun({ text: `${k + 1}  `, bold: true, color: A, size: 26, font: serif }), ...porH3Titulo(gr.tok, { color: P, size: 23 })], spacing: { before: 120, after: 40 }, keepNext: true }))
                for (const c of gr.cuerpo) out.push(c instanceof Paragraph ? c : c)
              })
              break
            }
            case 'panel': {
              const grupos = porH3(inner, { ...ctx, color: 'FFFFFF' })
              const kids: Child[] = []
              for (const gr of grupos) kids.push(new Paragraph({ children: porH3Titulo(gr.tok, { color: 'FFFFFF', size: 23 }), spacing: { before: 100, after: 40 } }), ...gr.cuerpo)
              out.push(caja(kids.length ? kids : bloques(inner, { ...ctx, color: 'FFFFFF' }), P, A), new Paragraph({ text: '', spacing: { after: 60 } }))
              break
            }
            case 'columnas': {
              const cols: Child[][] = []
              for (let k = 0; k < inner.length; k++) {
                if (inner[k].type === 'col_open') {
                  const ce = closeOf(inner, k)
                  cols.push(bloques(inner.slice(k + 1, ce), ctx))
                  k = ce
                }
              }
              const celdas = cols.length ? cols : [bloques(inner, ctx)]
              out.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [new TableRow({ children: celdas.map((c) => new TableCell({ children: cellKids(c), borders: sinBordes, width: { size: Math.floor(100 / celdas.length), type: WidthType.PERCENTAGE }, margins: { left: 80, right: 160 } })) })]
                })
              )
              break
            }
            case 'nota':
              out.push(...bloques(inner, { ...ctx, color: '7C8A9B', size: 16 }))
              break
            case 'cita':
              out.push(...bloques(inner, { ...ctx, italic: true, color: P, size: 28 }))
              break
            case 'centro':
              out.push(...bloques(inner, { ...ctx, align: AlignmentType.CENTER }))
              break
            case 'indice': {
              const hasta = Number(a.kv.niveles) || 3
              const entradas = titulos.filter((h) => h.level <= hasta)
              const min = Math.min(...entradas.map((h) => h.level), 9)
              out.push(new Paragraph({ children: [new TextRun({ text: 'Índice', bold: true, color: P, size: 31, font: serif })], spacing: { after: 200 } }))
              out.push(new TableOfContents('Índice', { hyperlink: true, headingStyleRange: `1-${hasta}`, cachedEntries: entradas.map((h) => ({ title: h.title, level: h.level - min + 1 })) }) as unknown as Paragraph, new Paragraph({ children: [new PageBreak()] }))
              break
            }
            case 'grafico': {
              const gd = (t.meta as { grafico?: DatosGrafico }).grafico
              if (gd) out.push(new Paragraph({ children: [graficoWord(gd, deck ? 820 : 600)], spacing: { before: 120, after: 160 }, keepLines: true }))
              out.push(...bloques(inner, { ...ctx, color: '5D6B7C', size: 18 }))
              break
            }
            case 'hueco':
              out.push(new Paragraph({ children: [new TextRun({ text: `[Pendiente: ${a.kv.texto ?? a.kv.id ?? ''}]`, italics: true, color: '888888' })] }))
              break
            default:
              out.push(...bloques(inner, ctx))
          }
          i = e + 1
          continue
        }
        default:
          break
      }
      i++
    }
    return out
  }

  /** ¿El título en k está dentro del bloque que abre x (tarjetas, pasos…)? Esos no van al índice. */
  function closeAfter(toks: Token[], x: Token, k: number): boolean {
    const i = toks.indexOf(x)
    let depth = 0
    for (let j = i; j < toks.length; j++) {
      depth += toks[j].nesting
      if (depth === 0) return j > k
    }
    return true
  }
  // ─── Portada, cabecera, pie ─────────────────────────────────────────────────────────────────
  const titulo = g('titulo', 'título', 'title') ?? ''
  const conPortada = !deck && g('portada', 'cover') !== 'false' && (tema.base === 'buho' ? tema.portada !== 'ninguna' : (tema.portada && tema.portada !== 'ninguna') || /^(true|s[ií])$/i.test(g('portada') ?? ''))
  const logo = tema.logo ?? (tema.id === 'buho' ? wordmarkPath : undefined)
  const portada: Child[] = conPortada
    ? [
        ...(logo ? [new Paragraph({ children: [imagen(logo, '', 170)], spacing: { after: 1600 } })] : [new Paragraph({ text: '', spacing: { after: 2400 } })]),
        ...(g('etiqueta', 'kicker') ? [new Paragraph({ children: [new TextRun({ text: g('etiqueta', 'kicker')!, bold: true, color: A, size: 18 })], spacing: { after: 240 } })] : []),
        new Paragraph({ children: [new TextRun({ text: titulo || 'Sin título', bold: true, color: P, size: 64, font: serif })], spacing: { after: 360 } }),
        ...(g('subtitulo', 'subtítulo', 'subtitle') ? [new Paragraph({ children: [new TextRun({ text: g('subtitulo', 'subtítulo', 'subtitle')!, size: 26 })], spacing: { after: 600 } })] : []),
        ...(g('destinatario', 'para', 'cliente') ? [new Paragraph({ children: [new TextRun({ text: g('destinatario', 'para', 'cliente')!, bold: true, color: A, size: 18 })] })] : []),
        new Paragraph({ children: [new TextRun({ text: [g('fecha', 'date'), g('autor', 'author'), g('lugar', 'place')].filter(Boolean).join(' · '), color: '7C8A9B', size: 18 })] })
      ]
    : []

  // Cuerpo: en presentaciones, una diapositiva por página (apaisado).
  let cuerpo: Child[] = []
  if (deck) {
    splitSlides(source).forEach((s, k) => {
      if (k) cuerpo.push(new Paragraph({ children: [new PageBreak()] }))
      if (s.directives.etiqueta) cuerpo.push(new Paragraph({ children: [new TextRun({ text: s.directives.etiqueta, bold: true, color: A, size: 18 })] }))
      cuerpo.push(...bloques(md.parse(s.content.replace(/^\+{3,}\s*$/gm, ''), {}) as Token[]))
    })
  } else {
    const toks = md.parse(f.body, {}) as Token[]
    recoger(toks.filter((t, k) => !(t.type === 'heading_open' && toks.slice(0, k).some((x) => x.type === 'contenedor_open' && x.info !== 'columnas' && closeAfter(toks, x, k)))))
    cuerpo = bloques(toks)
  }

  const cab = g('cabecera', 'header') ?? [titulo, g('fecha', 'date')].filter(Boolean).join('  |  ')
  const pie = g('pie', 'footer') ?? tema.pie ?? (tema.id === 'buho' ? 'Búho AI · Tu equipo técnico de IA · buhoai.es' : '')
  const marca = tema.marca ?? (tema.base === 'buho' ? 'BÚHO AI' : '')
  const ancho = deck ? 16838 - 2000 : 11906 - 2040 // twips del área de texto (A4 apaisado / vertical, sin márgenes)
  const header = new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: ancho }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DFE5EC', space: 4 } },
        children: [
          new TextRun({ text: marca, bold: true, color: P, size: 18, font: serif }),
          new TextRun({ text: `\t${cab}`, color: A, size: 15 })
        ]
      })
    ]
  })
  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: ancho }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'DFE5EC', space: 4 } },
        children: [
          new TextRun({ text: pie, color: '7C8A9B', size: 15 }),
          new TextRun({ children: ['\t', ...(g('pie-derecha', 'footer-right') ? [g('pie-derecha', 'footer-right')! + '  ·  '] : []), PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], color: '7C8A9B', size: 15 })
        ]
      }),
      ...(g('nota-pie', 'aviso-pie', 'disclaimer') ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: g('nota-pie', 'aviso-pie', 'disclaimer')!, color: '8D99A8', size: 14 })] })] : [])
    ]
  })
  const page = deck
    ? { size: { orientation: PageOrientation.LANDSCAPE, width: 16838, height: 11906 }, margin: { top: 1000, bottom: 900, left: 1000, right: 1000 } }
    : { margin: { top: 1360, bottom: 1250, left: 1020, right: 1020 } }

  const doc = new Document({
    creator: g('autor', 'author') ?? 'Búho Docs',
    title: titulo,
    description: `Exportado de ${docPath} con Búho Docs`,
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: sans, size: 21, color: T }, paragraph: { spacing: { line: 300 } } },
        heading1: { run: { font: serif, size: 40, bold: true, color: P }, paragraph: { spacing: { before: 240, after: 160 } } },
        heading2: { run: { font: serif, size: 31, bold: true, color: P }, paragraph: { spacing: { before: 360, after: 120 } } },
        heading3: { run: { font: sans, size: 24, bold: true, color: P }, paragraph: { spacing: { before: 200, after: 80 } } },
        heading4: { run: { font: sans, size: 22, bold: true, color: P } }
      }
    },
    numbering: {
      config: [
        {
          reference: 'buho-num',
          levels: [0, 1, 2, 3].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } }, run: { color: A, bold: true } } }))
        }
      ]
    },
    sections: [
      ...(portada.length ? [{ properties: { page }, children: portada }] : []),
      { properties: { page }, headers: { default: header }, footers: { default: footer }, children: cuerpo.length ? cuerpo : [new Paragraph('')] }
    ]
  })
  return { buffer: await Packer.toBuffer(doc) }
}

/** Gráfico nativo de Word (editable, con sus datos): mismos colores y orden que en el PDF. */
function graficoWord(g: DatosGrafico, ancho: number): ChartRun {
  const col = PALETA.map((c) => c.replace('#', ''))
  const fmt = g.unidad === '%' ? '0" %"' : g.unidad === '€' ? '#,##0" €"' : g.unidad ? `#,##0.##" ${g.unidad}"` : '#,##0.##'
  const base = { title: g.titulo, legend: g.series.length > 1 ? { position: 'bottom' as const } : (false as const), font: { name: 'Calibri' }, transformation: { width: ancho, height: Math.round(ancho * 0.52) } }
  const cat = { categories: g.categorias, series: g.series.map((s, k) => ({ name: s.nombre, values: s.valores, color: col[k] })), dataLabels: g.categorias.length * g.series.length <= 14 ? { value: true, numberFormat: fmt } : undefined }
  const opts: ChartRunOptions =
    g.tipo === 'tarta' || g.tipo === 'donut'
      ? { ...base, type: g.tipo === 'tarta' ? 'pie' : 'doughnut', legend: { position: 'right' }, categories: g.categorias, series: [{ name: g.series[0].nombre, values: g.series[0].valores.map((v) => (v === null ? null : Math.max(0, v))), colors: g.categorias.map((_, k) => col[k % col.length]) }], dataLabels: { percentage: true } }
      : g.tipo === 'barras'
        ? { ...base, ...cat, type: 'bar', gapWidth: 80 }
        : g.tipo === 'lineas'
          ? { ...base, ...cat, type: 'line', markers: true }
          : g.tipo === 'area'
            ? { ...base, ...cat, type: 'area' }
            : { ...base, ...cat, type: 'column', gapWidth: 80 }
  return new ChartRun(opts)
}
