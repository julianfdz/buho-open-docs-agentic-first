/**
 * Inspección visual de lo que hay pintado: qué líneas del Markdown caen en cada página, cuánto se
 * llena cada una y los problemas que se ven a simple vista (páginas medio vacías, un título solo al
 * final de la página, algo que se sale por la derecha o por abajo, imágenes rotas, huecos sin
 * rellenar, diapositivas que no caben). La usan los agentes para comprobar su trabajo (revisar, scan).
 * También compone el mosaico: todas las páginas en pequeño en una imagen, para verlo de un vistazo.
 */
export interface AvisoVisual {
  tipo: string
  nivel: 'error' | 'aviso'
  mensaje: string
  linea?: number
}
export interface PaginaInfo {
  n: number
  portada: boolean
  /** Bloques [línea, última línea] (1 = primera del archivo) que se ven en la página. */
  bloques: [number, number][]
  /** Cuánto se llena el cuerpo de la página (0–1). */
  llenado: number
  titulos: string[]
  avisos: AvisoVisual[]
}

const paginas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#root > .doc > .pg, #root > .deck > .slide')]
const lineaDe = (el: Element | null): number | undefined => Number((el?.closest('[data-line]') as HTMLElement | null)?.dataset.line) || undefined

/** Color de fondo efectivo: el primero no transparente subiendo por los padres (blanco si ninguno). */
function fondoDe(el: HTMLElement): string {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor
    if (c && !/rgba\([^)]*,\s*0\)$/.test(c) && c !== 'transparent') return c
  }
  return 'rgb(255, 255, 255)'
}
const rgb = (c: string): [number, number, number] | null => {
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const luz = ([r, g, b]: [number, number, number]): number => {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
/** Relación de contraste WCAG entre dos colores CSS (null si no se puede calcular). */
function contraste(a: string, b: string): number | null {
  const x = rgb(a)
  const y = rgb(b)
  if (!x || !y) return null
  const [l1, l2] = [luz(x), luz(y)].sort((m, n) => n - m)
  return (l1 + 0.05) / (l2 + 0.05)
}

export function inspeccionar(): { kind: string; pages: PaginaInfo[] } {
  const deck = !!document.querySelector('#root > .deck')
  const ps = paginas()
  return {
    kind: deck ? 'presentacion' : 'documento',
    pages: ps.map((p, i) => {
      const portada = p.classList.contains('pg-portada') || (deck && p.classList.contains('d-portada'))
      const cuerpo = p.querySelector<HTMLElement>('.pg-cuerpo, .s-cuerpo, .s-main') ?? p
      const bloques: [number, number][] = []
      for (const el of p.querySelectorAll<HTMLElement>('[data-line]')) {
        const l = Number(el.dataset.line)
        if (l) bloques.push([l, Number(el.dataset.end) || l])
      }
      // Una diapositiva va de su línea hasta justo antes de la siguiente.
      if (deck && Number(p.dataset.line)) bloques.push([Number(p.dataset.line), (Number(ps[i + 1]?.dataset.line) || 1e9) - 1])
      const titulos = [...p.querySelectorAll('h1, h2, h3')].map((h) => (h.textContent ?? '').trim()).filter(Boolean).slice(0, 6)
      const avisos: AvisoVisual[] = []
      const cr = cuerpo.getBoundingClientRect()
      const hijos = [...cuerpo.children].filter((c) => (c as HTMLElement).offsetParent !== null && !c.classList.contains('salto')) as HTMLElement[]
      const fondo = hijos.reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), cr.top)
      const llenado = cr.height ? Math.max(0, Math.min(1.5, (fondo - cr.top) / cr.height)) : 0
      const ultimo = ps.length === i + 1
      // Hueco intencionado: salto de página o la siguiente página empieza sección (##).
      const conSalto = !!cuerpo.lastElementChild?.classList.contains('salto') || !!p.nextElementSibling?.querySelector('.pg-cuerpo > :first-child.salto, .pg-cuerpo > h2:first-child, .pg-cuerpo > .keep:first-child > h2:first-child')

      if (!deck && !portada) {
        if (!ultimo && !conSalto && llenado < 0.45 && hijos.length)
          avisos.push({ tipo: 'pagina-poco-llena', nivel: 'aviso', mensaje: `Página llena al ${Math.round(llenado * 100)} %: queda un hueco grande (seguramente el bloque siguiente no cabía y saltó de página; acórtalo, pártelo o reordena)`, linea: lineaDe(hijos[hijos.length - 1]) })
        if (ultimo && llenado < 0.12 && ps.length > 1) avisos.push({ tipo: 'ultima-pagina-corta', nivel: 'aviso', mensaje: `La última página solo tiene unas líneas (${Math.round(llenado * 100)} %): recorta un poco antes o añade contenido`, linea: lineaDe(hijos[0]) })
        const ult = hijos[hijos.length - 1]
        if (!ultimo && ult && /^H[1-4]$/.test(ult.tagName)) avisos.push({ tipo: 'titulo-al-final', nivel: 'aviso', mensaje: `El título «${(ult.textContent ?? '').trim().slice(0, 50)}» se queda solo al final de la página`, linea: lineaDe(ult) })
        // Un bloque partido entre páginas que deja solo un trocito en esta (o en la anterior).
        const prim = hijos[0]
        const prevCuerpo = ps[i - 1]?.querySelector<HTMLElement>('.pg-cuerpo')
        const prevUlt = prevCuerpo?.lastElementChild as HTMLElement | null | undefined
        if (prim && prevUlt && prim.dataset.line && prim.dataset.line === prevUlt.dataset.line) {
          const hPrim = prim.getBoundingClientRect().height
          const hPrev = prevUlt.getBoundingClientRect().height
          // Solo si en un lado queda una sola línea (dos ya es correcto).
          const lh = parseFloat(getComputedStyle(prim).lineHeight) || parseFloat(getComputedStyle(prim).fontSize) * 1.4 || 20
          if (Math.min(hPrim, hPrev) < lh * 1.6) avisos.push({ tipo: 'bloque-partido', nivel: 'aviso', mensaje: `Un bloque se parte entre las páginas ${i} y ${i + 1} y deja solo un trocito en la ${hPrim < hPrev ? 'segunda' : 'primera'} (acórtalo o pártelo tú)`, linea: lineaDe(prim) })
        }
        if (fondo > cr.bottom + 3) avisos.push({ tipo: 'se-sale-por-abajo', nivel: 'error', mensaje: 'El contenido se sale por abajo de la página (un bloque demasiado alto que no se puede partir)', linea: lineaDe(hijos.find((c) => c.getBoundingClientRect().bottom > cr.bottom + 3) ?? null) })
      }
      if (deck && p.classList.contains('overflow')) avisos.push({ tipo: 'no-cabe', nivel: 'error', mensaje: 'La diapositiva no cabe: sobra contenido (recorta o pártela en dos)', linea: Number(p.dataset.line) || undefined })
      // Algo que se sale por la derecha (tablas anchas, enlaces largos, imágenes).
      for (const el of cuerpo.querySelectorAll<HTMLElement>('table, pre, img, .bx, p, li, figure')) {
        const r = el.getBoundingClientRect()
        if (r.width && (r.right > cr.right + 4 || el.scrollWidth > el.clientWidth + 4)) {
          avisos.push({ tipo: 'se-sale-por-la-derecha', nivel: 'error', mensaje: `${el.tagName === 'TABLE' ? 'Una tabla' : el.tagName === 'IMG' ? 'Una imagen' : 'Un bloque'} se sale por la derecha`, linea: lineaDe(el) })
          break
        }
      }
      // Diagramas y SVG: si para caber se encogen tanto que el texto no se lee.
      for (const fig of p.querySelectorAll<HTMLElement>('.bx-mermaid, .bx-svg')) {
        const svg = fig.querySelector('svg')
        if (!svg) continue
        // Letra efectiva = su tamaño en el dibujo × lo que se ha encogido el dibujo para caber.
        // (el SVG puede ocupar todo el ancho pero quedar limitado por el alto: manda lo que más encoja)
        const vb = svg.viewBox?.baseVal
        const sr = svg.getBoundingClientRect()
        const escala = vb && vb.width && vb.height ? Math.min(sr.width / vb.width, sr.height / vb.height) : 1
        const tamaños = [...svg.querySelectorAll('text, foreignObject span, foreignObject div')]
          .filter((t) => (t.textContent ?? '').trim())
          .map((t) => parseFloat(getComputedStyle(t).fontSize) * escala)
          .filter((h) => h > 0)
          .sort((x, y) => x - y)
        if (!tamaños.length) continue
        const mediana = tamaños[Math.floor(tamaños.length / 2)]
        // Comparada con la letra del texto normal: por debajo de ~65 % ya cuesta leerla.
        const base = parseFloat(getComputedStyle(cuerpo.querySelector('p') ?? cuerpo).fontSize) || 14
        if (mediana < base * 0.65)
          avisos.push({ tipo: 'diagrama-ilegible', nivel: 'error', mensaje: `El texto del ${fig.classList.contains('bx-svg') ? 'dibujo' : 'diagrama'} sale diminuto (${Math.round((mediana / base) * 100)} % de la letra del texto): es demasiado ancho o alto para la página. Menos nodos, etiquetas más cortas, o cambia la dirección (flowchart TD ↔ LR); en secuencias, menos participantes o mensajes más cortos`, linea: lineaDe(fig) })
      }
      // Diagramas muy altos y estrechos: letra pequeña y mucho hueco a los lados.
      if (!deck)
        for (const fig of p.querySelectorAll<HTMLElement>('.bx-mermaid, .bx-svg')) {
          const svg = fig.querySelector('svg')
          const vb = svg?.viewBox?.baseVal
          if (!svg || !vb?.width || !vb.height) continue
          // Lo que ocupa el dibujo de verdad (no la caja del SVG, que puede ir a todo el ancho).
          const sr = svg.getBoundingClientRect()
          const z = Math.min(sr.width / vb.width, sr.height / vb.height)
          if (vb.width * z < cr.width * 0.55 && vb.height * z > cr.height * 0.4)
            avisos.push({ tipo: 'diagrama-estrecho', nivel: 'aviso', mensaje: 'Diagrama muy alto y estrecho: deja mucho hueco a los lados y la letra sale pequeña. Prueba flowchart LR o agrupa pasos', linea: lineaDe(fig) })
        }
      // Texto con poco contraste con su fondo (p. ej. un enlace oscuro sobre una caja oscura).
      for (const el of p.querySelectorAll<HTMLElement>('a, strong, em, code, span.ic + span, td, li, p')) {
        if (!(el.textContent ?? '').trim() || el.closest('svg, .pg-cab, .pg-pie')) continue
        const ratio = contraste(getComputedStyle(el).color, fondoDe(el))
        if (ratio !== null && ratio < 3) {
          avisos.push({ tipo: 'poco-contraste', nivel: 'error', mensaje: `Texto con poco contraste con su fondo (${ratio.toFixed(1)}:1): «${(el.textContent ?? '').trim().slice(0, 40)}» no se lee bien`, linea: lineaDe(el) })
          break
        }
      }
      // Fotos con poca resolución para el tamaño al que salen: borrosas al imprimir.
      for (const img of cuerpo.querySelectorAll('img')) {
        const w = img.getBoundingClientRect().width / (Number((document.querySelector('#root > div') as HTMLElement | null)?.style.zoom) || 1)
        if (img.naturalWidth && w > 120 && img.naturalWidth < w * 1.3) {
          avisos.push({ tipo: 'imagen-baja-resolucion', nivel: 'aviso', mensaje: `Imagen de ${img.naturalWidth} px mostrada a ${Math.round(w)} px: se verá borrosa al imprimir (ponla más pequeña con {width=…} o busca otra)`, linea: lineaDe(img) })
          break
        }
      }
      for (const img of p.querySelectorAll('img'))
        if (img.complete && img.naturalWidth === 0 && !img.closest('.pg-cab')) avisos.push({ tipo: 'imagen-rota', nivel: 'error', mensaje: `No se ve la imagen «${img.getAttribute('data-src') ?? img.getAttribute('src') ?? ''}»`, linea: lineaDe(img) })
      for (const h of p.querySelectorAll<HTMLElement>('.bx-hueco')) avisos.push({ tipo: 'hueco-sin-rellenar', nivel: 'aviso', mensaje: `Hueco «${h.dataset.hueco ?? ''}» sin rellenar`, linea: lineaDe(h) })
      return { n: i + 1, portada, bloques, llenado: Math.round(llenado * 100) / 100, titulos, avisos }
    })
  }
}

