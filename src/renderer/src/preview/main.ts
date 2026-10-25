import { Previewer } from 'pagedjs-esm'
import type { RenderResult, RenderWarning } from '@shared/types'
import { build } from './render'
import buhoCss from './buho.css?raw'
import './screen.css'

/**
 * Página de vista previa. Dos usos:
 *  - Dentro de la app (iframe): recibe el Markdown por postMessage, pinta y avisa de clics (→ línea del editor).
 *  - Exportación (ventana oculta, ?mode=print): la app llama a window.buhoRender() y luego imprime a PDF.
 * Los documentos A4 se paginan con Paged.js (cabeceras, pies, números de página); las presentaciones
 * son diapositivas de tamaño fijo, una por página.
 */

interface RenderRequest {
  id?: number
  source: string
  baseDir: string
  /** Líneas (1) que acaban de cambiar: se resaltan. */
  flash?: number[]
  /** Llevar la vista a lo que ha cambiado (cambios de la IA). */
  reveal?: boolean
}

declare global {
  interface Window {
    buhoRender: (r: RenderRequest) => Promise<RenderResult>
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
    const ref = el.dataset.ref
    const parts = ref ? [...container.querySelectorAll<HTMLElement>(`[data-ref="${ref}"]`)] : [el]
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
  const b = build(req.source, req.baseDir)
  // Título del PDF (metadatos) al exportar.
  if (b.title) document.title = b.title
  const tpl = document.createElement('template')
  tpl.innerHTML = b.html
  structure(tpl.content)
  const scroll = scrollY
  const next = document.createElement('div')
  next.className = b.kind === 'presentacion' ? 'deck' : 'doc'
  next.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:100%'
  root.appendChild(next)
  const warnings = [...b.warnings]
  let pages = 0
  const oldStyles = [...document.head.querySelectorAll('style[data-pagedjs-inserted-styles], style[data-buho]')]
  if (b.kind === 'presentacion') {
    const st = document.createElement('style')
    st.dataset.buho = '1'
    st.textContent = buhoCss + '\n@page { size: 13.3333in 7.5in; margin: 0; }'
    document.head.appendChild(st)
    next.appendChild(tpl.content)
    await waitImages(next)
    pages = next.querySelectorAll('.slide').length
    pageWidth = 1280
  } else {
    const previewer = new Previewer()
    const flow = await previewer.preview(tpl.content, [{ [location.href.split('?')[0] + '#buho.css']: buhoCss + '\n' + b.pageCss }], next)
    pages = flow?.total ?? next.querySelectorAll('.pagedjs_page').length
    pageWidth = 794
  }
  await waitImages(next)
  await document.fonts.ready
  oldStyles.forEach((s) => s.remove())
  current?.remove()
  next.style.cssText = ''
  current = next
  fit()
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
  return { kind: b.kind, pages, warnings, ms: Math.round(performance.now() - t0) }
}

// Las peticiones se encadenan; si llegan varias mientras se pinta, solo cuenta la última.
let busy: Promise<unknown> = Promise.resolve()
let latest = 0
window.buhoRender = (req) => {
  const n = ++latest
  const run = busy.then(async () => {
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
  // Clic en la vista → la app lleva el editor a esa línea (y a la palabra, para corregir erratas).
  addEventListener('click', (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (a) e.preventDefault()
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
