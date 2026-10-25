import { inlineMd, type BlockRef, type BlockTag } from '@shared/visual'

/**
 * Edición visual sobre la propia página (como en Word): párrafos, títulos, elementos de lista, celdas
 * de tabla y textos de la portada se pueden escribir directamente. Cada cambio se manda a la app como
 * «este bloque ahora dice esto» y la app lo traduce al Markdown (src/shared/visual.ts).
 */

const EDITABLE = 'p, li, h1, h2, h3, h4, td, th, [data-meta]'
const SKIP = '.bx-indice, .bx-hueco, .pg-cab, .pg-pie, .pg-nota, .s-pie, .s-logo, .p-logo, .p-datos, .p-web'

let lastInput = 0
/**
 * Tras Intro o Retroceso la app rehace el Markdown y la página se repinta: lo que se teclea en ese
 * momento se guarda aquí y se escribe en el bloque nuevo en cuanto aparece (no se pierde nada).
 */
let held: string | null = null
let heldTimer: ReturnType<typeof setTimeout> | null = null
function hold(): void {
  held = ''
  if (heldTimer) clearTimeout(heldTimer)
  heldTimer = setTimeout(releaseHeld, 2000)
}
export function releaseHeld(): void {
  if (heldTimer) clearTimeout(heldTimer)
  heldTimer = null
  const t = held
  held = null
  if (t) document.execCommand('insertText', false, t)
}
export const typingRecently = (ms = 650): boolean => Date.now() - lastInput < ms
const post = (m: unknown): void => parent.postMessage(m, '*')

function editableOf(el: Element | null): HTMLElement | null {
  const e = el?.closest<HTMLElement>('[contenteditable="true"]') ?? null
  return e
}

export function refOf(el: HTMLElement): BlockRef | null {
  if (el.dataset.meta) return { line: 1, end: 1, tag: 'p', meta: el.dataset.meta }
  const tag = el.tagName.toLowerCase() as BlockTag
  if (tag === 'td' || tag === 'th') {
    const tr = el.closest<HTMLElement>('tr[data-line]')
    if (!tr) return null
    return { line: Number(tr.dataset.line), end: Number(tr.dataset.line), tag, cell: (el as HTMLTableCellElement).cellIndex }
  }
  const line = Number(el.dataset.line)
  if (!line) return null
  return { line, end: Number(el.dataset.end) || line, tag }
}

/** Todos los trozos del mismo bloque (un párrafo partido entre dos páginas son dos elementos). */
function partsOf(el: HTMLElement): HTMLElement[] {
  if (!el.dataset.line || el.dataset.meta) return [el]
  return [...document.querySelectorAll<HTMLElement>(`${el.tagName.toLowerCase()}[data-line="${el.dataset.line}"][contenteditable="true"]`)]
}

const textOf = (el: HTMLElement): string =>
  partsOf(el)
    .map((p) => inlineMd(p).trim())
    .join(' ')
    .trim()

/** Marca como editables los bloques de texto de lo que se acaba de pintar. */
export function enableEditing(container: HTMLElement): void {
  for (const el of container.querySelectorAll<HTMLElement>(EDITABLE)) {
    if (el.closest(SKIP)) continue
    if (el.tagName === 'P' && el.parentElement?.tagName === 'LI') continue
    if (el.tagName === 'LI' && el.querySelector('ul, ol')) continue
    if (!el.dataset.meta && !el.dataset.line && !el.closest('tr[data-line]')) continue
    el.contentEditable = 'true'
    el.spellcheck = true
    el.lang = 'es'
    el.querySelectorAll<HTMLElement>('.ic').forEach((i) => (i.contentEditable = 'false'))
  }
}

// ─── Cursor ──────────────────────────────────────────────────────────────────────────────────────

export interface Caret {
  line: number
  tag: string
  cell?: number
  meta?: string
  offset: number
}

function offsetIn(el: HTMLElement): number {
  const sel = getSelection()
  if (!sel || !sel.rangeCount) return 0
  const r = document.createRange()
  r.setStart(el, 0)
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset)
  return r.toString().length
}

