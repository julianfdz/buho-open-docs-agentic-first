import type MarkdownIt from 'markdown-it'
import { newBuhoMd, parseAttrs } from '@shared/mdcore'
import { svgGrafico } from '@shared/grafico'
import { kindOf, metaGet, splitFront, splitSlides, type Slide } from '@shared/doc'
import type { DocKind, RenderWarning } from '@shared/types'
import { CONTAINERS, LAYOUTS, LAYOUT_ALIAS } from '@shared/syntax'
import { TEMAS_BASE, temaDe, type Tema } from '@shared/temas'
import { iconSvg } from './icons'
import type { PageChrome } from './paginate'
import buho from '../brand/buho.png'
import wordmark from '../brand/wordmark.png'
import arbol from '../brand/arbol.webp'
// Árbol ya en gris y aclarado sobre blanco: sin filtros CSS, el PDF se imprime antes y pesa menos.
import arbolDoc from '../brand/arbol-doc.jpg'
import arbolDeck from '../brand/arbol-deck.jpg'
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
  /** Cabecera y pie de las páginas A4. */
  chrome?: PageChrome
  /** Estructura del tema: buho (marca, portada con imagen) o blanco (limpio). */
  theme: 'buho' | 'blanco'
  /** Tema completo (colores, letras, logo…). */
  tema: Tema
  /** Hoja de estilo propia del documento (cabecera css: archivo.css). */
  css?: string
  title: string
  warnings: RenderWarning[]
}

