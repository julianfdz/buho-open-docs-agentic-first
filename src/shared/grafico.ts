/**
 * Gráficos desde tablas: `::: grafico columnas|barras|lineas|area|tarta|donut [titulo="…"] [unidad=%]`
 * con una tabla Markdown dentro (primera columna = categorías, las demás = series). Se dibujan en SVG
 * para la vista y el PDF; Word y PowerPoint los reciben como gráficos nativos (editables).
 */
export type TipoGrafico = 'columnas' | 'barras' | 'lineas' | 'area' | 'tarta' | 'donut'

export interface DatosGrafico {
  tipo: TipoGrafico
  titulo?: string
  unidad?: string
  categorias: string[]
  series: { nombre: string; valores: (number | null)[] }[]
}

export const TIPOS_GRAFICO: TipoGrafico[] = ['columnas', 'barras', 'lineas', 'area', 'tarta', 'donut']
const ALIAS: Record<string, TipoGrafico> = { columna: 'columnas', column: 'columnas', barra: 'barras', bar: 'barras', bars: 'barras', linea: 'lineas', line: 'lineas', lines: 'lineas', areas: 'area', pie: 'tarta', quesito: 'tarta', circular: 'tarta', dona: 'donut', anillo: 'donut' }

/** Paleta categórica en orden fijo (validada: daltonismo y separación en papel blanco). */
export const PALETA = ['#00A39B', '#2F6BD8', '#D9822B', '#C9455A', '#9B59C9', '#5E9C3A']
const TINTA = '#1c2a3b'
const TINTA2 = '#5d6b7c'
const REJILLA = '#e3e8ee'