export function saveCaret(): Caret | null {
  const el = editableOf(document.activeElement)
  if (!el) return null
  const ref = refOf(el)
  if (!ref) return null
  // Si el bloque está partido, el desplazamiento cuenta desde el primer trozo.
  const parts = partsOf(el)
  let before = 0
  for (const p of parts) {
    if (p === el) break
    before += (p.textContent ?? '').length + 1
  }
  return { line: ref.line, tag: el.tagName.toLowerCase(), cell: ref.cell, meta: ref.meta, offset: before + offsetIn(el) }
}

export function restoreCaret(c: Caret | null): void {
  if (!c) return
  let candidates: HTMLElement[]
  if (c.meta) candidates = [...document.querySelectorAll<HTMLElement>(`[data-meta="${c.meta}"][contenteditable="true"]`)]
  else if (c.cell !== undefined) {
    const tr = document.querySelector<HTMLElement>(`tr[data-line="${c.line}"]`)
    const cell = tr?.children[c.cell] as HTMLElement | undefined
    candidates = cell ? [cell] : []
  } else candidates = [...document.querySelectorAll<HTMLElement>(`[data-line="${c.line}"][contenteditable="true"]`)].filter((e) => e.tagName.toLowerCase() === c.tag || c.tag === 'any')
  if (!candidates.length) candidates = [...document.querySelectorAll<HTMLElement>(`[data-line="${c.line}"][contenteditable="true"]`)]
  let left = c.offset
  for (const el of candidates) {
    const len = (el.textContent ?? '').length
    if (left <= len || el === candidates[candidates.length - 1]) {
      placeCaret(el, Math.min(left, len))
      return
    }
    left -= len + 1
  }
}

function placeCaret(el: HTMLElement, offset: number): void {
  el.focus({ preventScroll: true })
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (left <= n.length) {
      const r = document.createRange()
      r.setStart(n, left)
      r.collapse(true)
      const sel = getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
      return
    }
    left -= n.length
  }
  const r = document.createRange()
  r.selectNodeContents(el)
  r.collapse(false)
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(r)
}

// ─── Eventos ─────────────────────────────────────────────────────────────────────────────────────

let pending: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null

function sendEdit(el: HTMLElement, format = false): void {
  const ref = refOf(el)
  if (ref) post({ type: 'edit', ref, text: textOf(el), format })
}

export function flushEdit(): void {
  if (!pending) return
  clearTimeout(pending.timer)
  const el = pending.el
  pending = null
  sendEdit(el)
}

/** Markdown del trozo de un bloque antes/después del cursor. */
function halves(el: HTMLElement): { before: string; after: string } {
  const sel = getSelection()!
  const range = sel.getRangeAt(0)
  const a = document.createRange()
  a.setStart(el, 0)
  a.setEnd(range.startContainer, range.startOffset)
  const b = document.createRange()
  b.setStart(range.endContainer, range.endOffset)
  b.setEnd(el, el.childNodes.length)
  const wrap = (r: Range): string => {
    const d = document.createElement('div')
    d.appendChild(r.cloneContents())
    return inlineMd(d).trim()
  }
  return { before: wrap(a), after: wrap(b) }
}

/** Bloque editable anterior en el documento (para unir con Retroceso). */
function previousEditable(el: HTMLElement): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('#root [contenteditable="true"]')]
  const i = all.indexOf(el)
  for (let k = i - 1; k >= 0; k--) {
    const p = all[k]
    if (p.dataset.line && p.dataset.line === el.dataset.line) continue
    return p
  }
  return null
}

