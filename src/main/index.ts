import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS, type ChangeKind, type DocKind, type OpenDoc, type Settings } from '@shared/types'
import { applyOps, editSection, editSlide, fillHole, holes, kindOf, type Op, outline, setIndex, parseValue, replaceText, setMeta, splitFront, splitSlides, titleOf, type SectionMode, type SlideMode } from '@shared/doc'
import { unified } from '@shared/diff'
import { CONTAINERS, LAYOUTS } from '@shared/syntax'
import * as docs from './docs'
import { historyBefore, historyEntry, listHistory, tagNextChange } from './history'
import { checkDoc, closeExporter, exportPdf, pagesText, snapshot } from './exporter'
import { template } from './templates'
import { editBlock, readClean, search, type BlockEditMode } from '@shared/index-ai'
import { indexOf, mdFiles } from './indexcache'
import { runInApp } from './clirun'
import { importar } from './importar'
import * as borradores from './borradores'
import { exportDocx } from './exportar-word'
import { exportPptx } from './exportar-pptx'
import * as revision from './revision'
import { aplicar, lineaActual, lineaCita } from '@shared/propuestas'
import { crearTema, listarTemas, resolverTema, temasDir, type NuevoTema } from './temas'
import { PLANTILLAS, desdePlantilla, plantillaById } from '@shared/plantillas'
import { fechaHoy } from './templates'
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
// La ventana se entera cuando cambian las propuestas o los comentarios de un documento.
revision.onCambio((path) => win?.webContents.send('revision', { path }))
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

/** Plantilla de serie o propia (<datos>/plantillas/<id>.md, que se copia tal cual). */
function plantillaPor(id: string): { tipo: 'documento' | 'presentacion'; cuerpo: string; meta?: Record<string, string>; nombre: string } {
  const p = plantillaById(id)
  if (p) return p
  const f = join(app.getPath('userData'), 'plantillas', id + '.md')
  if (!existsSync(f)) throw new Error(`No existe la plantilla «${id}» (mira buho-docs plantillas)`)
  const src = readFileSync(f, 'utf8')
  const fr = splitFront(src)
  return { tipo: kindOf(fr.meta), cuerpo: fr.body.replace(/^\s+/, ''), nombre: id }
}

/** Dónde va lo exportado: junto al .md; si es un borrador, a Documentos\Buho Docs (no a la caché). */
const defaultOut = (path: string, ext: string): string => {
  const dir = borradores.esBorrador(path) ? join(app.getPath('documents'), 'Buho Docs') : dirname(path)
  mkdirSync(dir, { recursive: true })
  return join(dir, basename(path, extname(path)) + ext)
}
const defaultPdf = (path: string): string => defaultOut(path, '.pdf')
/** Exportar a Office: Word (.docx) para documentos, PowerPoint (.pptx) para presentaciones. Editables. */
async function exportWord(path: string, out: string): Promise<{ ok: true; file: string; bytes: number; kind: string; slides?: number }> {
  const src = await docs.current(path)
  const deck = /\.pptx$/i.test(out)
  const r = deck ? await exportPptx(src, path, dirname(path)) : await exportDocx(src, path, dirname(path))
  const buffer = r.buffer
  mkdirSync(dirname(out), { recursive: true })
  try {
    writeFileSync(out, buffer)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EBUSY' || (e as NodeJS.ErrnoException).code === 'EPERM') throw new Error(`No puedo escribir ${out}: está abierto (ciérralo en Word o usa --out con otro nombre)`)
    throw e
  }
  return { ok: true, file: out, bytes: buffer.length, kind: kindOf(splitFront(src).meta), ...('slides' in r ? { slides: r.slides } : {}) }
}
/** Ruta de salida de Office: junto al .md (o donde diga); .pptx para presentaciones. */
async function salidaOffice(path: string, formato: string | undefined, out: string | undefined): Promise<string> {
  const deck = kindOf(splitFront(await docs.current(path)).meta) === 'presentacion'
  const ext = /^(pptx|powerpoint|ppt)$/i.test(formato ?? '') || /\.pptx$/i.test(out ?? '') ? '.pptx' : /^(docx|word)$/i.test(formato ?? '') || /\.docx$/i.test(out ?? '') ? '.docx' : deck ? '.pptx' : '.docx'
  return out ?? defaultOut(path, ext)
}

