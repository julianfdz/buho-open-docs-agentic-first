import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS, type ChangeKind, type DocKind, type Settings } from '@shared/types'
import { applyOps, editSection, editSlide, fillHole, holes, kindOf, type Op, outline, setIndex, parseValue, replaceText, setMeta, splitFront, splitSlides, titleOf, type SectionMode, type SlideMode } from '@shared/doc'
import { unified } from '@shared/diff'
import { CONTAINERS, LAYOUTS } from '@shared/syntax'
import * as docs from './docs'
import { historyBefore, historyEntry, listHistory, tagNextChange } from './history'
import { checkDoc, closeExporter, exportPdf, snapshot } from './exporter'
import { template } from './templates'
import { BLOCKS, blockById } from '@shared/blocks'
import { readdirSync } from 'node:fs'
import { startApi, stopApi } from './api'
import { syncAgentSkills, type SkillTarget } from './agentSkills'

/**
 * Búho Docs (Buho Corps Systems): documentos A4 y presentaciones 16:9 en PDF, escritos en Markdown,
 * con los cambios de la IA en directo. Agentic first: todo lo que haces en la app lo hace un agente
 * con el CLI `buho-docs`.
 */

// Versión portable: «portable.txt» junto al ejecutable → los datos van a la carpeta «datos» de al lado.
const portable = app.isPackaged && existsSync(join(dirname(process.execPath), 'portable.txt'))
app.setPath('userData', process.env.BUHO_DATA_DIR || (portable ? join(dirname(process.execPath), 'datos') : join(app.getPath('appData'), 'BuhoDocs')))