export function installEditing(): void {
  document.addEventListener('input', (e) => {
    const el = editableOf(e.target as Element)
    if (!el) return
    lastInput = Date.now()
    if (pending && pending.el !== el) flushEdit()
    if (pending) clearTimeout(pending.timer)
    pending = { el, timer: setTimeout(flushEdit, 280) }
  })
  document.addEventListener('focusout', () => flushEdit())
  document.addEventListener('focusin', (e) => {
    const el = editableOf(e.target as Element)
    const ref = el ? refOf(el) : null
    if (ref) post({ type: 'focus', ref })
  })
  document.addEventListener('keydown', (e) => {
    if (held !== null) {
      // Esperando el repintado tras partir/unir: las letras las recoge «beforeinput»; el resto, fuera.
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey) e.preventDefault()
      return
    }
    const el = editableOf(e.target as Element)
    if (!el) return
    const ref = refOf(el)
    if (!ref) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && (e.key === 'z' || e.key === 'y' || e.key === 'Z')) {
      e.preventDefault()
      flushEdit()
      post({ type: e.key === 'y' || e.shiftKey ? 'redo' : 'undo' })
      return
    }
    if (mod && /^[sp]$/i.test(e.key)) {
      e.preventDefault()
      flushEdit()
      post({ type: 'key', key: e.key.toLowerCase(), shift: e.shiftKey })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (ref.meta || ref.tag === 'td' || ref.tag === 'th') return
      flushEdit()
      lastInput = 0
      const { before, after } = halves(el)
      hold()
      post({ type: 'split', ref, before, after })
      return
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      return
    }
    if (e.key === 'Backspace') {
      const sel = getSelection()
      if (!sel?.isCollapsed || offsetIn(el) !== 0 || ref.meta || ref.tag === 'td' || ref.tag === 'th') return
      const prev = previousEditable(el)
      const pref = prev ? refOf(prev) : null
      if (!prev || !pref || pref.meta || pref.tag === 'td' || pref.tag === 'th') return
      e.preventDefault()
      flushEdit()
      lastInput = 0
      hold()
      post({ type: 'merge', ref, prev: pref, text: textOf(el), prevText: textOf(prev) })
    }
  })
  document.addEventListener('beforeinput', (e) => {
    if (held === null) return
    if (e.data) held += e.data
    e.preventDefault()
  })
  // Pegar: solo texto (el formato lo pone la plantilla).
  document.addEventListener('paste', (e) => {
    if (!editableOf(e.target as Element)) return
    e.preventDefault()
    const t = e.clipboardData?.getData('text/plain') ?? ''
    document.execCommand('insertText', false, t.replace(/\s*\n\s*/g, ' '))
  })
}

let savedRange: Range | null = null
document.addEventListener('selectionchange', () => {
  const sel = getSelection()
  if (sel?.rangeCount && editableOf(sel.anchorNode?.parentElement ?? null)) savedRange = sel.getRangeAt(0).cloneRange()
})

const TAGS: Record<string, string> = { bold: 'STRONG', italic: 'EM', strikeThrough: 'S', link: 'A' }
const SAME: Record<string, string[]> = { STRONG: ['STRONG', 'B'], EM: ['EM', 'I'], S: ['S', 'DEL', 'STRIKE'], A: ['A'] }

/** Elemento de formato (negrita, cursiva…) que envuelve la selección, si lo hay. */
function wrapperOf(range: Range, tag: string, el: HTMLElement): HTMLElement | null {
  let n: Node | null = range.commonAncestorContainer
  while (n && n !== el) {
    if (n.nodeType === 1 && SAME[tag].includes((n as HTMLElement).tagName)) return n as HTMLElement
    n = n.parentNode
  }
  return null
}

/**
 * Órdenes de la barra de formato (negrita, cursiva, tachado, enlace) sobre la selección de la página.
 * Se hacen a mano y no con execCommand: al pulsar la barra de la app el foco no está en la página y
 * execCommand no haría nada.
 */
export function runCommand(name: string, value?: string): void {
  const range = savedRange
  const tag = TAGS[name]
  if (!range || !tag) return
  const el = editableOf(range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement)
  if (!el) return
  const existing = wrapperOf(range, tag, el)
  if (existing && (tag !== 'A' || !value)) {
    // Ya tiene ese formato: se quita.
    existing.replaceWith(...existing.childNodes)
  } else if (!range.collapsed) {
    const w = document.createElement(tag)
    if (tag === 'A') {
      if (!value) return
      w.setAttribute('href', value)
    }
    w.appendChild(range.extractContents())
    range.insertNode(w)
    // Formatos iguales dentro del nuevo (p. ej. negrita dentro de negrita) sobran.
    w.querySelectorAll(SAME[tag].join(',')).forEach((x) => x.replaceWith(...x.childNodes))
    const sel = getSelection()!
    const r = document.createRange()
    r.selectNodeContents(w)
    sel.removeAllRanges()
    sel.addRange(r)
    savedRange = r.cloneRange()
  } else return
  el.normalize()
  sendEdit(el, true)
}