/** Un comentario con dónde está ahora: línea, bloque (#id, para «editar») y su Markdown. */
function comentarioInfo(target: string, content: string, c: import('@shared/propuestas').Comentario): object {
  const linea = lineaCita(content, c)
  const b = linea ? indexOf(target, content).blocks.find((x) => x.line <= linea && x.end >= linea && x.type !== 'diapositiva') : undefined
  const md = b ? content.split(/\r?\n/).slice(b.line - 1, b.end).join('\n') : undefined
  return { ...c, ahora: linea, bloque: b ? { id: b.id, line: b.line, end: b.end, seccion: b.path, markdown: md } : null }
}

async function apiCall(method: string, p: Record<string, unknown>): Promise<unknown> {
  const s = (k: string): string | undefined => (p[k] === undefined || p[k] === null || p[k] === '' ? undefined : String(p[k]))
  const need = (k: string, what: string): string => {
    const v = s(k)
    if (v === undefined) throw new Error(`Falta «${k}» (${what})`)
    return v
  }
  const path = (): string => docs.normPath(need('path', 'ruta del documento .md'))
  const ai = (summary: string): docs.Who => ({ kind: 'ai', author: s('author') ?? 'IA', summary: s('summary') ?? summary, proponer: p.proponer === true || p.proponer === 'true', comentario: s('comentario') })
  const result = (r: { changed: boolean; content: string; path: string; propuesta?: string }): object => ({
    ok: true,
    ...(r.propuesta ? { propuesta: r.propuesta, message: `Propuesta ${r.propuesta} pendiente: el usuario la acepta o la rechaza (buho-docs propuestas)` } : {}),
    changed: r.changed,
    path: r.path,
    lines: r.content.split(/\r?\n/).length,
    ...(r.changed || r.propuesta ? {} : { message: 'Sin cambios: el documento ya estaba así' })
  })
  switch (method) {
    case 'status':
      return { ok: true, app: 'Búho Docs', version: app.getVersion(), open: docs.openDocs(), userData: app.getPath('userData') }
    case 'docs':
      return { open: docs.openDocs().map((d) => ({ ...d, sinGuardar: borradores.esBorrador(d.path) })), recent: docs.recent() }
    case 'templates':
      return {
        kinds: ['documento', 'presentacion'],
        layouts: LAYOUTS,
        containers: CONTAINERS,
        icons: 'Nombres de https://lucide.dev/icons o alias en español: cohete, escudo, reloj, bombilla, lupa, grafico, equipo, documento, ley, objetivo, engranaje, ajustes, chat, cerebro, red, megafono, calendario, carrito, dinero, finanzas, logistica, produccion, soporte, informatica, ia, rayo, alerta, ojo, bandera, libro, formacion, acuerdo, correo, telefono, web, seguridad, datos, nube, automatizar, robot, check, pregunta, euro, empresa, tienda, factura, contrato'
      }
    case 'new': {
      const kind: DocKind = /^(presentaci[oó]n|slides?|deck)$/i.test(s('kind') ?? '') ? 'presentacion' : 'documento'
      const pl = s('plantilla') ? plantillaPor(s('plantilla')!) : null
      const content = s('content') ?? (pl ? desdePlantilla(pl, s('title') ?? '', s('tema') ?? s('estilo') ?? 'buho', fechaHoy()) : template(kind, s('title'), s('subtitle'), s('tema') ?? s('estilo')))
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
      if (/^(docx|word|pptx|powerpoint|ppt|office)$/i.test(s('formato') ?? '') || /\.(docx|pptx)$/i.test(s('out') ?? '')) return exportWord(target, await salidaOffice(target, s('formato'), s('out') ? resolve(s('out')!) : undefined))
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
    case 'importar': {
      // Word, PDF, HTML o texto → documento de Búho Docs (en Documentos\Buho Docs si no se dice otra cosa).
      const r = await importar(path(), { salida: s('salida') ? resolve(s('salida')!) : undefined, tema: s('tema') })
      if (!(p.abrir === false || p.abrir === 'false')) {
        docs.openDoc(r.path, true)
        reveal()
      }
      return r
    }
    case 'paginas': {
      // Cuántas páginas (o diapositivas) hay y qué trae cada una.
      const target = path()
      const r = await pagesText(await docs.current(target), target)
      return { path: target, kind: r.kind, total: r.pages.length, pages: r.pages.map((pg) => ({ n: pg.n, tokens: Math.ceil(pg.text.length / 3.6), titles: pg.titles, preview: pg.text.replace(/\s+/g, ' ').slice(0, 100) })) }
    }
    case 'pagina': {
      // El texto de una página tal como sale maquetada (y, con captura, su imagen).
      const target = path()
      const n = Number(need('n', 'número de página'))
      const src = await docs.current(target)
      const r = await pagesText(src, target)
      const pg = r.pages[n - 1]
      if (!pg) throw new Error(`No existe la página ${n} (hay ${r.pages.length})`)
      let file: string | undefined
      if (p.captura === true || p.captura === 'true') {
        const shot = await snapshot(src, target, String(n), Number(s('width')) || 900)
        file = s('out') ? resolve(s('out')!) : join(tmpdir(), 'buho-docs', `${basename(target, extname(target))}-p${n}.png`)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, shot.images[0].png)
      }
      return { path: target, n, total: r.pages.length, kind: r.kind, tokens: Math.ceil(pg.text.length / 3.6), titles: pg.titles, text: pg.text, captura: file }
    }
    case 'cli': {
      // CLI siempre activo: el comando se ejecuta aquí dentro (lo manda buho-docs.exe).
      const argv = Array.isArray(p.argv) ? p.argv.map(String) : []
      return runInApp(apiCall, argv, s('cwd') ?? process.cwd())
    }
    // ─── Revisión: propuestas (control de cambios) y comentarios ───
    case 'revision': {
      const target = path()
      if (s('modo') !== undefined) revision.setModo(target, /^(s[ií]|on|true|1)$/i.test(s('modo')!))
      const content = await docs.current(target)
      const e = revision.estado(target)
      return {
        ok: true,
        path: target,
        modo: e.modo,
        propuestas: e.propuestas.map((pr) => ({ ...pr, trozos: pr.trozos.map((t) => ({ ...t, ahora: lineaActual(content, t) })) })),
        comentarios: e.comentarios.map((c) => comentarioInfo(target, content, c))
      }
    }
    case 'aceptar':
    case 'rechazar': {
      const target = path()
      const todas = p.todas === true || p.todas === 'true' || s('id') === 'todas'
      const ids = todas ? [] : need('id', 'id de la propuesta (p…) o «todas»').split(',').map((x) => x.trim().replace(/^#/, ''))
      const lista = revision.propuestas(target).filter((pr) => todas || ids.includes(pr.id))
      if (!lista.length) throw new Error(todas ? 'No hay propuestas pendientes' : `No existe la propuesta ${ids.join(', ')} (mira buho-docs propuestas)`)
      if (method === 'rechazar') {
        revision.quitarPropuestas(target, lista.map((x) => x.id))
        return { ok: true, rechazadas: lista.length }
      }
      let fallidos = 0
      const r = await docs.applyChange(
        target,
        (src) => {
          const x = aplicar(src, lista.flatMap((pr) => pr.trozos))
          fallidos = x.fallidos.length
          return x.content
        },
        { kind: 'ai', author: lista.length === 1 ? lista[0].autor : 'IA', summary: lista.length === 1 ? `${lista[0].resumen} (propuesta aceptada)` : `${lista.length} propuestas aceptadas`, directo: true }
      )
      revision.quitarPropuestas(target, lista.map((x) => x.id))
      for (const pr of lista)
        for (const cid of (pr.comentario ?? '').split(',').filter(Boolean))
          try {
            revision.responder(target, cid, 'Tú', '', true)
          } catch {
            /* comentario borrado */
          }
      return { ...result(r), aceptadas: lista.length, fallidos, ...(fallidos ? { message: `${fallidos} trozo(s) no encajaban ya (el texto cambió después) y no se aplicaron` } : {}) }
    }
    case 'comentarios': {
      const target = path()
      const content = await docs.current(target)
      const solo = p.abiertos === true || p.abiertos === 'true'
      return { ok: true, path: target, comentarios: revision.comentarios(target).filter((c) => !solo || c.estado === 'abierto').map((c) => comentarioInfo(target, content, c)) }
    }
    case 'comentar': {
      const target = path()
      const content = await docs.current(target)
      const texto = need('texto', 'el comentario')
      let cita = s('cita') ?? ''
      let linea = Number(s('linea')) || 0
      if (s('bloque')) {
        const b = indexOf(target, content).blocks.find((x) => x.id === s('bloque')!.replace(/^#/, ''))
        if (!b) throw new Error(`No existe el bloque ${s('bloque')} (mira buho-docs mapa)`)
        linea = b.line
        cita ||= content.split(/\r?\n/)[b.line - 1]
      } else if (cita && !linea) linea = lineaCita(content, { cita, linea: 1 }) ?? 0
      else if (linea && !cita) cita = content.split(/\r?\n/)[linea - 1] ?? ''
      // Seleccionado en la página (texto sin sintaxis): se ancla a la línea del bloque y se guarda lo seleccionado.
      let seleccion = s('seleccion')
      if (cita && linea && lineaCita(content, { cita, linea }) === null) {
        seleccion ??= cita
        cita = content.split(/\r?\n/)[linea - 1] ?? ''
      }
      if (!cita.trim()) throw new Error('Di a qué se refiere: --cita "texto", --bloque #b… o --linea N')
      if (!linea) throw new Error(`No encuentro «${cita.slice(0, 60)}» en el documento`)
      const c = revision.comentar(target, { autor: s('author') ?? 'Tú', texto, cita, linea, ...(seleccion && seleccion !== cita ? { seleccion } : {}) })
      return { ok: true, ...comentarioInfo(target, content, c) }
    }
    case 'responder': {
      const target = path()
      const c = revision.responder(target, need('id', 'id del comentario (c…)'), s('author') ?? 'IA', s('texto') ?? '', p.resolver === true || p.resolver === 'true')
      return { ok: true, id: c.id, estado: c.estado }
    }
    case 'resolver': {
      const target = path()
      if (p.reabrir === true) revision.reabrir(target, need('id', 'id'))
      else if (p.borrar === true || p.borrar === 'true') revision.borrarComentario(target, need('id', 'id'))
      else revision.responder(target, need('id', 'id del comentario (c…)'), s('author') ?? 'Tú', '', true)
      return { ok: true }
    }
    case 'nuevo': {
      // Borrador sin guardar (para agentes: devuelve su ruta; se guarda con «guardar»).
      const kind: DocKind = /^(presentaci[oó]n|slides?|deck)$/i.test(s('kind') ?? '') ? 'presentacion' : 'documento'
      const pl = s('plantilla') ? plantillaPor(s('plantilla')!) : null
      const content = s('content') ?? (pl ? desdePlantilla(pl, s('title') ?? '', s('tema') ?? 'buho', fechaHoy()) : template(kind, s('title'), s('subtitle'), s('tema')))
      const d = docs.openDoc(borradores.crear(s('nombre') ?? s('title') ?? pl?.nombre ?? borradores.nombreSinTitulo(), content), true)
      reveal()
      return { ok: true, path: d.path, sinGuardar: true, kind: d.kind }
    }
    case 'guardar': {
      const target = path()
      const como = need('como', 'ruta donde guardarlo (.md)')
      const d = await guardarComo(target, resolve(como.endsWith('.md') ? como : como + '.md'))
      return { ok: true, path: d?.path }
    }
    case 'temas':
      return { carpeta: temasDir(), temas: listarTemas().map(({ css, ...t }) => ({ ...t, css: css ? `${css.length} caracteres` : undefined })) }
    case 'temaCrear': {
      const n: NuevoTema = {
        id: need('id', 'id del tema (minúsculas y guiones)'),
        nombre: s('nombre'),
        principal: need('principal', 'color principal #rrggbb'),
        acento: need('acento', 'color de acento #rrggbb'),
        suave: s('suave'),
        texto: s('texto'),
        titulos: s('titulos'),
        fuenteTexto: s('fuenteTexto'),
        logo: s('logo') ? resolve(s('logo')!) : undefined,
        marca: s('marca'),
        pie: s('pie'),
        portada: s('portada') as NuevoTema['portada'],
        base: s('base') as NuevoTema['base']
      }
      return crearTema(n)
    }
    case 'plantillas': {
      const dir = join(app.getPath('userData'), 'plantillas')
      mkdirSync(dir, { recursive: true })
      const propias = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => ({ id: f.replace(/\.md$/, ''), nombre: f.replace(/\.md$/, ''), tipo: 'documento', descripcion: 'Plantilla propia', propia: true }))
      return { carpeta: dir, plantillas: [...PLANTILLAS.map(({ cuerpo, ...p }) => p), ...propias] }
    }
    case 'mapa': {
      // Índice del documento para IAs: secciones con sus tokens (y, con bloques=true, cada bloque).
      const target = path()
      const ix = indexOf(target, await docs.current(target))
      const conBloques = p.bloques === true || p.bloques === 'true'
      return { path: target, title: ix.title, kind: ix.kind, hash: ix.hash, tokens: ix.tokens, nBlocks: ix.blocks.length, sections: ix.sections, blocks: conBloques ? ix.blocks.map(({ text, ...b }) => ({ ...b, preview: text.slice(0, 80) })) : undefined }
    }
    case 'leer': {
      const target = path()
      const ix = indexOf(target, await docs.current(target))
      const r = readClean(ix, { section: s('seccion'), block: s('bloque'), from: s('desde'), maxTokens: Number(s('max')) || undefined, ids: p.ids === true || p.ids === 'true' })
      return { path: target, hash: ix.hash, ...r }
    }
    case 'buscar': {
      const q = need('q', 'qué buscar')
      const limit = Number(s('limite')) || 10
      const files = s('carpeta') ? mdFiles(resolve(s('carpeta')!)) : [path()]
      const t0 = Date.now()
      const hits = files.flatMap((f) => {
        try {
          const ix = docs.isOpen(f) ? indexOf(f, readFileSync(f, 'utf8')) : indexOf(f)
          return search(ix, q, limit).map((h) => ({ ...h, path: f, section: h.path }))
        } catch {
          return []
        }
      })
      hits.sort((a, b) => b.score - a.score)
      return { q, files: files.length, ms: Date.now() - t0, hits: hits.slice(0, limit) }
    }
    case 'bloque': {
      // Cambiar (o leer) un bloque por su id: #b… del mapa, leer --ids o buscar.
      const target = path()
      const id = need('id', 'id del bloque (#b…)').replace(/^#/, '')
      const mode = (s('mode') ?? (p.content === undefined ? 'leer' : 'replace')) as BlockEditMode | 'leer'
      if (mode === 'leer') {
        const ix = indexOf(target, await docs.current(target))
        const b = ix.blocks.find((x) => x.id === id)
        if (!b) throw new Error(`No existe el bloque #${id} (mira buho-docs mapa)`)
        const raw = (await docs.current(target)).split(/\r?\n/).slice(b.line - 1, b.end).join('\n')
        return { ...b, markdown: raw }
      }
      const label: Record<string, string> = { replace: 'reescrito', before: 'bloque nuevo antes', after: 'bloque nuevo después', delete: 'eliminado' }
      return result(await docs.applyChange(target, (src) => editBlock(src, id, mode, s('content') ?? ''), ai(`Bloque #${id} ${label[mode] ?? mode}`)))
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

let cerrarYa = false
type Pendiente = { path: string; title: string; dirty: boolean; sinGuardar: boolean }
const pendWaiters = new Map<string, (p: Pendiente[]) => void>()
/** Pregunta a la ventana qué documentos tienen cambios sin guardar. */
function pendientes(): Promise<Pendiente[]> {
  return new Promise((done) => {
    const id = randomUUID()
    const t = setTimeout(() => done([]), 1500)
    pendWaiters.set(id, (p) => {
      clearTimeout(t)
      done(p)
    })
    win?.webContents.send('pendientes', { id })
  })
}
function guardarPendientes(): Promise<void> {
  return new Promise((done) => {
    const id = randomUUID()
    const t = setTimeout(done, 3000)
    flushWaiters.set(id, () => {
      clearTimeout(t)
      done()
    })
    win?.webContents.send('guardarTodo', { id })
  })
}

/** Guardar un borrador (o «guardar como»): elegir dónde, copiar con sus imágenes y seguir con el nuevo. */
async function guardarComo(path: string, destino?: string): Promise<OpenDoc | null> {
  const nombre = basename(path, '.md')
  let out = destino
  if (!out) {
    const r = await dialog.showSaveDialog(win!, { title: 'Guardar documento', defaultPath: join(app.getPath('documents'), 'Buho Docs', nombre + '.md'), filters: [{ name: 'Documento de Búho Docs (Markdown)', extensions: ['md'] }] })
    if (r.canceled || !r.filePath) return null
    out = r.filePath
  }
  const content = await docs.current(path)
  docs.closeDoc(path)
  if (borradores.esBorrador(path)) borradores.guardarEn(path, out)
  else writeFileSync(out, content)
  const d = docs.openDoc(out)
  win?.webContents.send('renombrado', { from: path, to: d })
  return d
}

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
  // Al cerrar: si hay documentos sin guardar, se pregunta (los borradores se conservan igualmente).
  win.on('close', (e) => {
    if (cerrarYa || process.env.BUHO_E2E) return
    e.preventDefault()
    void pendientes().then(async (p) => {
      const dirty = p.filter((x) => !x.sinGuardar && x.dirty)
      const nuevos = p.filter((x) => x.sinGuardar)
      if (dirty.length || nuevos.length) {
        const r = await dialog.showMessageBox(win!, {
          type: 'question',
          title: 'Salir de Búho Docs',
          message: dirty.length ? `Hay ${dirty.length} documento(s) con cambios sin guardar.` : `Tienes ${nuevos.length} documento(s) sin guardar.`,
          detail:
            [...dirty.map((x) => '• ' + x.title + ' (cambios)'), ...nuevos.map((x) => '• ' + x.title + ' (sin guardar)')].join('\n') +
            (nuevos.length ? '\n\nLos documentos sin guardar se conservan como borrador y se recuperan al volver a abrir la app.' : ''),
          buttons: dirty.length ? ['Guardar y salir', 'Salir sin guardar', 'Cancelar'] : ['Salir', 'Cancelar'],
          defaultId: 0,
          cancelId: dirty.length ? 2 : 1,
          noLink: true
        })
        if (dirty.length && r.response === 2) return
        if (!dirty.length && r.response === 1) return
        if (dirty.length && r.response === 0) await guardarPendientes()
      }
      cerrarYa = true
      win?.close()
    })
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
    // Borradores de la última vez: se recuperan tal cual estaban.
    for (const b of borradores.listar()) {
      try {
        win?.webContents.send('open', docs.openDoc(b))
      } catch {
        /* borrador ilegible */
      }
    }
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
    const r = await dialog.showOpenDialog(win!, {
      title: 'Abrir o importar',
      filters: [
        { name: 'Documentos (Markdown, Word, PDF, HTML, texto)', extensions: ['md', 'markdown', 'docx', 'pdf', 'html', 'htm', 'txt'] },
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'Word', extensions: ['docx'] },
        { name: 'PDF', extensions: ['pdf'] }
      ],
      properties: ['openFile']
    })
    if (r.canceled) return null
    const f = r.filePaths[0]
    if (/\.(md|markdown)$/i.test(f)) return docs.openDoc(f)
    // Word, PDF…: se abre como borrador (sin guardar): el original no se toca y no hace falta elegir
    // dónde guardarlo hasta que se quiera (Ctrl+S).
    const salida = borradores.rutaNueva(basename(f, extname(f)))
    if (/\.pdf$/i.test(f)) {
      // Un PDF se maqueta con IA en paralelo (las tablas no se pueden recuperar con reglas): va en
      // segundo plano y el documento aparece escribiéndose en directo.
      void runInApp(apiCall, ['importar', f, '--salida', salida, '--tema', 'buho'], dirname(f)).then((r) => {
        if (r.code !== 0) dialog.showErrorBox('No se pudo importar el PDF', (r.stderr || r.stdout).slice(-800))
      })
      return null
    }
    const imp = await importar(f, { salida })
    return docs.openDoc(imp.path)
  })
  ipcMain.handle('open', (_e, path: string) => docs.openDoc(path))
  // Nuevo: un borrador al momento, sin elegir dónde guardarlo.
  ipcMain.handle('create', (_e, kind: DocKind, estilo?: string) => docs.openDoc(borradores.crear(borradores.nombreSinTitulo(), template(kind, '', '', estilo))))
  ipcMain.handle('guardarComo', async (_e, path: string) => guardarComo(path))
  ipcMain.handle('descartar', (_e, path: string) => {
    docs.closeDoc(path)
    borradores.descartar(path)
  })
  ipcMain.handle('confirmarCierre', async (_e, path: string, sinGuardar: boolean, titulo: string) => {
    const r = await dialog.showMessageBox(win!, {
      type: 'question',
      title: 'Cerrar documento',
      message: sinGuardar ? `«${titulo}» no está guardado. ¿Quieres guardarlo?` : `¿Guardar los cambios de «${titulo}»?`,
      detail: sinGuardar ? 'Si lo descartas, se borra.' : 'Si no los guardas, se pierden los cambios desde el último guardado.',
      buttons: sinGuardar ? ['Guardar…', 'Descartar', 'Cancelar'] : ['Guardar', 'No guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    return (['guardar', 'descartar', 'cancelar'] as const)[r.response]
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
  ipcMain.handle('exportWord', async (_e, path: string, choose: boolean) => {
    try {
      let out = await salidaOffice(path, undefined, undefined)
      const deck = out.endsWith('.pptx')
      if (choose) {
        const r = await dialog.showSaveDialog(win!, { title: deck ? 'Exportar a PowerPoint' : 'Exportar a Word', defaultPath: out, filters: [deck ? { name: 'Presentación de PowerPoint', extensions: ['pptx'] } : { name: 'Documento de Word', extensions: ['docx'] }] })
        if (r.canceled || !r.filePath) return { ok: false }
        out = r.filePath
      }
      return await exportWord(path, out)
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  // Revisión desde la ventana: las mismas operaciones que la API.
  ipcMain.handle('revision', async (_e, method: string, params: Record<string, unknown>) => {
    if (!['revision', 'aceptar', 'rechazar', 'comentar', 'responder', 'resolver'].includes(method)) return { error: 'operación no permitida' }
    try {
      return await apiCall(method, params)
    } catch (e) {
      return { error: (e as Error).message }
    }
  })
  ipcMain.handle('atender', async (_e, path: string) => {
    const r = await runInApp(apiCall, ['atender', path, '--author', 'Claude'], dirname(path))
    return { ok: r.code === 0, salida: (r.stdout + r.stderr).trim() }
  })
  ipcMain.handle('history', (_e, path: string) => listHistory(path, 300))
  ipcMain.handle('bloques', () => apiCall('bloques', {}))
  ipcMain.handle('tema', (_e, id: string) => resolverTema(id))
  ipcMain.handle('temas', () => listarTemas())
  ipcMain.handle('crearTema', async (_e, n: NuevoTema) => {
    try {
      return { ok: true, tema: crearTema(n) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('elegirLogo', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Logo del tema', filters: [{ name: 'Imagen', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }], properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('plantillas', () => apiCall('plantillas', {}))
  ipcMain.handle('crearDesdePlantilla', async (_e, id: string, tema: string) => {
    const pl = plantillaPor(id)
    return docs.openDoc(borradores.crear(pl.nombre, desdePlantilla(pl, '', tema, fechaHoy())))
  })
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
  ipcMain.on('pendientes', (_e, id: string, p: Pendiente[]) => {
    pendWaiters.get(id)?.(p)
    pendWaiters.delete(id)
  })
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
