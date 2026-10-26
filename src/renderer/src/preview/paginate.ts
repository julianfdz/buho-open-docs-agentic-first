/**
 * Paginador A4 propio (sustituye a Paged.js, que tardaba ~1 s por página).
 *
 * Coloca los bloques del documento uno a uno en páginas de tamaño fijo y mide con el navegador si
 * caben. Si un bloque no cabe:
 *   - tablas → por filas (repitiendo la cabecera), listas → por elementos,
 *   - párrafos → por palabras (por la línea exacta en la que se sale),
 *   - cajas, tarjetas, pasos y grupos «título + bloque» → por sus hijos, recursivamente,
 *   - lo demás pasa entero a la página siguiente.
 * Un título nunca se queda solo al pie: si de un grupo «título + bloque» solo cabe el título, el grupo
 * entero pasa a la página siguiente.
 */

export interface PageChrome {
  logo: string
  /** Texto de marca de la cabecera («BÚHO AI»); vacío en el estilo blanco. */
  marca: string
  cab: string
  pie: string
  pieDer?: string
  nota?: string
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function newPage(host: HTMLElement, chrome: PageChrome): HTMLElement {
  const pg = document.createElement('div')
  pg.className = 'pg'
  pg.innerHTML = `<div class="pg-cab"><span class="pg-marca">${chrome.logo ? `<img src="${chrome.logo}" alt="">` : ''}${esc(chrome.marca)}</span><span class="pg-tema">${esc(chrome.cab)}</span></div>
<div class="pg-cuerpo cuerpo"></div>
<div class="pg-pie"><span>${esc(chrome.pie)}</span><span class="pg-num">${chrome.pieDer ? esc(chrome.pieDer) + '  ·  ' : ''}<b></b></span></div>${chrome.nota ? `<div class="pg-nota">${esc(chrome.nota)}</div>` : ''}`
  host.appendChild(pg)
  return pg
}

const body = (pg: HTMLElement): HTMLElement => pg.querySelector('.pg-cuerpo') as HTMLElement
const overflows = (box: HTMLElement): boolean => box.scrollHeight > box.clientHeight + 0.5

/** Dónde van los hijos de un bloque contenedor al partirlo. */
function flowParent(el: HTMLElement): HTMLElement | null {
  // Las tarjetas, pasos y apartados sueltos no se parten: pasan enteros.
  if (el.classList.contains('keep')) return el
  if (el.classList.contains('bx')) return el.querySelector(':scope > .bx-body')
  return null
}

/** Copia vacía de un contenedor (misma estructura, sin los hijos que fluyen). */
function shell(el: HTMLElement): { copy: HTMLElement; flow: HTMLElement } {
  const copy = el.cloneNode(true) as HTMLElement
  const flow = flowParent(copy)!
  flow.replaceChildren()
  return { copy, flow }
}

/** Parte un párrafo (o elemento de texto) en la palabra donde se sale de la caja. */
function splitText(el: HTMLElement, box: HTMLElement): HTMLElement | null {
  const limit = box.getBoundingClientRect().bottom
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const words: { node: Text; offset: number }[] = []
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data
    for (let i = 0; i < t.length; i++) if ((i === 0 || /\s/.test(t[i - 1])) && !/\s/.test(t[i])) words.push({ node: n, offset: i })
  }
  if (words.length < 6) return null
  const bottom = (w: { node: Text; offset: number }): number => {
    const r = document.createRange()
    r.setStart(w.node, w.offset)
    r.setEnd(w.node, Math.min(w.node.length, w.offset + 1))
    return r.getBoundingClientRect().bottom
  }
  // Primera palabra que se sale (búsqueda binaria: las palabras van en orden de arriba abajo).
  let lo = 0
  let hi = words.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bottom(words[mid]) > limit) hi = mid
    else lo = mid + 1
  }
  // Viudas y huérfanas: al menos dos líneas en cada lado. Si al otro lado solo iría una línea, se
  // lleva también la anterior; si en esta página solo quedaría una, el párrafo pasa entero.
  if (lo < 1 || lo >= words.length) return null
  const top = (w: { node: Text; offset: number }): number => {
    const r = document.createRange()
    r.setStart(w.node, w.offset)
    r.setEnd(w.node, Math.min(w.node.length, w.offset + 1))
    return Math.round(r.getBoundingClientRect().top)
  }
  const lineas = (a: number, b: number): number => new Set(words.slice(a, b).map(top)).size
  if (lineas(lo, words.length) < 2) {
    const t = top(words[lo - 1])
    while (lo > 0 && top(words[lo - 1]) === t) lo--
  }
  if (lo < 1 || lineas(0, lo) < 2) return null
  const r = document.createRange()
  r.setStart(words[lo].node, words[lo].offset)
  r.setEndAfter(el.lastChild!)
  const rest = el.cloneNode(false) as HTMLElement
  rest.append(r.extractContents())
  return rest
}

