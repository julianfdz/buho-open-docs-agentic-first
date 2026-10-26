import type { RenderResult, RenderWarning } from '@shared/types'
import { build } from './render'
import { varsDe, type Tema } from '@shared/temas'
import { paginate } from './paginate'
import { enableEditing, flushEdit, installEditing, releaseHeld, restoreCaret, runCommand, saveCaret, typingRecently } from './visual-edit'
import buhoCss from './buho.css?raw'
import { inspeccionar, montarMosaico, quitarMosaico } from './inspect'
import './screen.css'

/**
 * Página de vista previa. Dos usos:
 *  - Dentro de la app (iframe): recibe el Markdown por postMessage, pinta y avisa de clics (→ línea del editor).
 *  - Exportación (ventana oculta, ?mode=print): la app llama a window.buhoRender() y luego imprime a PDF.
 * Los documentos A4 se paginan con paginate.ts (cabeceras, pies, números de página); las presentaciones
 * son diapositivas de tamaño fijo, una por página. En la app, el texto se puede escribir directamente
 * sobre la página (visual-edit.ts).
 */

interface RenderRequest {
  id?: number
  source: string
  baseDir: string
  /** Líneas (1) que acaban de cambiar: se resaltan. */
  flash?: number[]
  /** Llevar la vista a lo que ha cambiado (cambios de la IA). */
  reveal?: boolean
  /** Edición visual activada. */
  editable?: boolean
  /** Dejar el cursor en esta línea al terminar (tras partir o unir bloques). */
  focus?: { line: number; offset: number }
  /** Tema ya resuelto por la app (los del usuario llevan logo y CSS). */
  tema?: Tema
  /** Revisión: líneas (1) con comentarios abiertos y con propuestas pendientes. */
  marcas?: { comentarios: number[]; propuestas: number[] }
}

let comentando = false
/** Marca los bloques (y sus trozos si se partieron entre páginas) que tienen comentarios o propuestas. */
function marcar(container: HTMLElement, m: RenderRequest['marcas']): void {
  if (!m) return
  const list = blocks(container)
  const poner = (lines: number[], cls: string): void => {
    for (const l of lines) {
      const el = blockAt(list, l)
      if (!el) continue
      const parts = el.dataset.line ? [...container.querySelectorAll<HTMLElement>(`${el.tagName.toLowerCase()}[data-line="${el.dataset.line}"]`)] : [el]
      for (const p of parts) p.classList.add(cls)
    }
  }
  poner(m.comentarios, 'm-com')
  poner(m.propuestas, 'm-prop')
}

declare global {
  interface Window {
    buhoRender: (r: RenderRequest) => Promise<RenderResult>
    buhoInspect: typeof inspeccionar
    buhoMosaico: typeof montarMosaico
    buhoQuitarMosaico: typeof quitarMosaico
  }
}

const printMode = new URLSearchParams(location.search).get('mode') === 'print'
document.documentElement.classList.toggle('print-mode', printMode)
const root = document.getElementById('root')!
let pageWidth = 794
let current: HTMLElement | null = null

// ─── Estructura que el Markdown no da (tarjetas, pasos y panel: cada ### abre un bloque) ────────

function groupBy(body: Element, cls: string): void {
  const kids = [...body.children]
  if (!kids.some((k) => k.tagName === 'H3')) return
  let box: HTMLElement | null = null
  for (const k of kids) {
    if (k.tagName === 'H3') {
      box = document.createElement('div')
      box.className = cls
      box.dataset.line = (k as HTMLElement).dataset.line ?? ''
      body.insertBefore(box, k)
    }
    if (box) box.appendChild(k)
  }
}