// buho://file/<ruta> sirve las imágenes locales de los documentos a la vista previa y al PDF.
protocol.registerSchemesAsPrivileged([{ scheme: 'buho', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

let win: BrowserWindow | null = null
let agentSkills: SkillTarget[] = []
let pendingOpen: string | null = null

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
function getSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsFile(), 'utf8').replace(/^﻿/, '')) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

// ─── Puente con la ventana ─────────────────────────────────────────────────────────────────────

const flushWaiters = new Map<string, () => void>()
docs.setBridge({
  send: (channel, payload) => win?.webContents.send(channel, payload),
  flush: (path) =>
    new Promise<void>((done) => {
      if (!win) return done()
      const id = randomUUID()
      const t = setTimeout(() => {
        flushWaiters.delete(id)
        done()
      }, 1500)
      flushWaiters.set(id, () => {
        clearTimeout(t)
        done()
      })
      win.webContents.send('flush', { id, path })
    })
})

function reveal(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
}

// ─── API local / CLI ───────────────────────────────────────────────────────────────────────────

const defaultPdf = (path: string): string => join(dirname(path), basename(path, extname(path)) + '.pdf')

async function apiCall(method: string, p: Record<string, unknown>): Promise<unknown> {
  const s = (k: string): string | undefined => (p[k] === undefined || p[k] === null || p[k] === '' ? undefined : String(p[k]))
  const need = (k: string, what: string): string => {
    const v = s(k)
    if (v === undefined) throw new Error(`Falta «${k}» (${what})`)
    return v
  }
  const path = (): string => docs.normPath(need('path', 'ruta del documento .md'))
  const ai = (summary: string): { kind: ChangeKind; author: string; summary: string } => ({ kind: 'ai', author: s('author') ?? 'IA', summary: s('summary') ?? summary })
  const result = (r: { changed: boolean; content: string; path: string }): object => ({
    ok: true,
    changed: r.changed,
    path: r.path,
    lines: r.content.split(/\r?\n/).length,
    ...(r.changed ? {} : { message: 'Sin cambios: el documento ya estaba así' })
  })
  switch (method) {
    case 'status':
      return { ok: true, app: 'Búho Docs', version: app.getVersion(), open: docs.openDocs(), userData: app.getPath('userData') }
    case 'docs':
      return { open: docs.openDocs(), recent: docs.recent() }
    case 'templates':
      return {
        kinds: ['documento', 'presentacion'],
        layouts: LAYOUTS,
        containers: CONTAINERS,
        icons: 'Nombres de https://lucide.dev/icons o alias en español: cohete, escudo, reloj, bombilla, lupa, grafico, equipo, documento, ley, objetivo, engranaje, ajustes, chat, cerebro, red, megafono, calendario, carrito, dinero, finanzas, logistica, produccion, soporte, informatica, ia, rayo, alerta, ojo, bandera, libro, formacion, acuerdo, correo, telefono, web, seguridad, datos, nube, automatizar, robot, check, pregunta, euro, empresa, tienda, factura, contrato'
      }
    case 'new': {
      const kind: DocKind = /^(presentaci[oó]n|slides?|deck)$/i.test(s('kind') ?? '') ? 'presentacion' : 'documento'
      const content = s('content') ?? template(kind, s('title'), s('subtitle'), s('estilo'))
      const d = docs.createDoc(need('path', 'ruta del nuevo .md'), content, s('author') ?? 'IA', 'ai')
      win?.webContents.send('open', d)
      reveal()
      return { ok: true, path: d.path, kind: d.kind, title: d.title }
    }
    case 'open': {
      const d = docs.openDoc(path(), true)
      reveal()
      return { ok: true, path: d.path, kind: d.kind, title: d.title }
    }
    case 'read': {
      const content = await docs.current(path())
      const f = splitFront(content)
      return { path: path(), kind: kindOf(f.meta), title: titleOf(content), meta: f.meta, content }
    }
    case 'outline': {
      const content = await docs.current(path())
      const kind = kindOf(splitFront(content).meta)
      return {
        kind,
        title: titleOf(content),
        headings: outline(content),
        slides: kind === 'presentacion' ? splitSlides(content).map((x) => ({ n: x.n, line: x.start + 1, layout: x.directives['diseño'] ?? (x.n === 1 ? 'portada' : 'normal'), title: x.title })) : undefined
      }
    }
    case 'write': {
      const content = need('content', 'texto completo del documento')
      const target = path()
      if (!existsSync(target)) {
        const d = docs.createDoc(target, content, s('author') ?? 'IA', 'ai')
        win?.webContents.send('open', d)
        return { ok: true, changed: true, created: true, path: d.path }
      }
      return result(await docs.applyChange(target, () => content, ai('Documento reescrito')))
    }
    case 'replace': {
      const find = need('find', 'texto exacto a buscar')
      const repl = s('replace') ?? ''
      const all = p.all === true || p.all === 'true'
      let count = 0
      const r = await docs.applyChange(
        path(),
        (src) => {
          const x = replaceText(src, find, repl, all)
          count = x.count
          return x.content
        },
        ai(`Cambiado «${find.length > 40 ? find.slice(0, 40) + '…' : find}» por «${repl.length > 40 ? repl.slice(0, 40) + '…' : repl}»`)
      )
      return { ...result(r), replaced: count }
    }
    case 'section': {
      const heading = need('heading', 'título de la sección o #N')
      const mode = (s('mode') ?? 'body') as SectionMode
      const label: Record<string, string> = { replace: 'reescrita', body: 'reescrita', append: 'ampliada', before: 'nuevo bloque antes', after: 'nuevo bloque después', delete: 'eliminada' }
      return result(await docs.applyChange(path(), (src) => editSection(src, heading, s('content') ?? '', mode), ai(`Sección «${heading}» ${label[mode] ?? mode}`)))
    }
    case 'slide': {
      const n = Number(need('n', 'número de diapositiva'))
      const mode = (s('mode') ?? 'replace') as SlideMode
      const label: Record<string, string> = { replace: `Diapositiva ${n} reescrita`, insert: `Diapositiva nueva en la posición ${n}`, delete: `Diapositiva ${n} eliminada`, move: `Diapositiva ${n} movida a la ${s('to')}` }
      return result(await docs.applyChange(path(), (src) => editSlide(src, n, mode, s('content') ?? '', Number(s('to')) || undefined), ai(label[mode] ?? mode)))
    }
    case 'append': {
      const add = need('content', 'texto a añadir')
      return result(await docs.applyChange(path(), (src) => src.replace(/\s*$/, '') + '\n\n' + add.replace(/\s*$/, '') + '\n', ai('Texto añadido al final')))
    }
    case 'meta': {
      const k = need('key', 'campo de la cabecera')
      const v = p.value === undefined || p.value === null ? null : typeof p.value === 'string' ? parseValue(p.value) : p.value
      return result(await docs.applyChange(path(), (src) => setMeta(src, k, v), ai(v === null ? `Quitado «${k}» de la cabecera` : `Cabecera: ${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`)))
    }
    case 'export': {
      const target = path()
      const out = s('out') ? resolve(s('out')!) : defaultPdf(target)
      const r = await exportPdf(await docs.current(target), target, out)
      return { ok: true, ...r }
    }
    case 'check': {
      const target = path()
      return { ok: true, path: target, ...(await checkDoc(await docs.current(target), target)) }
    }
    case 'history':
      return listHistory(path(), Number(s('limit')) || 30)
    case 'diff': {
      const target = path()
      const id = s('id') ?? listHistory(target, 1)[0]?.id
      const e = id ? historyEntry(target, id) : null
      if (!e) throw new Error('No hay esa entrada en el historial (mira buho-docs history)')
      const { content, ...item } = e
      return { ...item, diff: unified(historyBefore(target, e.id) ?? '', content) }
    }
    case 'restore': {
      const target = path()
      const e = historyEntry(target, need('id', 'id de la entrada del historial'))
      if (!e) throw new Error('No hay esa entrada en el historial')
      const when = new Date(e.at).toLocaleString('es-ES')
      return result(await docs.applyChange(target, () => e.content, ai(`Vuelta a la versión del ${when}`)))
    }
    case 'show': {
      const d = docs.openDoc(path(), true)
      win?.webContents.send('show', { path: d.path, line: Number(s('line')) || undefined })
      reveal()
      return { ok: true, path: d.path }
    }
    case 'batch': {
      const target = path()
      const ops = (Array.isArray(p.ops) ? p.ops : JSON.parse(need('ops', 'lista de cambios'))) as Op[]
      if (!ops.length) throw new Error('La lista de cambios está vacía')
      if (!existsSync(target)) {
        // Documento nuevo escrito entero en un lote.
        const { content, labels } = applyOps('', ops)
        const d = docs.createDoc(target, content, s('author') ?? 'IA', 'ai')
        win?.webContents.send('open', d)
        reveal()
        return { ok: true, changed: true, created: true, path: d.path, applied: labels.length }
      }
      let labels: string[] = []
      const r = await docs.applyChange(
        target,
        (src) => {
          const x = applyOps(src, ops)
          labels = x.labels
          return x.content
        },
        ai(ops.length === 1 ? 'Cambio' : `${ops.length} cambios`)
      )
      return { ...result(r), applied: labels.length, labels }
    }
    case 'streamStart': {
      const target = path()
      const mode = s('mode') ?? (s('heading') ? 'body' : 'append')
      const heading = s('heading')
      if (!existsSync(target)) docs.createDoc(target, '', s('author') ?? 'IA', 'ai')
      const hueco = s('hueco')
      const place = (src: string, mark: string): string => {
        if (hueco) return fillHole(src, hueco, mark)
        if (mode === 'write') return mark
        if (heading) return editSection(src, heading, mark, mode as SectionMode)
        return src.replace(/\s*$/, '') + (src.trim() ? '\n\n' : '') + mark + '\n'
      }
      const id = await docs.streamStart(target, place, s('author') ?? 'IA', s('summary') ?? (hueco ? `Hueco «${hueco}» escrito en directo` : heading ? `Sección «${heading}» escrita en directo` : 'Texto escrito en directo'))
      reveal()
      return { ok: true, id, path: target }
    }
    case 'streamChunk':
      docs.streamChunk(need('id', 'id de la escritura'), String(p.text ?? ''))
      return { ok: true }
    case 'streamEnd':
      return { ok: true, ...(await docs.streamEnd(need('id', 'id de la escritura'))), content: undefined }
    case 'snapshot': {
      const target = path()
      // Una página (page) o varias de una vez (pages: "1-3,8" o "todas"): se pinta una sola vez.
      const spec = s('pages') ?? s('page') ?? '1'
      const shots = await snapshot(await docs.current(target), target, spec, Number(s('width')) || 900)
      const dir = s('dir') ? resolve(s('dir')!) : join(tmpdir(), 'buho-docs')
      const files = shots.images.map((img) => {
        const out = shots.images.length === 1 && s('out') ? resolve(s('out')!) : join(dir, `${basename(target, extname(target))}-p${img.page}.png`)
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, img.png)
        return { page: img.page, file: out, bytes: img.png.length }
      })
      return { ok: true, pages: shots.pages, kind: shots.kind, files, file: files[0]?.file }
    }
    case 'bloques': {
      const userDir = join(app.getPath('userData'), 'bloques')
      mkdirSync(userDir, { recursive: true })
      const propios = readdirSync(userDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ id: f.replace(/\.md$/, ''), label: f.replace(/\.md$/, ''), propio: true, md: readFileSync(join(userDir, f), 'utf8') }))
      return { carpeta: userDir, bloques: [...BLOCKS.map((b) => ({ id: b.id, label: b.label, md: b.md })), ...propios] }
    }
    case 'insertar': {
      const target = path()
      const id = s('bloque')
      let content = s('content')
      if (!content && id) {
        const userFile = join(app.getPath('userData'), 'bloques', id + '.md')
        content = blockById(id)?.md ?? (existsSync(userFile) ? readFileSync(userFile, 'utf8') : undefined)
        if (!content) throw new Error(`No existe el bloque «${id}» (mira buho-docs bloques)`)
      }
      if (!content) throw new Error('Falta «bloque» o «content»')
      const after = s('despues')
      const c = content
      return result(await docs.applyChange(target, (src) => applyOps(src, [{ op: 'insert', content: c, after }]).content, ai(`Bloque ${id ?? ''} insertado${after ? ` tras «${after}»` : ''}`)))
    }
    case 'rellenar': {
      const target = path()
      const id = need('id', 'id del hueco')
      let content = s('content')
      const img = s('imagen')
      if (img) content = `![${s('alt') ?? ''}](${img.replace(/\\/g, '/')})${s('ancho') ? `{width=${s('ancho')}}` : ''}`
      if (!content) throw new Error('Falta «content» o «imagen»')
      const c = content
      return result(await docs.applyChange(target, (src) => fillHole(src, id, c), ai(`Hueco «${id}» rellenado`)))
    }
    case 'huecos':
      return holes(await docs.current(path()))
    case 'indice': {
      const on = !(p.quitar === true || p.quitar === 'true')
      const n = Number(s('niveles')) || 2
      return result(await docs.applyChange(path(), (src) => setIndex(src, on, n), ai(on ? 'Índice automático' : 'Índice quitado')))
    }
    case 'tag': {
      const target = path()
      tagNextChange(target, s('author') ?? 'IA', Number(s('seconds')) || 120)
      if (!docs.isOpen(target) && existsSync(target)) docs.openDoc(target, true)
      return { ok: true, path: target, message: `El próximo cambio en disco de este documento quedará firmado por ${s('author') ?? 'IA'}` }
    }
    default:
      throw new Error(`Método desconocido: ${method}`)
  }
}