/** «1.234,5 €», «35 %», «-2,1» → número (formato español; también admite 1,234.5). */
export function parseNumero(s: string): number | null {
  let t = s.replace(/[^\d,.\-−]/g, '').replace('−', '-')
  if (!/\d/.test(t)) return null
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (t.includes(',')) t = t.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function tipoGrafico(s: string | undefined): TipoGrafico {
  const k = (s ?? '').toLowerCase()
  return (TIPOS_GRAFICO as string[]).includes(k) ? (k as TipoGrafico) : ALIAS[k] ?? 'columnas'
}

/** Datos de una tabla (cabecera + filas de texto). La unidad se deduce de las celdas si no se da. */
export function datosDeTabla(cabecera: string[], filas: string[][], tipo: TipoGrafico, titulo?: string, unidad?: string): DatosGrafico | null {
  if (cabecera.length < 2 || !filas.length) return null
  const series = cabecera.slice(1).map((nombre, k) => ({ nombre: nombre.trim(), valores: filas.map((f) => parseNumero(f[k + 1] ?? '')) }))
  if (!series.some((s) => s.valores.some((v) => v !== null))) return null
  const u = unidad ?? (filas.every((f) => /%\s*$/.test(f[1] ?? '')) ? '%' : filas.every((f) => /€\s*$/.test(f[1] ?? '')) ? '€' : undefined)
  return { tipo, titulo, unidad: u, categorias: filas.map((f) => f[0].trim()), series: tipo === 'tarta' || tipo === 'donut' ? series.slice(0, 1) : series.slice(0, PALETA.length) }
}

// ─── SVG ──────────────────────────────────────────────────────────────────────────────────────
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (n: number, u?: string): string => {
  const s = Math.abs(n) >= 1000 ? n.toLocaleString('es-ES', { maximumFractionDigits: 0 }) : n.toLocaleString('es-ES', { maximumFractionDigits: 1 })
  return u ? (u === '€' ? `${s} €` : u === '%' ? `${s} %` : `${s} ${u}`) : s
}
/** Escala «bonita»: máximo y paso redondos. */
function escala(max: number, min: number): { lo: number; hi: number; paso: number } {
  const lo = Math.min(0, min)
  const rango = Math.max(max, 0) - lo || 1
  const bruto = rango / 5
  const mag = 10 ** Math.floor(Math.log10(bruto))
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? 10 * mag
  return { lo: Math.floor(lo / paso) * paso, hi: Math.ceil(Math.max(max, 0) / paso) * paso || paso, paso }
}
const recortar = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Barra con el extremo de datos redondeado (4 px) y la base recta, anclada a la línea de base. */
function barra(x: number, y: number, w: number, h: number, vertical: boolean, positivo: boolean, color: string, tip: string): string {
  const r = Math.min(4, (vertical ? w : h) / 2, (vertical ? h : w) / 2)
  let d: string
  if (vertical) {
    d = positivo
      ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
      : `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`
  } else {
    d = positivo
      ? `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
      : `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`
  }
  return `<path d="${d}" fill="${color}"><title>${esc(tip)}</title></path>`
}

export function svgGrafico(d: DatosGrafico, ancho = 640): string {
  const n = d.categorias.length
  const ns = d.series.length
  const leyenda = ns > 1 && d.tipo !== 'tarta' && d.tipo !== 'donut'
  const top = (d.titulo ? 30 : 8) + (leyenda ? 24 : 0)
  const txt = (x: number, y: number, s: string, o: { anchor?: string; color?: string; size?: number; weight?: number } = {}): string =>
    `<text x="${x}" y="${y}" text-anchor="${o.anchor ?? 'start'}" fill="${o.color ?? TINTA2}" font-size="${o.size ?? 11}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`
  const partes: string[] = []
  if (d.titulo) partes.push(txt(0, 16, d.titulo, { color: TINTA, size: 14, weight: 700 }))
  if (leyenda) {
    let x = 0
    const y = (d.titulo ? 30 : 8) + 10
    d.series.forEach((s, k) => {
      partes.push(`<rect x="${x}" y="${y - 8}" width="10" height="10" rx="2" fill="${PALETA[k]}"/>`, txt(x + 15, y + 1, s.nombre, { color: TINTA }))
      x += 15 + s.nombre.length * 6.4 + 18
    })
  }
  const todos = d.series.flatMap((s) => s.valores.filter((v): v is number => v !== null))
  const max = Math.max(...todos)
  const min = Math.min(...todos)
  const etiquetas = n * ns <= 14

  // Tarta y donut: porciones con etiqueta directa (categoría y valor).
  if (d.tipo === 'tarta' || d.tipo === 'donut') {
    const vals = d.series[0].valores.map((v) => Math.max(0, v ?? 0))
    const total = vals.reduce((a, b) => a + b, 0) || 1
    // Estrecho (en una columna): la tarta arriba y la leyenda debajo.
    const estrecho = ancho < 520
    const R = estrecho ? Math.min(105, ancho / 2 - 20) : 105
    const alto = 2 * R + 30
    const cx = estrecho ? ancho / 2 : 130
    const cy = top + alto / 2
    const ri = d.tipo === 'donut' ? 58 : 0
    let a0 = -Math.PI / 2
    vals.forEach((v, k) => {
      const a1 = a0 + (v / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const p = (a: number, r: number): string => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
      const path = ri ? `M${p(a0, R)}A${R},${R} 0 ${large} 1 ${p(a1, R)}L${p(a1, ri)}A${ri},${ri} 0 ${large} 0 ${p(a0, ri)}Z` : `M${cx},${cy}L${p(a0, R)}A${R},${R} 0 ${large} 1 ${p(a1, R)}Z`
      // Separación de 2 px del color del fondo entre porciones.
      partes.push(`<path d="${path}" fill="${PALETA[k % PALETA.length]}" stroke="#fff" stroke-width="2"><title>${esc(`${d.categorias[k]}: ${fmt(v, d.unidad)} (${Math.round((v / total) * 100)} %)`)}</title></path>`)
      a0 = a1
    })
    const lx = estrecho ? 0 : 270
    const ly = estrecho ? top + alto + 8 : top + 20
    vals.forEach((v, k) => {
      const y = ly + k * 24
      partes.push(`<rect x="${lx}" y="${y - 9}" width="11" height="11" rx="2" fill="${PALETA[k % PALETA.length]}"/>`, txt(lx + 18, y, recortar(d.categorias[k], 32), { color: TINTA }), txt(ancho, y, `${d.unidad === '%' ? fmt(v, d.unidad) : `${fmt(v, d.unidad)} · ${Math.round((v / total) * 100)} %`}`, { anchor: 'end', color: TINTA2 }))
    })
    if (ri) partes.push(txt(cx, cy + 5, fmt(total, d.unidad), { anchor: 'middle', color: TINTA, size: 15, weight: 700 }))
    const h = estrecho ? ly + n * 24 : Math.max(top + alto, top + 20 + n * 24)
    return wrap(partes, ancho, h + 6, d)
  }

  // Barras horizontales: una fila por categoría.
  if (d.tipo === 'barras') {
    const izq = Math.min(170, 12 + Math.max(...d.categorias.map((c) => c.length)) * 6.2)
    const fila = Math.max(22, ns * 14 + 10)
    const plotW = ancho - izq - 50
    const { lo, hi, paso } = escala(max, min)
    const X = (v: number): number => izq + ((v - lo) / (hi - lo)) * plotW
    const h = top + n * fila + 22
    for (let v = lo; v <= hi + 1e-9; v += paso) partes.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${top}" y2="${top + n * fila}" stroke="${v === 0 ? '#c3ccd6' : REJILLA}"/>`, txt(X(v), top + n * fila + 15, fmt(v, d.unidad), { anchor: 'middle', size: 10 }))
    const bh = (fila - 10 - (ns - 1) * 2) / ns
    d.categorias.forEach((c, i) => {
      const y0 = top + i * fila + 5
      partes.push(txt(izq - 8, y0 + (fila - 10) / 2 + 4, recortar(c, 28), { anchor: 'end', color: TINTA }))
      d.series.forEach((s, k) => {
        const v = s.valores[i]
        if (v === null) return
        const y = y0 + k * (bh + 2)
        const x0 = X(0)
        const x1 = X(v)
        partes.push(barra(Math.min(x0, x1), y, Math.max(1, Math.abs(x1 - x0)), bh, false, v >= 0, PALETA[k], `${c} · ${s.nombre}: ${fmt(v, d.unidad)}`))
        if (etiquetas) partes.push(txt(v >= 0 ? x1 + 5 : x1 - 5, y + bh / 2 + 4, fmt(v, d.unidad), { anchor: v >= 0 ? 'start' : 'end', color: TINTA, size: 10 }))
      })
    })
    return wrap(partes, ancho, h, d)
  }

  // Columnas, líneas y área: categorías en horizontal, una escala de valores.
  const alto = 200
  const izq = 46
  const plotW = ancho - izq - 8
  const { lo, hi, paso } = escala(max, min)
  const Y = (v: number): number => top + alto - ((v - lo) / (hi - lo)) * alto
  for (let v = lo; v <= hi + 1e-9; v += paso) partes.push(`<line x1="${izq}" x2="${ancho - 8}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? '#c3ccd6' : REJILLA}"/>`, txt(izq - 6, Y(v) + 4, fmt(v, d.unidad), { anchor: 'end', size: 10 }))
  const banda = plotW / n
  const cada = Math.ceil((n * 7 * Math.min(14, Math.max(...d.categorias.map((c) => c.length)))) / plotW)
  d.categorias.forEach((c, i) => {
    if (i % cada === 0) partes.push(txt(izq + banda * i + banda / 2, top + alto + 16, recortar(c, Math.max(6, Math.floor(banda / 6.2) * cada)), { anchor: 'middle', color: TINTA }))
  })
  if (d.tipo === 'columnas') {
    const grupo = Math.min(banda * 0.7, ns * 34)
    const bw = (grupo - (ns - 1) * 2) / ns
    d.categorias.forEach((c, i) => {
      d.series.forEach((s, k) => {
        const v = s.valores[i]
        if (v === null) return
        const x = izq + banda * i + (banda - grupo) / 2 + k * (bw + 2)
        const y0 = Y(0)
        const y1 = Y(v)
        partes.push(barra(x, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)), true, v >= 0, PALETA[k], `${c} · ${s.nombre}: ${fmt(v, d.unidad)}`))
        if (etiquetas) partes.push(txt(x + bw / 2, v >= 0 ? y1 - 5 : y1 + 13, fmt(v, d.unidad), { anchor: 'middle', color: TINTA, size: 10 }))
      })
    })
  } else {
    d.series.forEach((s, k) => {
      const pts = s.valores.map((v, i) => (v === null ? null : [izq + banda * i + banda / 2, Y(v)] as const))
      const tramos: (readonly [number, number])[][] = [[]]
      for (const p of pts) p ? tramos[tramos.length - 1].push(p) : tramos.push([])
      for (const t of tramos.filter((x) => x.length)) {
        const line = t.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
        if (d.tipo === 'area') partes.push(`<path d="${line}L${t[t.length - 1][0]},${Y(Math.max(lo, 0))}L${t[0][0]},${Y(Math.max(lo, 0))}Z" fill="${PALETA[k]}" fill-opacity="${ns > 1 ? 0.18 : 0.25}"/>`)
        partes.push(`<path d="${line}" fill="none" stroke="${PALETA[k]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
      }
      pts.forEach((p, i) => {
        if (!p) return
        partes.push(`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${PALETA[k]}" stroke="#fff" stroke-width="2"><title>${esc(`${d.categorias[i]} · ${s.nombre}: ${fmt(s.valores[i]!, d.unidad)}`)}</title></circle>`)
      })
      // Etiqueta directa: el último valor de cada serie.
      const last = [...pts].reverse().find(Boolean)
      const lv = [...s.valores].reverse().find((v) => v !== null)
      if (last && lv !== undefined && lv !== null && (etiquetas || ns <= 4)) partes.push(txt(last[0], last[1] - 9, fmt(lv, d.unidad), { anchor: 'middle', color: TINTA, size: 10, weight: 600 }))
    })
  }
  return wrap(partes, ancho, top + alto + 24, d)
}

function wrap(partes: string[], w: number, h: number, d: DatosGrafico): string {
  const alt = `${d.titulo ? d.titulo + '. ' : ''}${d.series.map((s) => `${s.nombre}: ${d.categorias.map((c, i) => `${c} ${s.valores[i] ?? '—'}`).join(', ')}`).join('. ')}`
  return `<svg class="grafico-svg" viewBox="0 0 ${w} ${Math.ceil(h)}" role="img" aria-label="${esc(alt)}" xmlns="http://www.w3.org/2000/svg" style="font-family:var(--sans, Calibri, sans-serif)">${partes.join('')}</svg>`
}