function structure(el: ParentNode): void {
  el.querySelectorAll('.bx-tarjetas > .bx-body').forEach((b) => groupBy(b, 'tarjeta'))
  el.querySelectorAll('.bx-pasos > .bx-body').forEach((b) => groupBy(b, 'paso'))
  el.querySelectorAll('.bx-panel > .bx-body').forEach((b) => groupBy(b, 'apartado'))
  // Párrafo que es solo una etiqueta en mayúsculas al principio de un panel → estilo etiqueta.
  el.querySelectorAll('.bx-panel > .bx-body > p:first-child').forEach((p) => {
    const t = p.textContent ?? ''
    if (t && t === t.toUpperCase() && t.length < 60) p.classList.add('etiqueta')
  })
  keepWithNext(el)
}

/**
 * Un título nunca se queda solo al pie de la página: se une al bloque que le sigue (como «Conservar
 * con el siguiente» de Word). Paged.js no respeta break-after: avoid entre bloques distintos.
 */
function keepWithNext(el: ParentNode): void {
  for (const body of el.querySelectorAll('.cuerpo')) {
    for (const h of [...body.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4')]) {
      if (h.parentElement !== body) continue
      const group: Element[] = [h]
      let next = h.nextElementSibling
      // Títulos seguidos (## + ###) van juntos con el primer bloque de contenido.
      while (next && /^H[1-4]$/.test(next.tagName)) {
        group.push(next)
        next = next.nextElementSibling
      }
      if (!next || next.classList.contains('salto')) continue
      group.push(next)
      const keep = document.createElement('div')
      keep.className = 'keep'
      body.insertBefore(keep, h)
      for (const g of group) keep.appendChild(g)
    }
  }
}

// ─── Índice automático (::: indice) ──────────────────────────────────────────────────────────────

/** Rellena los índices con los títulos (antes de paginar, con el hueco del número de página). */
function fillIndex(el: ParentNode, kind: string): void {
  for (const ix of el.querySelectorAll<HTMLElement>('.bx-indice')) {
    const niveles = Number(ix.dataset.niveles) || 2
    const body = ix.querySelector('.bx-body')!
    const items: string[] = [`<div class="ix-titulo">${ix.dataset.titulo ?? 'Índice'}</div>`]
    if (kind === 'presentacion') {
      for (const s of el.querySelectorAll<HTMLElement>('.slide')) {
        const h = s.querySelector('.s-head h1, .s-head h2')
        if (h && !s.contains(ix)) items.push(`<div class="ix-item lv2" data-goto="${s.dataset.line}"><span class="ix-t">${h.textContent}</span><span class="ix-d"></span><span class="ix-n">${s.dataset.slide}</span></div>`)
      }
    } else {
      const sel = ['h1', 'h2', 'h3', 'h4'].slice(0, niveles).map((h) => `.cuerpo > ${h}, .cuerpo > .keep > ${h}`).join(', ')
      for (const h of el.querySelectorAll<HTMLElement>(sel)) {
        const lv = Number(h.tagName[1])
        items.push(`<div class="ix-item lv${lv}" data-goto="${h.dataset.line}"><span class="ix-t">${(h.textContent ?? '').trim()}</span><span class="ix-d"></span><span class="ix-n">00</span></div>`)
      }
    }
    body.innerHTML = items.join('')
  }
}

/** Después de paginar: el número de página de cada título. */
function indexPages(host: HTMLElement): void {
  const pages = [...host.children] as HTMLElement[]
  for (const it of host.querySelectorAll<HTMLElement>('.bx-indice .ix-item')) {
    const line = it.dataset.goto
    const h = host.querySelector(`.cuerpo [data-line="${line}"]:is(h1, h2, h3, h4)`)
    const pg = h?.closest('.pg')
    const n = it.querySelector('.ix-n')
    if (n && pg) n.textContent = String(pages.indexOf(pg as HTMLElement) + 1)
  }
}

// ─── Resaltado de cambios ──────────────────────────────────────────────────────────────────────

function blocks(container: HTMLElement): { el: HTMLElement; line: number }[] {
  return [...container.querySelectorAll<HTMLElement>('[data-line]')]
    .map((el) => ({ el, line: Number(el.dataset.line) }))
    .filter((b) => b.line > 0)
}

/** El bloque más interior que empieza en esa línea o justo antes. */
function blockAt(list: { el: HTMLElement; line: number }[], line: number): HTMLElement | null {
  let best: { el: HTMLElement; line: number } | null = null
  for (const b of list) {
    if (b.line > line) continue
    if (!best || b.line > best.line || (b.line === best.line && best.el.contains(b.el))) best = b
  }
  return best?.el ?? null
}

function flash(container: HTMLElement, lines: number[], reveal: boolean): void {
  if (!lines.length) return
  const list = blocks(container)
  const hit = new Set<HTMLElement>()
  for (const l of lines) {
    const el = blockAt(list, l)
    if (el) hit.add(el)
  }
  let first: HTMLElement | null = null
  for (const el of hit) {
    // Paged.js puede partir un bloque entre páginas: se resaltan todos sus trozos.
    // Un bloque partido entre páginas: se resaltan todos sus trozos.
    const parts = el.dataset.line ? [...container.querySelectorAll<HTMLElement>(`${el.tagName.toLowerCase()}[data-line="${el.dataset.line}"]`)] : [el]
    for (const p of parts) {
      p.classList.remove('flash')
      void p.offsetWidth
      p.classList.add('flash')
      first ??= p
    }
  }
  if (reveal && first) {
    const r = first.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight) first.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

// ─── Pintar ────────────────────────────────────────────────────────────────────────────────────

function fit(): void {
  if (!current || printMode) return
  const z = Math.min(1.25, Math.max(0.2, (innerWidth - 40) / pageWidth))
  current.style.zoom = String(z)
}
addEventListener('resize', fit)

async function waitImages(el: HTMLElement): Promise<void> {
  const imgs = [...el.querySelectorAll('img')]
  await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r))))))
}