/**
 * Intenta dejar en la página la parte de `el` que cabe; devuelve el resto (o null si no se puede
 * partir). `el` ya está en la caja y la desborda.
 */
function split(el: HTMLElement, box: HTMLElement): HTMLElement | null {
  const tag = el.tagName
  if (tag === 'TABLE') {
    const rows = [...el.querySelectorAll(':scope > tbody > tr')]
    if (rows.length < 2) return null
    const rest = el.cloneNode(true) as HTMLElement
    const restRows = [...rest.querySelectorAll(':scope > tbody > tr')]
    let keep = rows.length
    while (keep > 0 && overflows(box)) rows[--keep].remove()
    if (keep === 0) {
      rows.forEach((r) => el.querySelector('tbody')!.appendChild(r))
      return null
    }
    restRows.slice(0, keep).forEach((r) => r.remove())
    return rest
  }
  if (tag === 'UL' || tag === 'OL') {
    const items = [...el.children] as HTMLElement[]
    const rest = el.cloneNode(false) as HTMLElement
    let k = items.length
    while (k > 0 && overflows(box)) {
      rest.prepend(items[--k])
    }
    if (k === 0) {
      items.forEach((i) => el.appendChild(i))
      return null
    }
    // El elemento que no cabía entero puede partirse por palabras.
    const first = rest.firstElementChild as HTMLElement | null
    if (first) {
      el.appendChild(first)
      const tail = overflows(box) ? splitText(first, box) : null
      if (tail && !overflows(box)) rest.prepend(tail)
      else rest.prepend(first)
    }
    if (tag === 'OL') rest.setAttribute('start', String((Number(el.getAttribute('start')) || 1) + el.children.length))
    if (!rest.children.length) return null
    return rest
  }
  if (tag === 'P' || tag === 'BLOCKQUOTE') {
    const rest = splitText(el, box)
    return rest && !overflows(box) ? rest : (rest && el.append(...rest.childNodes), null)
  }
  const flow = flowParent(el)
  if (!flow) return null
  const kids = [...flow.children] as HTMLElement[]
  if (kids.length < 2 && !el.classList.contains('keep')) {
    const only = kids[0]
    if (!only) return null
    const tail = split(only, box)
    if (!tail) return null
    const { copy, flow: f2 } = shell(el)
    f2.appendChild(tail)
    return copy
  }
  const { copy, flow: restFlow } = shell(el)
  let k = kids.length
  while (k > 0 && overflows(box)) restFlow.prepend(kids[--k])
  // El primer hijo que no cabía entero quizá se pueda partir.
  if (k < kids.length) {
    const cand = kids[k]
    flow.appendChild(cand)
    const tail = overflows(box) ? split(cand, box) : null
    if (tail) restFlow.prepend(tail)
    else if (overflows(box)) restFlow.prepend(cand)
  }
  const placed = [...flow.children]
  // Un título solo al pie no vale: el grupo entero a la página siguiente.
  if (!placed.length || placed.every((c) => /^H[1-6]$/.test(c.tagName))) {
    while (restFlow.firstChild) flow.appendChild(restFlow.firstChild)
    return null
  }
  if (!restFlow.children.length) return null
  return copy
}

/**
 * Reparte los bloques de `content` (portada + cuerpo ya pintados) en páginas A4 dentro de `host`.
 * Devuelve el número de páginas y los bloques que no caben ni en una página entera.
 */
export function paginate(content: DocumentFragment, host: HTMLElement, chrome: PageChrome): { pages: number; tooBig: HTMLElement[] } {
  const tooBig: HTMLElement[] = []
  const cover = content.querySelector<HTMLElement>('.portada')
  if (cover) {
    const pg = document.createElement('div')
    pg.className = 'pg pg-portada'
    pg.appendChild(cover)
    host.appendChild(pg)
  }
  const blocks = [...(content.querySelector('.cuerpo')?.children ?? [])] as HTMLElement[]
  let pg = newPage(host, chrome)
  let box = body(pg)
  const queue = [...blocks]
  while (queue.length) {
    const el = queue.shift()!
    if (el.classList.contains('salto')) {
      if (box.children.length) {
        pg = newPage(host, chrome)
        box = body(pg)
      }
      continue
    }
    box.appendChild(el)
    if (!overflows(box)) continue
    const rest = split(el, box)
    if (rest) {
      queue.unshift(rest)
      pg = newPage(host, chrome)
      box = body(pg)
      continue
    }
    if (box.children.length === 1) {
      // Ni en una página entera: se queda (y se avisa).
      tooBig.push(el)
      pg = newPage(host, chrome)
      box = body(pg)
      continue
    }
    el.remove()
    pg = newPage(host, chrome)
    box = body(pg)
    queue.unshift(el)
  }
  if (!box.children.length && host.children.length > 1) pg.remove()
  const pages = [...host.children] as HTMLElement[]
  pages.forEach((p, i) => {
    const n = p.querySelector('.pg-num b')
    if (n) n.textContent = `${i + 1} / ${pages.length}`
  })
  return { pages: pages.length, tooBig }
}
