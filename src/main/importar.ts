import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import mammoth from 'mammoth'
import TurndownService from 'turndown'
// @ts-expect-error sin tipos
import { gfm } from 'turndown-plugin-gfm'

/**
 * Importar documentos de fuera a nuestro formato (Markdown + cabecera), sin IA y en segundos:
 *   .docx      → mammoth (títulos, listas, tablas, negritas, enlaces e imágenes) → Markdown
 *   .pdf       → pdfjs: líneas con su tamaño de letra; títulos por tamaño, sin cabeceras, pies ni números
 *   .html/.htm → Markdown
 *   .txt/.md   → tal cual (con cabecera)
 * El aspecto lo pone el tema elegido: la maquetación exacta del original no se conserva (a propósito).
 * Por defecto se guarda en Documentos\Buho Docs, nunca junto al original.
 */
export interface Importado {
  path: string
  titulo: string
  palabras: number
  imagenes: number
  secciones: string[]
  avisos: string[]
  ms: number
}

const q = (s: string): string => JSON.stringify(s)

function turndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**', codeBlockStyle: 'fenced' })
  td.use(gfm)
  // Los anclajes vacíos de Word (marcadores) no aportan nada.
  td.addRule('anclas', { filter: (n) => n.nodeName === 'A' && !(n as HTMLElement).getAttribute('href'), replacement: (c) => c })
  return td
}

/** Una tabla de Word sin fila de cabecera (<th>) también debe salir como tabla Markdown. */
function cabecerasDeTabla(html: string): string {
  return html.replace(/<table>\s*(?:<tbody>)?\s*<tr>([\s\S]*?)<\/tr>/g, (m, row: string) => (/<th[\s>]/.test(row) ? m : m.replace(row, row.replace(/<td([\s>])/g, '<th$1').replace(/<\/td>/g, '</th>'))))
}

async function desdeDocx(src: string, imgDir: string, outDir: string, avisos: string[]): Promise<{ md: string; imagenes: number }> {
  let n = 0
  const r = await mammoth.convertToHtml(
    { path: src },
    {
      styleMap: ["p[style-name='Title'] => h1.titulo:fresh", "p[style-name='Título'] => h1.titulo:fresh", "p[style-name='Subtitle'] => p.subtitulo:fresh", "p[style-name='Subtítulo'] => p.subtitulo:fresh"],
      convertImage: mammoth.images.imgElement(async (img) => {
        const ext = (img.contentType.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
        mkdirSync(imgDir, { recursive: true })
        const file = join(imgDir, `imagen-${++n}.${ext}`)
        writeFileSync(file, Buffer.from(await img.read('base64'), 'base64'))
        return { src: relative(outDir, file).replace(/\\/g, '/') }
      })
    }
  )
  for (const m of r.messages) if (m.type === 'warning' && !/Unrecognised (paragraph|run) style/.test(m.message)) avisos.push(m.message)
  return { md: turndown().turndown(cabecerasDeTabla(r.value)), imagenes: n }
}

interface Linea {
  text: string
  size: number
  bold: boolean
  y: number
  x: number
  page: number
}

async function desdePdf(src: string, avisos: string[]): Promise<{ md: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(src))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise
  const lineas: Linea[] = []
  const alto: number[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    alto.push(vp.height)
    const tc = await page.getTextContent()
    const styles = tc.styles as Record<string, { fontFamily?: string }>
    // Agrupar por línea (misma y redondeada), de izquierda a derecha.
    const filas = new Map<number, { x: number; str: string; size: number; bold: boolean }[]>()
    for (const it of tc.items as { str: string; transform: number[]; fontName: string; hasEOL?: boolean }[]) {
      if (!it.str) continue
      const size = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10
      const y = Math.round(vp.height - it.transform[5])
      const key = [...filas.keys()].find((k) => Math.abs(k - y) <= Math.max(2, size * 0.3)) ?? y
      const fam = (styles[it.fontName]?.fontFamily ?? '') + it.fontName
      if (!filas.has(key)) filas.set(key, [])
      filas.get(key)!.push({ x: it.transform[4], str: it.str, size, bold: /bold|black|heavy|semibold/i.test(fam) })
    }
    for (const [y, items] of [...filas.entries()].sort((a, b) => a[0] - b[0])) {
      items.sort((a, b) => a.x - b.x)
      const text = items
        .map((i) => i.str)
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) continue
      const size = Math.max(...items.map((i) => i.size))
      lineas.push({ text, size, bold: items.every((i) => i.bold || !i.str.trim()), y, x: items[0].x, page: p })
    }
  }
  if (!lineas.length) {
    avisos.push('El PDF no tiene texto (¿escaneado?): haría falta OCR')
    return { md: '' }
  }
  // Cabeceras y pies: textos que se repiten arriba o abajo en muchas páginas (sin contar números).
  const norm = (t: string): string => t.replace(/\d+/g, '#').toLowerCase()
  const bordes = new Map<string, Set<number>>()
  for (const l of lineas) {
    const h = alto[l.page - 1]
    if (l.y < h * 0.1 || l.y > h * 0.9) {
      const k = norm(l.text)
      if (!bordes.has(k)) bordes.set(k, new Set())
      bordes.get(k)!.add(l.page)
    }
  }
  const repetidos = new Set([...bordes.entries()].filter(([, pages]) => pages.size >= Math.max(2, doc.numPages * 0.4)).map(([k]) => k))
  const limpias = lineas.filter((l) => {
    const h = alto[l.page - 1]
    const borde = l.y < h * 0.1 || l.y > h * 0.9
    if (borde && repetidos.has(norm(l.text))) return false
    if (borde && /^(p[aá]g(ina)?\.?\s*)?\d+(\s*(\/|de)\s*\d+)?$/i.test(l.text)) return false
    return true
  })
  if (repetidos.size) avisos.push(`Quitadas ${repetidos.size} cabeceras o pies repetidos`)
  // Tamaño del texto normal: el que más letras tiene.
  const porTam = new Map<number, number>()
  for (const l of limpias) porTam.set(l.size, (porTam.get(l.size) ?? 0) + l.text.length)
  const cuerpo = [...porTam.entries()].sort((a, b) => b[1] - a[1])[0][0]
  // Tamaños de título, de mayor a menor → #, ##, ###.
  const tit = [...porTam.keys()].filter((s) => s >= cuerpo * 1.25).sort((a, b) => b - a)
  const nivel = (l: Linea): number => {
    const i = tit.indexOf(l.size)
    // Solo por tamaño de letra: la negrita marcaba como título filas de tablas.
    // Un «título» de más de 110 letras es un recuadro de texto destacado, no un título.
    if (i >= 0 && l.text.length <= 110) return Math.min(4, i + 1 + (tit.length >= 3 ? 0 : 1))
    return 0
  }
  const out: string[] = []
  let par = ''
  let prev: Linea | null = null
  const cerrar = (): void => {
    if (par) out.push(par.trim())
    par = ''
  }
  for (const l of limpias) {
    const lv = nivel(l)
    const salto = prev && (l.page !== prev.page || l.y - prev.y > l.size * 1.9)
    if (lv) {
      cerrar()
      // Un título partido en dos líneas seguidas del mismo tamaño se une.
      const ultimo = out[out.length - 1]
      if (prev && nivel(prev) === lv && !salto && ultimo?.startsWith('#')) out[out.length - 1] = ultimo + ' ' + l.text
      else out.push('#'.repeat(lv) + ' ' + l.text)
    } else if (/^[•·▪◦‣–-]\s*/.test(l.text)) {
      cerrar()
      par = '- ' + l.text.replace(/^[•·▪◦‣–-]\s*/, '')
    } else {
      if (salto) cerrar()
      par = par ? (par.endsWith('-') ? par.slice(0, -1) + l.text : par + ' ' + l.text) : l.text
    }
    prev = l
  }
  cerrar()
  return { md: out.join('\n\n') }
}

