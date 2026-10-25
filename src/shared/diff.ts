/**
 * Diferencias por líneas (Myers). Sirve para resaltar lo que ha cambiado la IA, para el historial
 * y para `buho-docs history --diff`.
 */

export type Op = { t: '=' | '+' | '-'; a: number; b: number; text: string }

export function diffLines(before: string, after: string): Op[] {
  const A = before.split(/\r?\n/)
  const B = after.split(/\r?\n/)
  // Prefijo y sufijo comunes fuera: casi siempre el cambio es pequeño.
  let pre = 0
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++
  let suf = 0
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++
  const a = A.slice(pre, A.length - suf)
  const b = B.slice(pre, B.length - suf)
  const mid = myers(a, b).map((o) => ({ ...o, a: o.a + pre, b: o.b + pre }))
  const head: Op[] = A.slice(0, pre).map((text, i) => ({ t: '=', a: i, b: i, text }))
  const tail: Op[] = A.slice(A.length - suf).map((text, i) => ({ t: '=', a: A.length - suf + i, b: B.length - suf + i, text }))
  return [...head, ...mid, ...tail]
}

function myers(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  if (!n) return b.map((text, j) => ({ t: '+', a: 0, b: j, text }))
  if (!m) return a.map((text, i) => ({ t: '-', a: i, b: 0, text }))
  // Documentos enormes muy distintos: todo fuera / todo dentro (evita memoria cuadrática).
  if (n * m > 25_000_000) return [...a.map((text, i): Op => ({ t: '-', a: i, b: 0, text })), ...b.map((text, j): Op => ({ t: '+', a: n, b: j, text }))]
  const max = n + m
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[max + k] = x
      if (x >= n && y >= m) break outer
    }
  }
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vv = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vv[max + k - 1] < vv[max + k + 1]) ? k + 1 : k - 1
    const px = vv[max + prevK]
    const py = px - prevK
    while (x > px && y > py) ops.push({ t: '=', a: --x, b: --y, text: a[x] })
    if (d > 0) {
      if (x === px) ops.push({ t: '+', a: x, b: --y, text: b[y] })
      else ops.push({ t: '-', a: --x, b: y, text: a[x] })
    }
  }
  return ops.reverse()
}

export function diffStats(ops: Op[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const o of ops) {
    if (o.t === '+') added++
    else if (o.t === '-') removed++
  }
  return { added, removed }
}

/** Líneas (0) del texto nuevo que han cambiado o son nuevas; si solo se borró, la línea donde estaba. */
export function changedLines(before: string, after: string): number[] {
  const out = new Set<number>()
  for (const o of diffLines(before, after)) {
    if (o.t === '+') out.add(o.b)
    else if (o.t === '-') out.add(Math.max(0, o.b))
  }
  return [...out].sort((x, y) => x - y)
}

export interface Hunk {
  /** Línea (1) en el texto anterior y en el nuevo. */
  aLine: number
  bLine: number
  ops: Op[]
}

/** Agrupa las diferencias en bloques con `context` líneas iguales alrededor (como `git diff`). */
export function hunks(ops: Op[], context = 2): Hunk[] {
  const out: Hunk[] = []
  let cur: Hunk | null = null
  let lastChange = -Infinity
  ops.forEach((o, i) => {
    if (o.t === '=') return
    if (!cur || i - lastChange > context * 2 + 1) {
      const from = Math.max(0, i - context)
      cur = { aLine: ops[from].a + 1, bLine: ops[from].b + 1, ops: ops.slice(from, i) }
      out.push(cur)
    } else cur.ops.push(...ops.slice(lastChange + 1, i))
    cur.ops.push(o)
    lastChange = i
  })
  for (const h of out) {
    const lastIdx = ops.indexOf(h.ops[h.ops.length - 1])
    h.ops.push(...ops.slice(lastIdx + 1, lastIdx + 1 + context).filter((o) => o.t === '='))
  }
  return out
}

/** Diferencias en texto, estilo `diff -u` reducido. */
export function unified(before: string, after: string, context = 2): string {
  return hunks(diffLines(before, after), context)
    .map((h) => [`@@ línea ${h.bLine} @@`, ...h.ops.map((o) => `${o.t === '=' ? ' ' : o.t} ${o.text}`)].join('\n'))
    .join('\n')
}