interface Env {
  lineOffset: number
  baseDir: string
  warnings: RenderWarning[]
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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

// ─── markdown-it ───────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
/** ¿El token i está dentro de una columna (+++)? Entonces el gráfico se dibuja estrecho. */
function enColumna(tokens: any[], i: number): boolean {
  let depth = 0
  for (let k = i - 1; k >= 0; k--) {
    if (tokens[k].type === 'col_close') depth++
    else if (tokens[k].type === 'col_open') {
      if (depth === 0) return true
      depth--
    }
  }
  return false
}

function makeMd(): MarkdownIt {
  // Lectura (bloques ::: , \pagebreak, atributos {…}, líneas) compartida con la exportación a Word.
  const md = newBuhoMd()

  md.renderer.rules.salto = (tokens: any[], i: number) => `<div class="salto"${tokens[i].attrGet('data-line') ? ` data-line="${tokens[i].attrGet('data-line')}"` : ''}></div>\n`

  md.renderer.rules.contenedor_open = (tokens: any[], i: number, _o: any, env: Env) => {
    const t = tokens[i]
    const a = t.meta as ReturnType<typeof parseAttrs>
    if (t.info === 'hueco') {
      const id = a.kv.id ?? a.id ?? ''
      const texto = a.kv.texto ?? a.kv.text ?? 'Contenido en preparación'
      return `<div class="bx bx-hueco" data-line="${t.attrGet('data-line') ?? ''}" data-end="${t.attrGet('data-end') ?? ''}" data-hueco="${escHtml(id)}"><div class="hueco-spin"></div><div><b>${escHtml(texto)}</b><span>Generándose… se rellenará solo (${escHtml(id || 'sin id')})</span></div><div class="bx-body">\n`
    }
    if (t.info === 'grafico') {
      const g = (t.meta as { grafico?: import('@shared/grafico').DatosGrafico }).grafico
      if (!g) env.warnings.push({ line: t.map[0] + 1 + env.lineOffset, level: 'aviso', message: 'Gráfico sin datos: dentro va una tabla (primera columna = categorías, las demás = números)' })
      return `<figure class="bx bx-grafico" data-line="${t.attrGet('data-line') ?? ''}" data-end="${t.attrGet('data-end') ?? ''}">${g ? svgGrafico(g, enColumna(tokens, i) ? 380 : 640) : ''}<div class="bx-body">\n`
    }
    if (t.info === 'indice') {
      const niveles = Number(a.kv.niveles ?? a.classes.find((c) => /^is-\d$/.test(c))?.slice(3)) || 2
      return `<div class="bx bx-indice" data-line="${t.attrGet('data-line') ?? ''}" data-end="${t.attrGet('data-end') ?? ''}" data-niveles="${niveles}" data-titulo="${escHtml(a.kv.titulo ?? 'Índice')}"><div class="bx-body">\n`
    }
    if (!(CONTAINERS as readonly string[]).includes(t.info)) env.warnings.push({ line: t.map[0] + 1 + env.lineOffset, level: 'aviso', message: `Bloque desconocido «::: ${t.info}» (hay: ${CONTAINERS.join(', ')})` })
    const cls = [`bx`, `bx-${t.info}`, ...a.classes, ...(tokens[i + 1]?.type === 'col_open' ? ['has-cols'] : [])]
    const icon = a.kv.icon ? iconFor(a.kv.icon, env, t.map[0] + 1) : ''
    const style = a.kv.cols || a.kv.columnas ? ` style="--cols:${Number(a.kv.cols || a.kv.columnas) || 2}"` : ''
    return `<div class="${cls.join(' ')}" data-line="${t.attrGet('data-line') ?? ''}"${a.id ? ` id="${a.id}"` : ''}${style}>${icon ? `<span class="ic bx-ic">${icon}</span>` : ''}<div class="bx-body">\n`
  }
  md.renderer.rules.contenedor_close = (tokens: any[], i: number) => {
    // El cierre del gráfico es </figure>: se busca su apertura.
    let depth = 0
    for (let k = i; k >= 0; k--) {
      depth += tokens[k].nesting
      if (depth === 0) return tokens[k].info === 'grafico' ? '</div></figure>\n' : '</div></div>\n'
    }
    return '</div></div>\n'
  }

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
    // La ruta original queda en data-src: la edición visual la devuelve tal cual al Markdown.
    t.attrSet('data-src', t.attrGet('src') ?? '')
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

/** El tema del documento: el que se pasa (temas del usuario, ya resueltos) o uno de serie. */
function temaFinal(meta: Record<string, unknown>, tema?: Tema): Tema {
  if (tema) return tema
  const id = temaDe(meta)
  return TEMAS_BASE.find((t) => t.id === id) ?? TEMAS_BASE[0]
}

const cssOf = (meta: Record<string, unknown>, baseDir: string): string | undefined => {
  const c = metaGet(meta, 'css', 'hoja-de-estilo')
  return c ? fileUrl(c, baseDir) : undefined
}

/** Campos de la portada editables en la vista (van a la cabecera YAML). */
const metaAttr = (k: string): string => ` data-meta="${k}"`

function buildDoc(src: string, baseDir: string, temaIn?: Tema): Built {
  const f = splitFront(src)
  const meta = f.meta
  const warnings: RenderWarning[] = f.error ? [{ line: 1, level: 'error', message: f.error }] : []
  const g = (...k: string[]): string | undefined => metaGet(meta, ...k)
  const tema = temaFinal(meta, temaIn)
  const buhoBase = tema.base === 'buho'
  const title = g('titulo', 'título', 'title') ?? ''
  const fecha = g('fecha', 'date') ?? ''
  const pidePortada = g('portada', 'cover')
  // Portada: «portada: false» la quita; en temas limpios solo sale si el tema la trae o se pide.
  const estiloPortada: 'arbol' | 'simple' | 'ninguna' =
    pidePortada === 'false' ? 'ninguna' : buhoBase ? (tema.portada ?? 'arbol') : /^(true|s[ií])$/i.test(pidePortada ?? '') ? (tema.portada === 'ninguna' || !tema.portada ? 'simple' : tema.portada) : (tema.portada ?? 'ninguna')
  const logo = tema.logo ?? (buhoBase ? wordmark : '')
  const kicker = g('etiqueta', 'kicker') ? `<div class="etiqueta">${escHtml(g('etiqueta', 'kicker')!)}</div>` : ''
  const sub = g('subtitulo', 'subtítulo', 'subtitle') ? `<p class="p-sub"${metaAttr('subtitulo')}>${md.renderInline(g('subtitulo', 'subtítulo', 'subtitle')!)}</p>` : ''
  const para = g('destinatario', 'para', 'audience', 'cliente', 'client') ? `<div class="p-para">${escHtml(g('destinatario', 'para', 'audience', 'cliente', 'client')!)}</div>` : ''
  let html = ''
  if (estiloPortada === 'simple') {
    const datos = [fecha, g('autor', 'author'), g('lugar', 'place')].filter(Boolean).join(' · ')
    html += `<section class="portada portada-simple" data-line="1">
  ${logo ? `<div class="p-logo"><img src="${logo}" alt=""></div>` : ''}
  <div class="p-centro">
    ${kicker}
    <h1 class="p-titulo"${metaAttr('titulo')}>${md.renderInline(title || 'Sin título')}</h1>
    ${sub}${para}
    ${datos ? `<div class="p-datos">${escHtml(datos)}</div>` : ''}
  </div>
  <div class="p-banda"></div>
</section>\n`
  } else if (estiloPortada === 'arbol') {
    const datos = [fecha, g('autor', 'author') ?? 'Búho AI', g('lugar', 'place')].filter(Boolean).join(' · ')
    html += `<section class="portada" data-line="1">
  <div class="p-logo">${logo ? `<img src="${logo}" alt="">` : ''}<div class="lema">${escHtml(g('lema') ?? (tema.id === 'buho' ? 'Tu equipo técnico de IA' : ''))}</div></div>
  <div class="p-centro">
    ${kicker}
    <h1 class="p-titulo"${metaAttr('titulo')}>${md.renderInline(title || 'Sin título')}</h1>
    ${sub}${para}
    ${datos ? `<div class="p-datos">${escHtml(datos)}</div>` : ''}
  </div>
  <img class="p-arbol" src="${arbolDoc}" alt="">
  ${tema.id === 'buho' ? '<div class="p-web">Búho AI · buhoai.es</div>' : ''}
  <div class="p-barra"></div>
</section>\n`
  }
  html += `<article class="cuerpo">${renderMd(f.body, { lineOffset: f.bodyStart, baseDir, warnings })}</article>`
  const cab = g('cabecera', 'header') ?? [title, fecha].filter(Boolean).join('  |  ')
  const pie = g('pie', 'footer') ?? tema.pie ?? (tema.id === 'buho' ? 'Búho AI · Tu equipo técnico de IA · buhoai.es' : '')
  const pieDer = g('pie-derecha', 'footer-right')
  const nota = g('nota-pie', 'aviso-pie', 'disclaimer')
  const chrome = { logo: tema.logo ?? (buhoBase ? buho : ''), marca: tema.marca ?? (buhoBase ? 'BÚHO AI' : ''), cab, pie, pieDer, nota }
  return { kind: 'documento', meta, html, chrome, theme: tema.base, tema, css: cssOf(meta, baseDir), title, warnings }
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

function buildSlides(src: string, baseDir: string, temaIn?: Tema): Built {
  const f = splitFront(src)
  const meta = f.meta
  const warnings: RenderWarning[] = f.error ? [{ line: 1, level: 'error', message: f.error }] : []
  const g = (...k: string[]): string | undefined => metaGet(meta, ...k)
  const title = g('titulo', 'título', 'title') ?? ''
  const tema = temaFinal(meta, temaIn)
  const buhoBase = tema.base === 'buho'
  const esBuho = tema.id === 'buho'
  const pie = g('pie', 'footer') ?? tema.pie ?? (esBuho ? (title ? `Búho AI · ${title}` : 'Búho AI') : title)
  const logo = tema.logo ?? (esBuho ? wordmark : '')
  const icono = tema.logo ?? (esBuho ? buho : '')
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
    const portadaArbol = buhoBase && (tema.portada ?? 'arbol') === 'arbol'
    const chrome =
      layout === 'portada'
        ? `${portadaArbol ? `<img class="s-arbol" src="${arbolDeck}" alt="">` : ''}${logo ? `<div class="s-logo"><img src="${logo}" alt="">${esBuho ? `<div class="lema">${escHtml(g('lema') ?? 'Tu equipo técnico de IA')}</div>` : ''}</div>` : ''}${esBuho ? '<div class="s-web">Búho AI · buhoai.es</div>' : ''}<div class="s-barra-baja"></div>`
        : `<footer class="s-pie">${icono ? `<img src="${icono}" alt="">` : ''}<span>${escHtml(pie)}</span><span class="s-num">${s.n} / ${total}</span></footer>${buhoBase ? `<img class="s-marca" src="${marcaAgua}" alt="">` : ''}`
    return `<section class="slide d-${layout}${dark ? ' oscuro' : ''}${fondo && !dark ? ` f-${fondo}` : ''}${/^(arriba|top)$/i.test(s.directives.alinear ?? '') ? ' f-arriba' : ''}" data-slide="${s.n}" data-line="${s.start + 1}">
<div class="s-barra"></div>${chrome}
<div class="s-cuerpo">${etiqueta}<div class="s-head">${head}</div><div class="s-main">${img}${body}</div></div>
${s.directives.notas ? `<aside class="s-notas">${escHtml(s.directives.notas)}</aside>` : ''}</section>`
  })
  return { kind: 'presentacion', meta, html: out.join('\n'), theme: tema.base, tema, css: cssOf(meta, baseDir), title, warnings }
}

export function build(src: string, baseDir: string, tema?: Tema): Built {
  return kindOf(splitFront(src).meta) === 'presentacion' ? buildSlides(src, baseDir, tema) : buildDoc(src, baseDir, tema)
}