/**
 * Mosaico: copias reducidas de las páginas `desde`…`hasta` en una rejilla, con su número, encima de
 * todo. Devuelve el rectángulo que fotografiar; `quitarMosaico()` lo deshace.
 */
export function montarMosaico(desde: number, hasta: number, cols: number, anchoTotal: number): { width: number; height: number } | null {
  quitarMosaico()
  const ps = paginas().slice(desde - 1, hasta)
  if (!ps.length) return null
  const gap = 10
  const w0 = ps[0].offsetWidth
  const h0 = ps[0].offsetHeight
  const tw = Math.floor((anchoTotal - gap * (cols + 1)) / cols)
  const z = tw / w0
  const th = Math.ceil(h0 * z)
  const filas = Math.ceil(ps.length / cols)
  const cont = document.createElement('div')
  cont.id = 'mosaico'
  cont.style.cssText = `position:fixed;left:0;top:0;z-index:999999;background:#c9d1db;width:${anchoTotal}px;height:${filas * (th + gap + 18) + gap}px;font:600 13px Calibri,sans-serif;color:#1c2a3b`
  ps.forEach((p, k) => {
    const x = gap + (k % cols) * (tw + gap)
    const y = gap + Math.floor(k / cols) * (th + gap + 18)
    const etiqueta = document.createElement('div')
    etiqueta.textContent = String(desde + k)
    etiqueta.style.cssText = `position:absolute;left:${x}px;top:${y}px;height:16px`
    const marco = document.createElement('div')
    marco.style.cssText = `position:absolute;left:${x}px;top:${y + 18}px;width:${tw}px;height:${th}px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25)`
    const copia = p.cloneNode(true) as HTMLElement
    copia.style.cssText += `;margin:0;transform:scale(${z});transform-origin:0 0;width:${w0}px;height:${h0}px`
    marco.appendChild(copia)
    cont.append(etiqueta, marco)
  })
  document.body.appendChild(cont)
  scrollTo(0, 0)
  return { width: anchoTotal, height: filas * (th + gap + 18) + gap }
}

export function quitarMosaico(): void {
  document.getElementById('mosaico')?.remove()
}
