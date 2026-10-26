import MarkdownIt from 'markdown-it'

/**
 * Lectura del Markdown de Búho Docs (lo que no depende de cómo se pinta): bloques `::: nombre` con
 * columnas (+++), `\\pagebreak`, atributos `{…}` al final de títulos y párrafos, y la línea de cada
 * bloque. La usan la vista previa (que luego lo pinta en HTML) y la exportación a Word.
 */

interface LineEnv {
  lineOffset?: number
}

export function parseAttrs(s: string): { classes: string[]; id?: string; kv: Record<string, string> } {
  const out = { classes: [] as string[], id: undefined as string | undefined, kv: {} as Record<string, string> }
  for (const m of s.matchAll(/([.#])([\w-]+)|([\w-]+)=(?:"([^"]*)"|'([^']*)'|(\S+))|(\S+)/g)) {
    if (m[1] === '.') out.classes.push(m[2])
    else if (m[1] === '#') out.id = m[2]
    else if (m[3]) out.kv[m[3].toLowerCase()] = m[4] ?? m[5] ?? m[6] ?? ''
    else if (m[7]) out.classes.push(`is-${m[7].toLowerCase()}`)
  }
  return out
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function newBuhoMd(): MarkdownIt {
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
    const off = (state.env as LineEnv).lineOffset ?? 0
    for (const t of state.tokens)
      if (t.block && t.map && t.nesting !== -1) {
        t.attrSet('data-line', String(t.map[0] + 1 + off))
        // Última línea del bloque: la edición visual sustituye exactamente esas líneas.
        t.attrSet('data-end', String(t.map[1] + off))
      }
  })


  return md
}