// ─── Ventana ───────────────────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const dark = getSettings().theme === 'dark'
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    title: 'Búho Docs',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#0d1626' : '#ffffff', symbolColor: dark ? '#d6e2f0' : '#0a1f3a', height: 44 },
    backgroundColor: dark ? '#0d1626' : '#ffffff',
    icon: join(__dirname, '../../build/icon.png'),
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, spellcheck: true }
  })
  // La ventana oculta de exportar no debe mantener viva la app al cerrar la principal.
  win.on('closed', () => {
    win = null
    closeExporter()
  })
  win.once('ready-to-show', () => {
    if (!process.env.BUHO_E2E) win?.maximize()
    win?.show()
  })
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      try {
        win?.webContents.send('open', docs.openDoc(pendingOpen))
      } catch {
        /* archivo que ya no existe */
      }
    }
    pendingOpen = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Corrector ortográfico: clic derecho sobre una palabra subrayada → sugerencias.
  win.webContents.on('context-menu', (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) })
    if (params.misspelledWord) {
      if (!params.dictionarySuggestions.length) items.push({ label: 'Sin sugerencias', enabled: false })
      items.push({ label: 'Añadir al diccionario', click: () => win?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
    }
    if (params.isEditable) items.push({ role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' }, { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' })
    else if (params.selectionText) items.push({ role: 'copy', label: 'Copiar' })
    if (items.length) Menu.buildFromTemplate(items).popup()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('getSettings', () => getSettings())
  ipcMain.handle('saveSettings', (_e, st: Settings) => {
    writeFileSync(settingsFile(), JSON.stringify(st, null, 2))
    return st
  })
  ipcMain.handle('appInfo', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    portable,
    cli: app.isPackaged ? join(dirname(process.execPath), 'cli') : join(app.getAppPath(), 'bin'),
    agentSkills
  }))
  ipcMain.handle('overlay', (_e, color: string, symbolColor: string) => {
    try {
      win?.setTitleBarOverlay({ color, symbolColor, height: 44 })
    } catch {
      /* sin overlay */
    }
  })
  ipcMain.handle('recent', () => docs.recent())
  ipcMain.handle('openDialog', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Abrir documento', filters: [{ name: 'Documentos Markdown', extensions: ['md', 'markdown'] }], properties: ['openFile'] })
    return r.canceled ? null : docs.openDoc(r.filePaths[0])
  })
  ipcMain.handle('open', (_e, path: string) => docs.openDoc(path))
  ipcMain.handle('create', async (_e, kind: DocKind, estilo?: string) => {
    const r = await dialog.showSaveDialog(win!, {
      title: kind === 'presentacion' ? 'Nueva presentación' : 'Nuevo documento',
      defaultPath: join(app.getPath('documents'), kind === 'presentacion' ? 'Nueva presentación.md' : 'Nuevo documento.md'),
      filters: [{ name: 'Documento Markdown', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePath) return null
    if (existsSync(r.filePath)) return docs.openDoc(r.filePath)
    return docs.createDoc(r.filePath, template(kind, '', '', estilo), 'Tú', 'user')
  })
  ipcMain.handle('close', (_e, path: string) => docs.closeDoc(path))
  ipcMain.handle('save', (_e, path: string, content: string) => {
    try {
      docs.saveUser(path, content)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('exportPdf', async (_e, path: string, choose: boolean) => {
    try {
      let out = defaultPdf(path)
      if (choose) {
        const r = await dialog.showSaveDialog(win!, { title: 'Exportar a PDF', defaultPath: out, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
        if (r.canceled || !r.filePath) return { ok: false }
        out = r.filePath
      }
      const r = await exportPdf(await docs.current(path), path, out)
      return { ok: true, file: r.file, pages: r.pages }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('history', (_e, path: string) => listHistory(path, 300))
  ipcMain.handle('bloques', () => apiCall('bloques', {}))
  ipcMain.handle('historyEntry', (_e, path: string, id: string) => historyEntry(path, id))
  ipcMain.handle('historyBefore', (_e, path: string, id: string) => historyBefore(path, id))
  ipcMain.handle('restore', async (_e, path: string, id: string) => {
    const e = historyEntry(path, id)
    if (!e) return { ok: false, error: 'No existe esa versión' }
    await docs.applyChange(path, () => e.content, { kind: 'user', author: 'Tú', summary: `Vuelta a la versión del ${new Date(e.at).toLocaleString('es-ES')}` })
    return { ok: true }
  })
  ipcMain.handle('showInFolder', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('openExternal', (_e, url: string) => (/^https?:\/\//.test(url) ? shell.openExternal(url) : shell.openPath(url)))
  ipcMain.handle('copy', (_e, text: string) => clipboard.writeText(text))
  ipcMain.on('flushed', (_e, id: string) => {
    flushWaiters.get(id)?.()
    flushWaiters.delete(id)
  })
}

/** Documento pasado al abrir (clic derecho → «Abrir con Búho Docs», o arrastrado al icono). */
function docFromArgv(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue
    if (/\.(md|markdown)$/i.test(a) && existsSync(a)) return resolve(a)
  }
  return null
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const d = docFromArgv(argv)
    if (d) {
      try {
        docs.openDoc(d, true)
      } catch {
        /* nada */
      }
    }
    reveal()
    win?.focus()
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('es.buhoai.docs')
    Menu.setApplicationMenu(null)
    protocol.handle('buho', (req) => {
      const u = new URL(req.url)
      if (u.host !== 'file') return new Response('No encontrado', { status: 404 })
      const file = decodeURIComponent(u.pathname.replace(/^\//, ''))
      return net.fetch(pathToFileURL(file).toString())
    })
    try {
      session.defaultSession.setSpellCheckerLanguages(['es-ES', 'es'])
    } catch {
      /* Windows usa los idiomas del sistema */
    }
    registerIpc()
    pendingOpen = docFromArgv(process.argv)
    createWindow()
    if (!process.env.BUHO_NO_API) startApi(apiCall)
    if (app.isPackaged && !portable && !process.env.BUHO_E2E) {
      agentSkills = syncAgentSkills(join(dirname(process.execPath), 'SKILL.md'), app.getVersion())
    }
  })
  app.on('window-all-closed', () => {
    stopApi()
    closeExporter()
    app.quit()
  })
}
