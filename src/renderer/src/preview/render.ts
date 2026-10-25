import MarkdownIt from 'markdown-it'
import { kindOf, metaGet, splitFront, splitSlides, type Slide } from '@shared/doc'
import type { DocKind, RenderWarning } from '@shared/types'
import { CONTAINERS, LAYOUTS, LAYOUT_ALIAS } from '@shared/syntax'
import { iconSvg } from './icons'
import buho from '../brand/buho.png'
import wordmark from '../brand/wordmark.png'
import arbol from '../brand/arbol.webp'
import marcaAgua from '../brand/marca-agua.png'

/**
 * Markdown → HTML con el estilo Búho. Lo usan la vista previa de la app y la exportación a PDF
 * (que es la misma página impresa por Chromium): lo que ves es lo que sale.
 *
 * Extensiones sobre Markdown (CommonMark + tablas):
 *   ::: caja [navy|gris|aviso] [icon=escudo]   … :::   caja destacada
 *   ::: tarjetas [2|3|4]   ### Título {icon=reloj} …   tarjetas con icono (cada ### abre una)
 *   ::: cifras   - **40 %** menos tiempo …        cifras grandes
 *   ::: columnas   … +++ …   :::                   columnas (+++ separa)
 *   ::: pasos   ### Paso …                         pasos numerados
 *   ::: panel   ### …                              panel navy con apartados
 *   ::: nota | cita | centro                       texto pequeño, cita grande, centrado
 *   ## Título {icon=cohete .clase}                 atributos al final de títulos y párrafos
 *   \pagebreak                                      salto de página (documentos)
 * Cada bloque lleva data-line con su línea en el archivo: clic en la vista → línea en el editor.
 */

export interface Built {
  kind: DocKind
  meta: Record<string, unknown>
  html: string
  /** CSS que depende del documento (cabecera y pie de página). */
  pageCss: string
  title: string
  warnings: RenderWarning[]
}

interface Env {
  lineOffset: number
  baseDir: string
  warnings: RenderWarning[]
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cssStr = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`

/** Ruta local → URL que sirve la app (protocolo buho://). Las URL web y data: se dejan igual. */
export function fileUrl(src: string, baseDir: string): string {
  if (/^(https?:|data:|blob:|buho:)/i.test(src)) return src
  if (/^brand:/i.test(src)) {
    const k = src.slice(6).toLowerCase()
    return ({ arbol, buho, logo: buho, wordmark, 'marca-agua': marcaAgua } as Record<string, string>)[k] ?? src
  }
  let p = src.replace(/^file:\/\/\/?/i, '')
  try {
    p = decodeURI(p)
  } catch {
    /* ya decodificada */
  }
  const abs = /^[a-z]:[\\/]/i.test(p) || p.startsWith('\\\\') || p.startsWith('/') ? p : `${baseDir.replace(/[\\/]+$/, '')}/${p}`
  return `buho://file/${encodeURIComponent(abs.replace(/\\/g, '/'))}`
}

// ─── Atributos {…} ──────────────────────────────────────────────────────────────────────────────