function brokenImages(el: HTMLElement): RenderWarning[] {
  const seen = new Set<string>()
  const out: RenderWarning[] = []
  for (const i of el.querySelectorAll('img')) {
    if (i.complete && i.naturalWidth === 0 && !seen.has(i.src)) {
      seen.add(i.src)
      const line = Number(i.closest<HTMLElement>('[data-line]')?.dataset.line) || undefined
      let name = i.getAttribute('src') ?? ''
      try {
        name = decodeURIComponent(name.replace(/^buho:\/\/file\//, ''))
      } catch {
        /* tal cual */
      }
      out.push({ line, level: 'error', message: `No encuentro la imagen ${name}` })
    }
  }
  return out
}

async function renderNow(req: RenderRequest): Promise<RenderResult> {
  const t0 = performance.now()
  const b = build(req.source, req.baseDir, req.tema)
  const tBuild = performance.now()
  // Título del PDF (metadatos) al exportar.
  if (b.title) document.title = b.title
  const tpl = document.createElement('template')
  tpl.innerHTML = b.html
  structure(tpl.content)
  const caret = req.editable ? saveCaret() : null
  const scroll = scrollY
  const next = document.createElement('div')
  const cls = `${b.kind === 'presentacion' ? 'deck' : 'doc'} tema-${b.theme} tema-id-${b.tema.id}`
  next.className = cls
  // Colores y letras del tema (variables CSS) y su CSS propio.
  const vars = varsDe(b.tema)
  for (const [k, v] of Object.entries(vars)) next.style.setProperty(k, v)
  const ts = document.head.querySelector<HTMLStyleElement>('style[data-tema]') ?? document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '' }))
  ts.dataset.tema = '1'
  ts.textContent = b.tema.css ?? ''
  // Hoja de estilo propia del documento (cabecera css:).
  let link = document.head.querySelector<HTMLLinkElement>('link[data-css]')
  if (b.css) {
    if (!link) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      link.dataset.css = '1'
      document.head.appendChild(link)
    }
    if (link.getAttribute('href') !== b.css) {
      const l = link
      await new Promise((r) => {
        l.onload = l.onerror = r
        l.href = b.css!
      })
    }
  } else link?.remove()
  next.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:100%'
  root.appendChild(next)
  const warnings = [...b.warnings]
  let pages = 0
  const st = document.head.querySelector<HTMLStyleElement>('style[data-buho]') ?? document.head.appendChild(Object.assign(document.createElement('style'), { textContent: buhoCss }))
  st.dataset.buho = '1'
  const pageRule = b.kind === 'presentacion' ? '@page { size: 13.3333in 7.5in; margin: 0; }' : '@page { size: A4; margin: 0; }'
  const ps = document.head.querySelector<HTMLStyleElement>('style[data-page]') ?? document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '' }))
  ps.dataset.page = '1'
  ps.textContent = pageRule
  if (b.kind === 'presentacion') {
    next.appendChild(tpl.content)
    fillIndex(next, 'presentacion')
    await waitImages(next)
    pages = next.querySelectorAll('.slide').length
    pageWidth = 1280
  } else {
    // Las imágenes tienen que haber cargado antes de medir.
    const tmp = document.createElement('div')
    tmp.style.cssText = 'position:absolute;visibility:hidden;width:174mm'
    tmp.className = cls
    for (const [k, v] of Object.entries(vars)) tmp.style.setProperty(k, v)
    tmp.appendChild(tpl.content)
    fillIndex(tmp, 'documento')
    root.appendChild(tmp)
    await waitImages(tmp)
    await document.fonts.ready
    const frag = document.createDocumentFragment()
    while (tmp.firstChild) frag.appendChild(tmp.firstChild)
    tmp.remove()
    const r = paginate(frag, next, b.chrome!)
    indexPages(next)
    pages = r.pages
    for (const el of r.tooBig) warnings.push({ line: Number(el.dataset.line) || undefined, level: 'aviso', message: 'Un bloque no cabe ni en una página entera: se corta (pártelo en trozos más pequeños)' })
    pageWidth = 794
  }
  const tLayout = performance.now()
  await waitImages(next)
  await document.fonts.ready
  current?.remove()
  next.style.cssText = ''
  for (const [k, v] of Object.entries(vars)) next.style.setProperty(k, v)
  current = next
  fit()
  if (req.editable) {
    enableEditing(next)
    if (req.focus) {
      restoreCaret({ line: req.focus.line, tag: 'any', offset: req.focus.offset })
      releaseHeld()
    } else restoreCaret(caret)
  }
  if (b.kind === 'presentacion') {
    for (const s of next.querySelectorAll<HTMLElement>('.slide')) {
      const main = s.querySelector<HTMLElement>('.s-main')
      const body = s.querySelector<HTMLElement>('.s-cuerpo')
      const over = (main && main.scrollHeight > main.clientHeight + 2) || (body && body.scrollHeight > body.clientHeight + 2) || (main && main.scrollWidth > main.clientWidth + 2)
      s.classList.toggle('overflow', !!over)
      if (over) warnings.push({ slide: Number(s.dataset.slide), line: Number(s.dataset.line), level: 'aviso', message: `La diapositiva ${s.dataset.slide} no cabe: sobra contenido (recorta texto o pártela en dos)` })
    }
  }
  warnings.push(...brokenImages(next))
  if (!req.reveal) scrollTo(0, scroll)
  flash(next, req.flash ?? [], !!req.reveal)
  marcar(next, req.marcas)
  return { kind: b.kind, pages, warnings, ms: Math.round(performance.now() - t0), timings: { markdown: Math.round(tBuild - t0), maquetar: Math.round(tLayout - tBuild), resto: Math.round(performance.now() - tLayout) } }
}

