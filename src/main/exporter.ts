import { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RenderResult } from '@shared/types'

/**
 * Exportar a PDF y comprobar documentos sin tocar la ventana del usuario: una ventana oculta carga la
 * misma página de vista previa (?mode=print), pinta el Markdown y Chromium la imprime con el tamaño
 * de página del CSS (A4 o 16:9). Lo que se ve en la app es lo que sale en el PDF.
 */
let win: BrowserWindow | null = null
let ready: Promise<void> | null = null
let queue: Promise<unknown> = Promise.resolve()

function printWindow(): Promise<void> {
  if (win && !win.isDestroyed() && ready) return ready
  win = new BrowserWindow({
    show: false,
    // Cabe una página A4 (794 × 1123 px) o una diapositiva entera: así se puede fotografiar (snapshot).
    width: 1320,
    height: 1200,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  win.on('closed', () => {
    win = null
    ready = null
  })
  ready =
    process.env.ELECTRON_RENDERER_URL
      ? win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/preview.html?mode=print`)
      : win.loadFile(join(__dirname, '../renderer/preview.html'), { search: 'mode=print' })
  return ready
}

/** Lo que hay pintado ahora mismo en la ventana oculta. */
let shown: { path: string; source: string } | null = null

async function render(source: string, path: string): Promise<RenderResult> {
  await printWindow()
  shown = { path, source }
  const req = JSON.stringify({ source, baseDir: dirname(path) })
  return (await win!.webContents.executeJavaScript(`window.buhoRender(${req})`, true)) as RenderResult
}

/** Las peticiones van de una en una (la ventana oculta es una sola). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => null)
  return run
}

/**
 * PDF en caliente: tras cada cambio se prepara el PDF en segundo plano. Si luego se pide exportar (o
 * comprobar) ese mismo contenido, ya está hecho y solo queda escribirlo.
 */
const cache = new Map<string, { source: string; pdf: Buffer; result: RenderResult }>()
const timers = new Map<string, NodeJS.Timeout>()
const key = (p: string): string => p.toLowerCase()

async function renderAndPrint(source: string, path: string): Promise<{ result: RenderResult; pdf: Buffer; pintar: number; imprimir: number }> {
  const t0 = Date.now()
  const result = await render(source, path)
  const t1 = Date.now()
  const pdf = await win!.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    generateDocumentOutline: true,
    generateTaggedPDF: true
  })
  cache.set(key(path), { source, pdf, result })
  return { result, pdf, pintar: t1 - t0, imprimir: Date.now() - t1 }
}

/** Prepara el PDF de este contenido dentro de `delay` ms (si no llega otro cambio antes). */
export function warm(path: string, source: string, delay = 0): void {
  clearTimeout(timers.get(key(path)))
  timers.set(
    key(path),
    setTimeout(() => {
      timers.delete(key(path))
      if (cache.get(key(path))?.source === source) return
      void serial(() => (cache.get(key(path))?.source === source ? Promise.resolve(null) : renderAndPrint(source, path))).catch(() => null)
    }, delay)
  )
}

export function forget(path: string): void {
  clearTimeout(timers.get(key(path)))
  cache.delete(key(path))
}

export function checkDoc(source: string, path: string): Promise<RenderResult> {
  return serial(async () => {
    const c = cache.get(key(path))
    return c?.source === source ? c.result : (await renderAndPrint(source, path)).result
  })
}

export function exportPdf(source: string, path: string, out: string): Promise<RenderResult & { file: string; bytes: number; caliente: boolean }> {
  clearTimeout(timers.get(key(path)))
  return serial(async () => {
    const c = cache.get(key(path))
    const hot = c?.source === source
    const r = hot ? { result: c!.result, pdf: c!.pdf, pintar: 0, imprimir: 0 } : await renderAndPrint(source, path)
    try {
      writeFileSync(out, r.pdf)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM') throw new Error(`No puedo escribir ${out}: está abierto en otro programa (visor de PDF). Ciérralo o exporta con otro nombre.`)
      throw e
    }
    return { ...r.result, file: out, bytes: r.pdf.length, caliente: hot, timings: { ...r.result.timings, pintar: r.pintar, imprimir: r.imprimir } }
  })
}

/**
 * Foto de una página (o diapositiva) en PNG, para que un agente mire algo visual sin convertir el PDF
 * entero a imágenes. `width` en píxeles (por defecto 900).
 */
export function snapshot(source: string, path: string, page: number, width = 900): Promise<{ png: Buffer; pages: number; kind: string }> {
  return serial(async () => {
    const result = shown?.path === path && shown.source === source ? (cache.get(key(path))?.result ?? (await render(source, path))) : await render(source, path)
    const rect = (await win!.webContents.executeJavaScript(
      // Para la foto, la página se pone arriba a la izquierda y se reduce si no cabe en la ventana.
      `(() => { const els = document.querySelectorAll('#root > .doc > .pg, #root > .deck > .slide'); const el = els[${Math.max(1, page) - 1}]; if (!el) return null; scrollTo(0, 0); const w = el.offsetWidth; const h = el.offsetHeight; const z = Math.min(1, (innerHeight - 4) / h, (innerWidth - 4) / w); el.dataset.snap = '1'; el.style.cssText += ';position:fixed;left:0;top:0;margin:0;z-index:99999;transform-origin:0 0;transform:scale(' + z + ')'; return { x: 0, y: 0, width: Math.floor(w * z), height: Math.floor(h * z) } })()`
    )) as Electron.Rectangle | null
    if (!rect) throw new Error(`No existe la página ${page} (hay ${result.pages})`)
    await win!.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const img = await win!.webContents.capturePage(rect)
    await win!.webContents.executeJavaScript("document.querySelectorAll('[data-snap]').forEach((e) => { e.style.position = e.style.left = e.style.top = e.style.margin = e.style.zIndex = e.style.transform = e.style.transformOrigin = ''; delete e.dataset.snap })")
    return { png: (img.getSize().width > width ? img.resize({ width, quality: 'good' }) : img).toPNG(), pages: result.pages, kind: result.kind }
  })
}

export function closeExporter(): void {
  if (win && !win.isDestroyed()) win.destroy()
}