function parseAttrs(s: string): { classes: string[]; id?: string; kv: Record<string, string> } {
  const out = { classes: [] as string[], id: undefined as string | undefined, kv: {} as Record<string, string> }
  for (const m of s.matchAll(/([.#])([\w-]+)|([\w-]+)=(?:"([^"]*)"|'([^']*)'|(\S+))|(\S+)/g)) {
    if (m[1] === '.') out.classes.push(m[2])
    else if (m[1] === '#') out.id = m[2]
    else if (m[3]) out.kv[m[3].toLowerCase()] = m[4] ?? m[5] ?? m[6] ?? ''
    else if (m[7]) out.classes.push(`is-${m[7].toLowerCase()}`)
  }
  return out
}

// ─── markdown-it ───────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeMd(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false })
  // Comillas españolas con el modo tipográfico.
  md.set({ quotes: '«»“”' })

  // \pagebreak → salto de página.
  md.block.ruler.before('paragraph', 'salto', (state: any, start: number, _end: number, silent: boolean) => {
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim()
    if (!/^\\(pagebreak|newpage|salto)$/.test(line)) return false
    if (silent) return true
    const t = state.push('salto', 'div', 0)
    t.map = [start, start + 1]
    t.block = true
    state.line = start + 1
    return true
  })
  md.renderer.rules.salto = (tokens: any[], i: number) => `<div class="salto"${tokens[i].attrGet('data-line') ? ` data-line="${tokens[i].attrGet('data-line')}"` : ''}></div>\n`

  // ::: nombre args … ::: (anidables; +++ separa columnas en el primer nivel)
  md.block.ruler.before('fence', 'contenedor', (state: any, start: number, end: number, silent: boolean) => {
    const text = (l: number): string => state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l])
    if (state.sCount[start] - state.blkIndent >= 4) return false
    const m = text(start).match(/^(:{3,})\s*([\p{L}\w-]+)\s*(.*)$/u)
    if (!m) return false
    if (silent) return true
    let depth = 1
    let next = start
    const seps: number[] = []
    while (++next < end) {
      const l = text(next).trim()
      if (/^:{3,}$/.test(l)) {
        if (--depth === 0) break
      } else if (/^:{3,}\s*[\p{L}\w-]/u.test(l)) depth++
      else if (depth === 1 && /^\+{3,}$/.test(l)) seps.push(next)
    }
    const name = m[2].toLowerCase()
    const a = parseAttrs(m[3])
    const open = state.push('contenedor_open', 'div', 1)
    open.block = true
    open.map = [start, next]
    open.info = name
    open.meta = a
    const ranges: [number, number][] = []
    let from = start + 1
    for (const s of seps) {
      ranges.push([from, s])
      from = s + 1
    }
    ranges.push([from, Math.min(next, end)])
    const oldParent = state.parentType
    const oldMax = state.lineMax
    state.parentType = 'container'
    for (const [s, e] of ranges) {
      if (ranges.length > 1) {
        const c = state.push('col_open', 'div', 1)
        c.attrSet('class', 'col')
      }
      state.lineMax = e
      state.md.block.tokenize(state, s, e)
      if (ranges.length > 1) state.push('col_close', 'div', -1)
    }
    state.parentType = oldParent
    state.lineMax = oldMax
    const close = state.push('contenedor_close', 'div', -1)
    close.block = true
    state.line = Math.min(next + 1, end)
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  md.renderer.rules.contenedor_open = (tokens: any[], i: number, _o: any, env: Env) => {
    const t = tokens[i]
    const a = t.meta as ReturnType<typeof parseAttrs>
    if (!(CONTAINERS as readonly string[]).includes(t.info)) env.warnings.push({ line: t.map[0] + 1 + env.lineOffset, level: 'aviso', message: `Bloque desconocido «::: ${t.info}» (hay: ${CONTAINERS.join(', ')})` })
    const cls = [`bx`, `bx-${t.info}`, ...a.classes, ...(tokens[i + 1]?.type === 'col_open' ? ['has-cols'] : [])]
    const icon = a.kv.icon ? iconFor(a.kv.icon, env, t.map[0] + 1) : ''
    const style = a.kv.cols || a.kv.columnas ? ` style="--cols:${Number(a.kv.cols || a.kv.columnas) || 2}"` : ''
    return `<div class="${cls.join(' ')}" data-line="${t.attrGet('data-line') ?? ''}"${a.id ? ` id="${a.id}"` : ''}${style}>${icon ? `<span class="ic bx-ic">${icon}</span>` : ''}<div class="bx-body">\n`
  }
  md.renderer.rules.contenedor_close = () => '</div></div>\n'

  // {…} al final de títulos y párrafos → clases, id, icono, ancho de imagen.
  md.core.ruler.push('atributos', (state: any) => {
    const toks = state.tokens
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i]
      const open = toks[i - 1]
      if (t.type !== 'inline' || !/^(heading|paragraph)_open$/.test(open.type)) continue
      const last = t.children?.[t.children.length - 1]
      const m = last?.type === 'text' && last.content.match(/\s*\{([^{}]*)\}\s*$/)
      if (!m) continue
      last.content = last.content.slice(0, m.index)
      t.content = t.content.replace(/\s*\{[^{}]*\}\s*$/, '')
      const a = parseAttrs(m[1])
      if (a.classes.length) open.attrJoin('class', a.classes.join(' '))
      if (a.id) open.attrSet('id', a.id)
      if (a.kv.icon) open.meta = { ...(open.meta ?? {}), icon: a.kv.icon }
      const w = a.kv.width ?? a.kv.ancho
      if (w) open.attrSet('style', `--img-w:${/^\d+$/.test(w) ? w + '%' : w}`)
    }
  })

  // data-line en cada bloque (línea del archivo, 1 = primera).
  md.core.ruler.push('lineas', (state: any) => {
    const off = (state.env as Env).lineOffset ?? 0
    for (const t of state.tokens) if (t.block && t.map && t.nesting !== -1) t.attrSet('data-line', String(t.map[0] + 1 + off))
  })

  md.renderer.rules.heading_open = (tokens: any[], i: number, opts: any, env: Env, self: any) => {
    const t = tokens[i]
    const icon = t.meta?.icon ? iconFor(t.meta.icon, env, Number(t.attrGet('data-line'))) : ''
    return self.renderToken(tokens, i, opts) + (icon ? `<span class="ic">${icon}</span><span class="ht">` : '')
  }
  md.renderer.rules.heading_close = (tokens: any[], i: number, opts: any, _env: Env, self: any) =>
    (tokens[i - 2]?.meta?.icon ? '</span>' : '') + self.renderToken(tokens, i, opts)

  const defaultImage = md.renderer.rules.image!
  md.renderer.rules.image = (tokens: any[], i: number, opts: any, env: Env, self: any) => {
    const t = tokens[i]
    t.attrSet('src', fileUrl(t.attrGet('src') ?? '', env.baseDir))
    return defaultImage(tokens, i, opts, env, self)
  }

  // Enlaces externos: se abren en el navegador (la app los intercepta).
  const defaultLink = md.renderer.rules.link_open ?? ((tokens: any[], i: number, o: any, _e: any, self: any) => self.renderToken(tokens, i, o))
  md.renderer.rules.link_open = (tokens: any[], i: number, o: any, e: any, self: any) => {
    tokens[i].attrSet('target', '_blank')
    return defaultLink(tokens, i, o, e, self)
  }
  return md
}

