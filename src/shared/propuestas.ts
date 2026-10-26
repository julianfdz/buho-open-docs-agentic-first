import { diffLines } from './diff'

/**
 * Cambios propuestos (control de cambios): en vez de escribir, un agente deja una propuesta que el
 * usuario acepta o rechaza. Una propuesta son trozos «estas líneas → estas otras» con una línea de
 * contexto a cada lado, así se puede aplicar aunque el documento haya cambiado en otra parte después.
 */
export interface Trozo {
  /** Línea (1) donde empezaba en el documento cuando se propuso. */
  linea: number
  antes: string[]
  despues: string[]
  /** Línea justo antes y justo después del trozo (null = principio / final del documento). */
  previa: string | null
  siguiente: string | null
}

export interface Propuesta {
  id: string
  at: number
  autor: string
  resumen: string
  trozos: Trozo[]
  /** Comentario que la originó, si viene de «atender comentarios». */
  comentario?: string
}

export interface Comentario {
  id: string
  at: number
  autor: string
  texto: string
  /** Texto exacto al que se refiere (lo seleccionado, o el principio del bloque). */
  cita: string
  /** Lo que se seleccionó en la página (sin sintaxis), si se comentó un trozo concreto. */
  seleccion?: string
  /** Línea (1) donde estaba la cita al comentar (ayuda a encontrarla si aparece varias veces). */
  linea: number
  estado: 'abierto' | 'resuelto'
  respuestas: { autor: string; texto: string; at: number }[]
}

/** Trozos que convierten `antes` en `despues`. */
export function trozos(antes: string, despues: string): Trozo[] {
  const A = antes.split(/\r?\n/)
  const ops = diffLines(antes, despues)
  const out: Trozo[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].t === '=') {
      i++
      continue
    }
    const a0 = ops[i].a
    const t: Trozo = { linea: a0 + 1, antes: [], despues: [], previa: a0 > 0 ? A[a0 - 1] : null, siguiente: null }
    while (i < ops.length && ops[i].t !== '=') {
      if (ops[i].t === '-') t.antes.push(ops[i].text)
      else t.despues.push(ops[i].text)
      i++
    }
    const aEnd = a0 + t.antes.length
    t.siguiente = aEnd < A.length ? A[aEnd] : null
    out.push(t)
  }
  return out
}

/** Dónde está el trozo en `L` ahora (índice 0 de su primera línea), o -1. Prefiere el más cercano a donde estaba. */
function localizar(L: string[], t: Trozo, desde: number): number {
  const n = t.antes.length
  const encaja = (k: number, ctx: boolean): boolean => {
    if (k < 0 || k + n > L.length) return false
    for (let j = 0; j < n; j++) if (L[k + j] !== t.antes[j]) return false
    if (!ctx) return true
    const okPrev = t.previa === null ? k === 0 : L[k - 1] === t.previa
    const okNext = t.siguiente === null ? k + n === L.length : L[k + n] === t.siguiente
    return n ? okPrev || okNext : okPrev && okNext
  }
  const cand: number[] = []
  for (const ctx of [true, false]) {
    if (!n && !ctx) break // una inserción pura necesita su contexto
    for (let k = desde; k <= L.length - n; k++) if (encaja(k, ctx)) cand.push(k)
    if (cand.length) break
  }
  if (!cand.length) return -1
  const objetivo = t.linea - 1
  return cand.reduce((m, k) => (Math.abs(k - objetivo) < Math.abs(m - objetivo) ? k : m))
}

/** Aplica los trozos sobre el documento actual. Los que ya no encajan se devuelven en `fallidos`. */
export function aplicar(actual: string, ts: Trozo[]): { content: string; aplicados: number; fallidos: Trozo[] } {
  let L = actual.split(/\r?\n/)
  const fallidos: Trozo[] = []
  let aplicados = 0
  // De abajo arriba, para que las posiciones de los de arriba no se muevan.
  const orden = [...ts].sort((a, b) => b.linea - a.linea)
  for (const t of orden) {
    const k = localizar(L, t, 0)
    if (k < 0) {
      // ¿Ya estaba aplicado? (el usuario hizo lo mismo a mano)
      if (t.despues.length && localizar(L, { ...t, antes: t.despues }, 0) >= 0) aplicados++
      else fallidos.push(t)
      continue
    }
    L = [...L.slice(0, k), ...t.despues, ...L.slice(k + t.antes.length)]
    aplicados++
  }
  return { content: L.join('\n'), aplicados, fallidos }
}

/** Línea (1) donde está ahora el trozo, para resaltarlo o ir a él; null si ya no está. */
export function lineaActual(actual: string, t: Trozo): number | null {
  const k = localizar(actual.split(/\r?\n/), t, 0)
  return k < 0 ? null : k + 1
}

/** Línea (1) donde está ahora la cita de un comentario (la aparición más cercana a donde estaba). */
export function lineaCita(actual: string, c: Pick<Comentario, 'cita' | 'linea'>): number | null {
  const L = actual.split(/\r?\n/)
  const cita = c.cita.trim().split(/\r?\n/)[0].slice(0, 120)
  if (!cita) return null
  let mejor: number | null = null
  L.forEach((l, i) => {
    if (l.includes(cita) && (mejor === null || Math.abs(i + 1 - c.linea) < Math.abs(mejor - c.linea))) mejor = i + 1
  })
  if (mejor !== null) return mejor
  // La cita puede tener la sintaxis quitada (seleccionada en la vista): se compara sin marcas.
  const limpio = (s: string): string => s.replace(/[*_`~#>[\]()!|]/g, '').replace(/\s+/g, ' ').trim()
  const cl = limpio(cita).slice(0, 80)
  L.forEach((l, i) => {
    if (cl && limpio(l).includes(cl) && (mejor === null || Math.abs(i + 1 - c.linea) < Math.abs(mejor - c.linea))) mejor = i + 1
  })
  return mejor
}