export async function importar(src: string, opts: { salida?: string; tema?: string } = {}): Promise<Importado> {
  const t0 = Date.now()
  if (!existsSync(src)) throw new Error(`No existe ${src}`)
  const ext = extname(src).toLowerCase()
  const nombre = basename(src, extname(src))
  const out = opts.salida ?? join(app.getPath('documents'), 'Buho Docs', `${nombre}.md`)
  if (existsSync(out)) throw new Error(`Ya existe ${out}: elige otro nombre con --salida`)
  const outDir = dirname(out)
  mkdirSync(outDir, { recursive: true })
  const avisos: string[] = []
  let md = ''
  let imagenes = 0
  if (ext === '.docx') {
    const r = await desdeDocx(src, join(outDir, `${basename(out, '.md')} (imágenes)`), outDir, avisos)
    md = r.md
    imagenes = r.imagenes
  } else if (ext === '.pdf') md = (await desdePdf(src, avisos)).md
  else if (ext === '.html' || ext === '.htm') md = turndown().turndown(cabecerasDeTabla(readFileSync(src, 'utf8')))
  else if (ext === '.txt' || ext === '.md' || ext === '.markdown') md = readFileSync(src, 'utf8').replace(/^\uFEFF/, '')
  else if (ext === '.doc') throw new Error('El formato .doc antiguo no se puede leer: ábrelo en Word o LibreOffice y guárdalo como .docx')
  else throw new Error(`No sé importar ${ext} (sí: .docx, .pdf, .html, .txt, .md)`)

  // Sin los escapes de turndown en numeraciones («1\. Qué es…»).
  md = md
    .replace(/\r\n/g, '\n')
    .replace(/^(#{1,6} \d+)\\\./gm, '$1.')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // Título: el primero con contenido (en un PDF el primero suele ser la marca); lo de antes sobra.
  let titulo = nombre
  const heads = [...md.matchAll(/^(#{1,2}) (.+)$/gm)].slice(0, 3)
  const h1 = heads.find((h) => h[2].replace(/\*\*/g, '').trim().length >= 12) ?? heads[0]
  if (h1) {
    titulo = h1[2].replace(/\*\*/g, '').trim()
    md = md.slice(md.indexOf(h1[0]) + h1[0].length).trim()
    if (titulo === titulo.toUpperCase()) titulo = titulo.charAt(0) + titulo.slice(1).toLowerCase()
  }
  // Si no quedan secciones ##, los títulos de nivel inferior suben.
  if (!/^## /m.test(md) && /^#{3,4} /m.test(md)) md = md.replace(/^#(#{2,3}) /gm, '$1 ')
  const secciones = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])
  const palabras = (md.match(/[\p{L}\p{N}]+/gu) ?? []).length
  const front = ['---', 'tipo: documento', `tema: ${opts.tema ?? 'blanco'}`, `titulo: ${q(titulo)}`, `importado: ${q(basename(src))}`, '---', ''].join('\n')
  writeFileSync(out, front + '\n' + md + '\n')
  return { path: out, titulo, palabras, imagenes, secciones, avisos, ms: Date.now() - t0 }
}