function iconFor(name: string, env: Env, line: number): string {
  const svg = iconSvg(name)
  if (!svg) env.warnings.push({ line, level: 'aviso', message: `Icono desconocido «${name}» (usa un nombre de lucide.dev/icons o un alias: cohete, escudo, reloj, equipo…)` })
  return svg ?? ''
}

const md = makeMd()

function renderMd(src: string, env: Env): string {
  return md.render(src, env)
}

// ─── Documento A4 ──────────────────────────────────────────────────────────────────────────────

function buildDoc(src: string, baseDir: string): Built {
  const f = splitFront(src)
  const meta = f.meta
  const warnings: RenderWarning[] = f.error ? [{ line: 1, level: 'error', message: f.error }] : []
  const g = (...k: string[]): string | undefined => metaGet(meta, ...k)
  const title = g('titulo', 'título', 'title') ?? ''
  const fecha = g('fecha', 'date') ?? ''
  const cover = (g('portada', 'cover') ?? 'true') !== 'false'
  let html = ''
  if (cover) {
    const datos = [fecha, g('autor', 'author') ?? 'Búho AI', g('lugar', 'place')].filter(Boolean).join(' · ')
    html += `<section class="portada" data-line="1">
  <div class="p-logo"><img src="${wordmark}" alt="Búho AI"><div class="lema">${escHtml(g('lema') ?? 'Tu equipo técnico de IA')}</div></div>
  <div class="p-centro">
    ${g('etiqueta', 'kicker') ? `<div class="etiqueta">${escHtml(g('etiqueta', 'kicker')!)}</div>` : ''}
    <h1 class="p-titulo">${md.renderInline(title || 'Sin título')}</h1>
    ${g('subtitulo', 'subtítulo', 'subtitle') ? `<p class="p-sub">${md.renderInline(g('subtitulo', 'subtítulo', 'subtitle')!)}</p>` : ''}
    ${g('destinatario', 'para', 'audience', 'cliente', 'client') ? `<div class="p-para">${escHtml(g('destinatario', 'para', 'audience', 'cliente', 'client')!)}</div>` : ''}
    ${datos ? `<div class="p-datos">${escHtml(datos)}</div>` : ''}
  </div>
  <img class="p-arbol" src="${arbol}" alt="">
  <div class="p-web">Búho AI · buhoai.es</div>
  <div class="p-barra"></div>
</section>\n`
  }
  html += `<article class="cuerpo">${renderMd(f.body, { lineOffset: f.bodyStart, baseDir, warnings })}</article>`
  const cab = g('cabecera', 'header') ?? [title, fecha].filter(Boolean).join('  |  ')
  const pie = g('pie', 'footer') ?? 'Búho AI · Tu equipo técnico de IA · buhoai.es'
  const pieDer = g('pie-derecha', 'footer-right')
  const nota = g('nota-pie', 'aviso-pie', 'disclaimer')
  // Pie como en los PDF de Búho: izquierda y derecha en una línea; la nota legal, centrada debajo.
  const pageCss = `
@page {
  @top-left { content: "BÚHO AI"; }
  @top-right { content: ${cssStr(cab)}; }
  @bottom-left { content: ${cssStr(pie)}; }
  @bottom-right { content: ${pieDer ? cssStr(pieDer) + ' "   ·   " ' : ''}counter(page) " / " counter(pages); }
}
@page portada { @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
.pagedjs_margin-top-left .pagedjs_margin-content { background-image: url("${buho}"); }
${nota ? `.pagedjs_page:not(.pagedjs_portada_page) .pagedjs_margin-bottom::after { content: ${cssStr(nota)}; }` : ''}
`
  return { kind: 'documento', meta, html, pageCss, title, warnings }
}

// ─── Presentación 16:9 ─────────────────────────────────────────────────────────────────────────