// Las peticiones se encadenan; si llegan varias mientras se pinta, solo cuenta la última.
let busy: Promise<unknown> = Promise.resolve()
let latest = 0
window.buhoInspect = inspeccionar
window.buhoMosaico = montarMosaico
window.buhoQuitarMosaico = quitarMosaico

window.buhoRender = (req) => {
  const n = ++latest
  const run = busy.then(async () => {
    // Mientras escribes en la página no se repinta (perderías el cursor): espera a que pares.
    while (!printMode && typingRecently() && !req.focus) await new Promise((r) => setTimeout(r, 90))
    if (n !== latest && !printMode) return null
    return renderNow(req)
  })
  busy = run.catch(() => null)
  return run as Promise<RenderResult>
}

if (!printMode) {
  addEventListener('message', async (e: MessageEvent) => {
    if (e.source !== parent) return
    const m = e.data
    if (m?.type === 'render') {
      try {
        const result = await window.buhoRender(m)
        if (result) parent.postMessage({ type: 'rendered', id: m.id, result }, '*')
      } catch (err) {
        parent.postMessage({ type: 'rendered', id: m.id, result: { kind: 'documento', pages: 0, ms: 0, warnings: [{ level: 'error', message: `Error al pintar: ${(err as Error).message}` }] } }, '*')
      }
    } else if (m?.type === 'cmd') {
      runCommand(m.name, m.value)
    } else if (m?.type === 'comentar') {
      comentando = !!m.on
      document.body.classList.toggle('comentando', comentando)
    } else if (m?.type === 'flushEdit') {
      flushEdit()
    } else if (m?.type === 'scrollTo' && current) {
      const el = blockAt(blocks(current), m.line)
      if (el && m.quiet) {
        // Seguir al cursor: solo si el bloque no se ve, y sin resaltarlo.
        const r = el.getBoundingClientRect()
        if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'center' })
      } else if (el) {
        el.scrollIntoView({ block: 'center' })
        el.classList.remove('locate')
        void el.offsetWidth
        el.classList.add('locate')
      }
    }
  })
  installEditing()
  // Clic derecho: la app sabrá sobre qué bloque (y qué selección) es el «Comentar…» del menú.
  addEventListener('contextmenu', (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
    const sel = (getSelection()?.toString() ?? '').replace(/\s+/g, ' ').trim()
    parent.postMessage({ type: 'ctx', line: el ? Number(el.dataset.line) : 0, cita: sel.slice(0, 400), seleccion: sel ? sel.slice(0, 400) : undefined }, '*')
  })
  // Comentando: clic en un bloque (o seleccionar un trozo) → comentario sobre eso.
  addEventListener(
    'mouseup',
    (e: MouseEvent) => {
      if (!comentando || e.button !== 0) return
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
      if (!el) return
      const sel = (getSelection()?.toString() ?? '').replace(/\s+/g, ' ').trim()
      document.querySelectorAll('.m-sel').forEach((x) => x.classList.remove('m-sel'))
      el.classList.add('m-sel')
      parent.postMessage({ type: 'comentar', line: Number(el.dataset.line), cita: sel.slice(0, 400), seleccion: sel ? sel.slice(0, 400) : undefined }, '*')
    },
    true
  )
  // Clic en la vista → la app lleva el editor a esa línea (y a la palabra, para corregir erratas).
  addEventListener('click', (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (a) e.preventDefault()
    if (comentando) return
    // Índice: clic en una entrada → ir a ese título.
    const ix = (e.target as HTMLElement).closest<HTMLElement>('.ix-item')
    if (ix && current) {
      const h = current.querySelector<HTMLElement>(`[data-line="${ix.dataset.goto}"]`)
      h?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    // Escribiendo en la página: el editor de Markdown sigue al cursor sin robarle el foco.
    if ((e.target as HTMLElement).closest('[contenteditable="true"]')) {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
      if (el) parent.postMessage({ type: 'caret', line: Number(el.dataset.line) }, '*')
      return
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
    if (!el) return
    let word = ''
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY)
    if (r && r.startContainer.nodeType === Node.TEXT_NODE) {
      const t = r.startContainer.textContent ?? ''
      let s = r.startOffset
      let f = r.startOffset
      while (s > 0 && /[\p{L}\p{N}'’-]/u.test(t[s - 1])) s--
      while (f < t.length && /[\p{L}\p{N}'’-]/u.test(t[f])) f++
      word = t.slice(s, f)
    }
    parent.postMessage({ type: 'click', line: Number(el.dataset.line), word, double: e.detail > 1 }, '*')
  })
  parent.postMessage({ type: 'ready' }, '*')
}