/** Separa el título (y lo que va antes) del resto y parte el resto en columnas por +++ de primer nivel. */
function slideParts(s: Slide): { head: string; headLine: number; cols: { text: string; line: number }[] } {
  const ls = s.content.split(/\r?\n/)
  let i = 0
  while (i < ls.length && ls[i].trim() === '') i++
  let headEnd = i
  if (i < ls.length && /^#{1,2}\s/.test(ls[i])) headEnd = i + 1
  const head = ls.slice(i, headEnd).join('\n')
  const cols: { text: string; line: number }[] = []
  let depth = 0
  let from = headEnd
  for (let k = headEnd; k < ls.length; k++) {
    const l = ls[k].trim()
    if (/^:{3,}$/.test(l)) depth = Math.max(0, depth - 1)
    else if (/^:{3,}\s*\S/.test(l)) depth++
    else if (depth === 0 && /^\+{3,}$/.test(l)) {
      cols.push({ text: ls.slice(from, k).join('\n'), line: s.contentStart + from })
      from = k + 1
    }
  }
  cols.push({ text: ls.slice(from).join('\n'), line: s.contentStart + from })
  return { head, headLine: s.contentStart + i, cols }
}

function buildSlides(src: string, baseDir: string): Built {
  const f = splitFront(src)
  const meta = f.meta
  const warnings: RenderWarning[] = f.error ? [{ line: 1, level: 'error', message: f.error }] : []
  const g = (...k: string[]): string | undefined => metaGet(meta, ...k)
  const title = g('titulo', 'título', 'title') ?? ''
  const pie = g('pie', 'footer') ?? (title ? `Búho AI · ${title}` : 'Búho AI')
  const slides = splitSlides(src)
  const total = slides.length
  const out = slides.map((s) => {
    const env: Env = { lineOffset: 0, baseDir, warnings }
    let layout = (s.directives['diseño'] ?? (s.n === 1 ? 'portada' : 'normal')).toLowerCase()
    layout = LAYOUT_ALIAS[layout] ?? layout
    if (!(LAYOUTS as readonly string[]).includes(layout)) {
      warnings.push({ line: s.start + 1, slide: s.n, level: 'aviso', message: `Diseño desconocido «${layout}» (hay: ${LAYOUTS.join(', ')})` })
      layout = 'normal'
    }
    const fondo = (s.directives.fondo ?? '').toLowerCase()
    const dark = layout === 'seccion' || layout === 'cierre' || fondo === 'navy' || fondo === 'oscuro'
    const p = slideParts(s)
    const etiqueta = s.directives.etiqueta ? `<div class="etiqueta">${escHtml(s.directives.etiqueta)}</div>` : ''
    const head = p.head ? md.render(p.head, { ...env, lineOffset: p.headLine }) : ''
    const nonEmpty = p.cols.filter((c) => c.text.trim())
    const cols = nonEmpty.map((c) => `<div class="col" data-line="${c.line + 1}">${md.render(c.text, { ...env, lineOffset: c.line })}</div>`).join('')
    const body = nonEmpty.length > 1 ? `<div class="cols n${nonEmpty.length}">${cols}</div>` : nonEmpty.length ? md.render(nonEmpty[0].text, { ...env, lineOffset: nonEmpty[0].line }) : ''
    const img = s.directives.imagen ? `<img class="s-imagen" src="${fileUrl(s.directives.imagen, baseDir)}" alt="">` : ''
    const chrome =
      layout === 'portada'
        ? `<img class="s-arbol" src="${arbol}" alt=""><div class="s-logo"><img src="${wordmark}" alt="Búho AI"><div class="lema">${escHtml(g('lema') ?? 'Tu equipo técnico de IA')}</div></div><div class="s-web">Búho AI · buhoai.es</div><div class="s-barra-baja"></div>`
        : `<footer class="s-pie"><img src="${buho}" alt=""><span>${escHtml(pie)}</span><span class="s-num">${s.n} / ${total}</span></footer><img class="s-marca" src="${marcaAgua}" alt="">`
    return `<section class="slide d-${layout}${dark ? ' oscuro' : ''}${fondo && !dark ? ` f-${fondo}` : ''}${/^(arriba|top)$/i.test(s.directives.alinear ?? '') ? ' f-arriba' : ''}" data-slide="${s.n}" data-line="${s.start + 1}">
<div class="s-barra"></div>${chrome}
<div class="s-cuerpo">${etiqueta}<div class="s-head">${head}</div><div class="s-main">${img}${body}</div></div>
${s.directives.notas ? `<aside class="s-notas">${escHtml(s.directives.notas)}</aside>` : ''}</section>`
  })
  return { kind: 'presentacion', meta, html: out.join('\n'), pageCss: '', title, warnings }
}

export function build(src: string, baseDir: string): Built {
  return kindOf(splitFront(src).meta) === 'presentacion' ? buildSlides(src, baseDir) : buildDoc(src, baseDir)
}
