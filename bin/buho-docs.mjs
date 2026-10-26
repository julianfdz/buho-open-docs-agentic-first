#!/usr/bin/env node
/**
 * buho-docs · CLI de Búho Docs para agentes de IA (Claude, Codex, Copilot, scripts…) y personas.
 * Documentos A4 y presentaciones 16:9 en Markdown con el estilo Búho; PDF con un comando.
 * Habla con la app (<userData>/api.json trae URL y token); si está cerrada, la abre. El usuario ve
 * cada cambio en directo y queda firmado en el historial con --author.
 *
 *   buho-docs status | docs | templates | skill
 *   buho-docs new <archivo.md> [--kind documento|presentacion] [--title "…"] [--subtitle "…"] [--file contenido.md]
 *   buho-docs nuevo [nombre] [--plantilla acta] [--tema id] [--file c.md]  # borrador sin guardar (imprime su ruta)
 *   buho-docs guardar <borrador.md> <destino.md>   # guardar un borrador donde se quiera
 *   buho-docs open <archivo.md>                     (lo abre y lo enseña)
 *   buho-docs read <archivo.md> [--lines]           (contenido; --lines con números de línea)
 *   buho-docs outline <archivo.md>                  (títulos y diapositivas con su línea)
 *   buho-docs write <archivo.md> --file nuevo.md    (reescribe entero; - lee de la entrada estándar)
 *   buho-docs replace <archivo.md> "texto" "nuevo" [--all]          (erratas y cambios puntuales)
 *   buho-docs section <archivo.md> "Título" --file parte.md [--mode body|replace|append|before|after|delete]
 *   buho-docs slide <archivo.md> <n> --file diapo.md [--mode replace|insert|delete|move] [--to N]
 *   buho-docs append <archivo.md> --file mas.md
 *   buho-docs meta <archivo.md> <campo> ["valor"]   (cabecera; sin valor lo quita)
 *   buho-docs export <archivo.md> [--out archivo.pdf] [--word]   # --word (o --out x.docx): Word editable
 *   buho-docs check <archivo.md>                    (páginas y avisos: diapositivas que no caben, imágenes…)
 *   buho-docs history <archivo.md> [--limit 20] | diff <archivo.md> [id] | restore <archivo.md> <id>
 *   buho-docs show <archivo.md> [--line N]          (lo enseña en la app, en esa línea)
 *   buho-docs tag <archivo.md> --author Claude      (firma tu próximo guardado directo del archivo)
 *   buho-docs batch <archivo.md> --file cambios.json  (varios cambios de una vez; crea el .md si no existe)
 *   buho-docs stream <archivo.md> [--section "Título"] [--mode body|append|after|write] [--claude] < texto
 *                                                   (el texto aparece en directo mientras llega)
 *   buho-docs snapshot <archivo.md> [--pages 1-3,8|todas] [--width 900] [--out p.png | --dir carpeta]   (fotos de páginas)
 *   buho-docs generar <archivo.md> "de qué va" [--paginas 10] [--kind presentacion] [--tema id]   (plan automático)
 *   buho-docs generar <archivo.md> --plan plan.json [--modelo haiku] [--paralelo 8]   (secciones o diapositivas
 *                                                   escritas a la vez por varios modelos, en directo)
 *   buho-docs bloques | insertar <archivo.md> <bloque> [--despues "Título"]   (bloques ya maquetados)
 *   buho-docs huecos <archivo.md> | rellenar <archivo.md> <id> (--imagen foto.png | --file contenido.md)
 *   buho-docs indice <archivo.md> [--niveles 2|3] [--quitar]   (índice automático con números de página)
 *   buho-docs plantillas | new <archivo.md> --plantilla acta|factura|presupuesto|propuesta|informe|carta|guia|one-pager|plan|cv|pitch|formacion|resultados [--tema id]
 *   buho-docs temas | tema crear <id> --principal "#rrggbb" --acento "#rrggbb" [--nombre "…"] [--logo logo.png] [--marca "…"] [--portada simple|ninguna] [--titulos "Fuente"] [--texto "Fuente"]
 *   buho-docs tema <archivo.md> <id>                 (aplicar un tema al documento)
 *   Para IAs (leer rápido y limpio, cambiar por id):
 *   buho-docs mapa <archivo.md> [--bloques]          (secciones con tokens e ids)
 *   buho-docs importar <archivo.docx|.pdf|.html|.txt> [--salida doc.md] [--tema id] [--ia]   (a Búho Docs; --ia lo maqueta con IA en paralelo;
 *                                                   los PDF van con IA salvo --rapido)
 *   buho-docs paginas <archivo.md>  ·  buho-docs pagina <archivo.md> <n> [--captura]   (texto, e imagen, de cada página)
 *   buho-docs leer <archivo.md> [--seccion "T" | --bloque #id | --desde #id] [--max 2000] [--ids]
 *   buho-docs buscar <archivo.md> "consulta"  ·  buho-docs buscar "consulta" --carpeta <carpeta>
 *   buho-docs bloque <archivo.md> #id  ·  buho-docs editar <archivo.md> #id --file nuevo.md [--mode replace|before|after|delete]
 *
 * El texto nuevo se pasa con --file <ruta>, con --text "…" o con - (entrada estándar).
 * Opciones globales: --author <nombre> (firma en el historial), --json, --no-launch.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Versión portable (portable.txt junto a BuhoDocs.exe): los datos, y con ellos api.json, van en «datos».
const portableDir = existsSync(join(here, '..', 'portable.txt')) ? join(here, '..', 'datos') : null
const dataDir = process.env.BUHO_DATA_DIR || portableDir || join(process.env.APPDATA || join(process.env.HOME || '', '.config'), 'BuhoDocs')


const FLAGS = new Set(['all', 'lines', 'json', 'no-launch', 'stdin', 'path', 'help', 'claude', 'quitar', 'ids', 'bloques', 'borrar', 'captura', 'ia', 'rapido', 'word'])
function parseArgs(argv) {
  const pos = []
  const opt = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--') && a.length > 2) {
      const k = a.slice(2)
      if (k.includes('=')) {
        const [kk, ...v] = k.split('=')
        opt[kk] = v.join('=')
      } else if (FLAGS.has(k) || argv[i + 1] === undefined) opt[k] = true
      else opt[k] = argv[++i]
    } else pos.push(a)
  }
  return { pos, opt }
}
export async function runCli(argv, io) {
  const R = (p) => resolve(io.cwd, p)
  const exitWith = (code) => {
    throw new CliExit(code)
  }
  const die = (msg, code = 1) => {
    io.err(msg + '\n')
    throw new CliExit(code)
  }
const { pos, opt } = parseArgs(argv)
const [cmd, ...args] = pos

const readInfo = () => {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'api.json'), 'utf8'))
  } catch {
    return null
  }
}

function skillPath() {
  return [join(here, 'SKILL.md'), join(here, '..', 'SKILL.md'), join(here, '..', 'skills', 'buho-docs', 'SKILL.md')].find((p) => existsSync(p))
}

function appExe() {
  const local = process.env.LOCALAPPDATA || ''
  return [join(here, '..', 'BuhoDocs.exe'), join(local, 'Programs', 'BuhoDocs', 'BuhoDocs.exe'), join(local, 'Programs', 'buho-open-docs', 'BuhoDocs.exe')].find((p) => existsSync(p))
}

async function alive(info) {
  if (!info) return false
  try {
    return (await fetch(info.url + '/v1/status', { headers: { authorization: `Bearer ${info.token}` } })).ok
  } catch {
    return false
  }
}

async function connect() {
  let info = readInfo()
  if (await alive(info)) return info
  const exe = opt['no-launch'] || io.env.BUHO_NO_LAUNCH ? undefined : appExe()
  if (!exe) die('Búho Docs no está abierto. Ábrelo (o instala la app) y vuelve a intentarlo.', 2)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref()
  io.err('Abriendo Búho Docs…\n')
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250))
    info = readInfo()
    if (await alive(info)) return info
  }
  die('He abierto Búho Docs pero no responde. Prueba de nuevo en unos segundos.', 2)
}

let conn = null
async function httpCall(method, path, body) {
  conn ??= await connect()
  let res
  try {
    res = await fetch(conn.url + path, {
      method,
      headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
  } catch {
    die('No puedo conectar con Búho Docs. ¿Está abierto?', 2)
  }
  const data = await res.json()
  if (!res.ok) die(`Error: ${data.error ?? res.status}`)
  return data
}
const call = io.call ?? httpCall

const qs = (o) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== true && v !== false) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

const out = (o) => io.out(JSON.stringify(o, null, 2) + '\n')
const print = (s) => io.out(s + '\n')

const file = (i, what = 'archivo .md') => {
  const a = args[i]
  if (!a) die(`Falta el ${what}. Uso: buho-docs ${cmd} <archivo.md> …  (buho-docs help)`)
  return R(a)
}

async function readStdin() {
  const chunks = []
  for await (const c of io.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
}

/** Texto nuevo: --file, --text, - (entrada estándar) o el argumento en la posición indicada. */
async function content(i, required = true) {
  if (typeof opt.file === 'string') {
    if (!existsSync(R(opt.file))) die(`No existe ${opt.file}`)
    return readFileSync(R(opt.file), 'utf8').replace(/^\uFEFF/, '')
  }
  if (typeof opt.text === 'string') return opt.text
  if (opt.stdin || args[i] === '-') return readStdin()
  if (args[i] !== undefined) return args[i]
  if (required) die('Falta el texto: usa --file <archivo>, --text "…" o - para leerlo de la entrada estándar')
  return undefined
}

const author = () => (typeof opt.author === 'string' ? opt.author : undefined)

/** Lee la salida stream-json de `claude -p` y manda el texto a una escritura en directo (cada 40 ms). */
async function pipeClaude(input, id) {
  let pending = ''
  let sending = Promise.resolve()
  let timer = null
  const flush = () => {
    timer = null
    if (!pending) return
    const text = pending
    pending = ''
    sending = sending.then(() => call('POST', '/v1/stream/chunk', { id, text }))
  }
  const push = (t) => {
    if (!t) return
    pending += t
    timer ??= setTimeout(flush, 40)
  }
  let buf = ''
  let streamed = false
  let finalText = ''
  let error = null
  for await (const chunk of input) {
    buf += chunk.toString('utf8')
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const ev = JSON.parse(line)
        const d = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' ? ev.event.delta : null
        if (d?.type === 'text_delta') {
          streamed = true
          push(d.text)
        } else if (ev.type === 'result' && ev.is_error) error = String(ev.result ?? ev.subtype ?? 'error del modelo')
        else if (ev.type === 'result' && typeof ev.result === 'string') finalText = ev.result
      } catch {
        /* línea que no es JSON */
      }
    }
  }
  if (!streamed && finalText && !error) push(finalText)
  if (timer) clearTimeout(timer)
  flush()
  await sending
  return { error, chars: streamed || finalText ? 1 : 0 }
}

function changed(r) {
  if (opt.json) return out(r)
  print(r.changed === false ? r.message ?? 'Sin cambios' : `Hecho${r.replaced ? ` (${r.replaced} cambio${r.replaced > 1 ? 's' : ''})` : ''} · ${r.path} · ${r.lines ?? ''} líneas · el usuario lo ve en directo`)
}

const when = (t) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

switch (cmd) {
  case 'status':
    out(await call('GET', '/v1/status'))
    break
  case 'docs': {
    const r = await call('GET', '/v1/docs')
    if (opt.json) { out(r); break }
    print('Abiertos:')
    for (const d of r.open) print(`  ${d.kind === 'presentacion' ? '[presentación]' : '[documento]   '} ${d.title} · ${d.path}`)
    if (!r.open.length) print('  (ninguno)')
    print('\nRecientes:')
    for (const d of r.recent.slice(0, 15)) print(`  ${d.exists ? ' ' : '✗'} ${d.title} · ${d.path}`)
    break
  }
  case 'templates':
    out(await call('GET', '/v1/templates'))
    break
  case 'new': {
    const path = file(0, 'archivo .md nuevo')
    const c = await content(1, false)
    const r = await call('POST', '/v1/new', { path, kind: opt.kind, title: opt.title, subtitle: opt.subtitle, estilo: opt.estilo, tema: opt.tema, plantilla: opt.plantilla, content: c, author: author() })
    opt.json ? out(r) : print(`Creado ${r.path} (${r.kind}) y abierto en Búho Docs`)
    break
  }
  case 'nuevo': {
    // Borrador sin guardar: no hace falta elegir dónde; se guarda luego con «guardar».
    const c = typeof opt.file === 'string' || typeof opt.text === 'string' || opt.stdin ? await content(9, false) : undefined
    const r = await call('POST', '/v1/nuevo', { nombre: args[0], kind: opt.kind, title: opt.title, subtitle: opt.subtitle, tema: opt.tema, plantilla: opt.plantilla, content: c })
    opt.json ? out(r) : print(r.path)
    if (!opt.json) io.err('Borrador sin guardar abierto en Búho Docs. Guárdalo con: buho-docs guardar <esta ruta> <destino.md>\n')
    break
  }
  case 'guardar': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs guardar <borrador.md> <destino.md>')
    const r = await call('POST', '/v1/guardar', { path, como: R(args[1]) })
    opt.json ? out(r) : print(`Guardado en ${r.path}`)
    break
  }
  case 'open': {
    const r = await call('POST', '/v1/open', { path: file(0) })
    opt.json ? out(r) : print(`Abierto: ${r.title} · ${r.path}`)
    break
  }
  case 'read': {
    const r = await call('GET', '/v1/read' + qs({ path: file(0) }))
    if (opt.json) out(r)
    else if (opt.lines) {
      const ls = r.content.split(/\r?\n/)
      const w = String(ls.length).length
      print(ls.map((l, i) => `${String(i + 1).padStart(w)}  ${l}`).join('\n'))
    } else io.out(r.content)
    break
  }
  case 'outline': {
    const r = await call('GET', '/v1/outline' + qs({ path: file(0) }))
    if (opt.json) { out(r); break }
    print(`${r.kind === 'presentacion' ? 'Presentación' : 'Documento'}: ${r.title}\n`)
    if (r.slides) {
      for (const s of r.slides) {
        print(`Diapositiva ${s.n} (línea ${s.line}, ${s.layout}): ${s.title}`)
        for (const h of r.headings.filter((x) => x.slide === s.n && x.level >= 3)) print(`    ${'#'.repeat(h.level)} ${h.text}  (línea ${h.line})`)
      }
    } else r.headings.forEach((h, i) => print(`#${String(i + 1).padEnd(3)} ${'  '.repeat(h.level - 1)}${h.text}  (línea ${h.line})`))
    break
  }
  case 'write': {
    const path = file(0)
    changed(await call('POST', '/v1/write', { path, content: await content(1), author: author(), summary: opt.summary }))
    break
  }
  case 'replace': {
    const path = file(0)
    if (args[1] === undefined || (args[2] === undefined && typeof opt.with !== 'string')) die('Uso: buho-docs replace <archivo.md> "texto exacto" "texto nuevo" [--all]')
    changed(await call('POST', '/v1/replace', { path, find: args[1], replace: args[2] ?? opt.with, all: !!opt.all, author: author() }))
    break
  }
  case 'section': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs section <archivo.md> "Título de la sección" --file parte.md [--mode body|replace|append|before|after|delete]')
    const mode = opt.mode ?? 'body'
    changed(await call('POST', '/v1/section', { path, heading: args[1], content: mode === 'delete' ? '' : await content(2), mode, author: author() }))
    break
  }
  case 'slide': {
    const path = file(0)
    const n = Number(args[1])
    if (!Number.isInteger(n)) die('Uso: buho-docs slide <archivo.md> <n> --file diapo.md [--mode replace|insert|delete|move] [--to N]')
    const mode = opt.mode ?? 'replace'
    changed(await call('POST', '/v1/slide', { path, n, mode, to: opt.to, content: mode === 'delete' || mode === 'move' ? '' : await content(2), author: author() }))
    break
  }
  case 'append': {
    const path = file(0)
    changed(await call('POST', '/v1/append', { path, content: await content(1), author: author() }))
    break
  }
  case 'meta': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs meta <archivo.md> <campo> ["valor"]  (sin valor quita el campo)')
    changed(await call('POST', '/v1/meta', { path, key: args[1], value: args[2] ?? null, author: author() }))
    break
  }
  case 'export': {
    const path = file(0)
    const word = opt.word || /^(docx|word)$/i.test(String(opt.formato ?? '')) || /\.docx$/i.test(String(opt.out ?? ''))
    io.err(word ? 'Exportando a Word…\n' : 'Exportando a PDF…\n')
    const r = await call('POST', '/v1/export', { path, out: typeof opt.out === 'string' ? R(opt.out) : undefined, formato: word ? 'docx' : undefined })
    if (opt.json) { out(r); break }
    if (word) { print(`Word: ${r.file} · ${(r.bytes / 1024).toFixed(0)} KB`); break }
    print(`PDF: ${r.file} · ${r.pages} ${r.kind === 'presentacion' ? 'diapositivas' : 'páginas'} · ${(r.bytes / 1024).toFixed(0)} KB`)
    for (const w of r.warnings) print(`  ${w.level === 'error' ? 'ERROR' : 'aviso'}${w.slide ? ` diap. ${w.slide}` : ''}${w.line ? ` línea ${w.line}` : ''}: ${w.message}`)
    break
  }
  case 'check': {
    const r = await call('GET', '/v1/check' + qs({ path: file(0) }))
    if (opt.json) { out(r); break }
    print(`${r.kind === 'presentacion' ? 'Presentación' : 'Documento'}: ${r.pages} ${r.kind === 'presentacion' ? 'diapositivas' : 'páginas'}`)
    if (!r.warnings.length) print('Sin avisos.')
    for (const w of r.warnings) print(`  ${w.level === 'error' ? 'ERROR' : 'aviso'}${w.slide ? ` diap. ${w.slide}` : ''}${w.line ? ` línea ${w.line}` : ''}: ${w.message}`)
    break
  }
  case 'history': {
    const r = await call('GET', '/v1/history' + qs({ path: file(0), limit: opt.limit }))
    if (opt.json) { out(r); break }
    for (const h of r) print(`${h.id.slice(0, 8)}  ${when(h.at)}  ${(h.kind === 'user' ? 'Tú' : h.author).padEnd(14)}  +${h.added} −${h.removed}  ${h.summary}`)
    break
  }
  case 'diff': {
    const path = file(0)
    let id = args[1]
    if (id && id.length < 36) id = (await call('GET', '/v1/history' + qs({ path, limit: 300 }))).find((h) => h.id.startsWith(id))?.id ?? id
    const r = await call('GET', '/v1/diff' + qs({ path, id }))
    if (opt.json) { out(r); break }
    print(`${when(r.at)} · ${r.kind === 'user' ? 'Tú' : r.author} · ${r.summary}\n`)
    print(r.diff || '(sin diferencias)')
    break
  }
  case 'restore': {
    const path = file(0)
    let id = args[1]
    if (!id) die('Uso: buho-docs restore <archivo.md> <id>  (ids en buho-docs history)')
    if (id.length < 36) id = (await call('GET', '/v1/history' + qs({ path, limit: 300 }))).find((h) => h.id.startsWith(id))?.id ?? id
    changed(await call('POST', '/v1/restore', { path, id, author: author() }))
    break
  }
  case 'show': {
    const r = await call('POST', '/v1/show', { path: file(0), line: opt.line })
    opt.json ? out(r) : print(`En pantalla: ${r.path}`)
    break
  }
  case 'tag': {
    const r = await call('POST', '/v1/tag', { path: file(0), author: author() ?? 'IA', seconds: opt.seconds })
    opt.json ? out(r) : print(r.message)
    break
  }
  case 'batch': {
    const path = file(0)
    const raw = await content(1)
    let ops
    try {
      ops = raw.trim().startsWith('[') ? JSON.parse(raw) : raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
    } catch (e) {
      die(`La lista de cambios no es JSON válido (un array, o un objeto por línea): ${e.message}`)
    }
    // "file": ruta → el contenido sale de ese archivo (sin escapar saltos de línea en el JSON).
    for (const o of ops) {
      if (typeof o.file === 'string') {
        if (!existsSync(R(o.file))) die(`No existe ${o.file}`)
        o.content = readFileSync(R(o.file), 'utf8').replace(/^\uFEFF/, '')
        delete o.file
      }
    }
    const r = await call('POST', '/v1/batch', { path, ops, author: author() })
    if (opt.json) out(r)
    else print(`Hecho: ${r.applied} cambio${r.applied === 1 ? '' : 's'} de una vez${r.created ? ' (documento creado)' : ''} · ${r.path} · el usuario lo ve en directo`)
    break
  }
  case 'stream': {
    const path = file(0)
    const st = await call('POST', '/v1/stream/start', { path, heading: opt.section, mode: opt.mode, author: author(), summary: opt.summary })
    let pending = ''
    let sending = Promise.resolve()
    let timer = null
    const flush = () => {
      timer = null
      if (!pending) return
      const text = pending
      pending = ''
      sending = sending.then(() => call('POST', '/v1/stream/chunk', { id: st.id, text }))
    }
    const push = (t) => {
      if (!t) return
      pending += t
      timer ??= setTimeout(flush, 40)
    }
    if (opt.claude) {
      await pipeClaude(io.stdin, st.id)
      const r = await call('POST', '/v1/stream/end', { id: st.id })
      opt.json ? out(r) : print(`Escrito en directo: ${r.chars} caracteres · ${r.path}`)
      break
    }
    // --claude: lee la salida de `claude -p … --output-format stream-json --include-partial-messages --verbose`
    let buf = ''
    let streamed = false
    let finalText = ''
    for await (const chunk of io.stdin) {
      const t = chunk.toString('utf8')
      if (!opt.claude) {
        push(t)
        continue
      }
      buf += t
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          const d = ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' ? ev.event.delta : null
          if (d?.type === 'text_delta') {
            streamed = true
            push(d.text)
          } else if (ev.type === 'result' && typeof ev.result === 'string') finalText = ev.result
        } catch {
          /* línea que no es JSON */
        }
      }
    }
    if (opt.claude && !streamed && finalText) push(finalText)
    if (timer) clearTimeout(timer)
    flush()
    await sending
    const r = await call('POST', '/v1/stream/end', { id: st.id })
    opt.json ? out(r) : print(`Escrito en directo: ${r.chars} caracteres · ${r.path}`)
    break
  }
  case 'snapshot': {
    const r = await call('GET', '/v1/snapshot' + qs({ path: file(0), pages: opt.pages ?? opt.page, width: opt.width, out: typeof opt.out === 'string' ? R(opt.out) : undefined, dir: typeof opt.dir === 'string' ? R(opt.dir) : undefined }))
    opt.json ? out(r) : print(r.files.map((x) => x.file).join('\n'))
    break
  }
  case 'generar': {
    async function planDesde(sobre) {
      const presentacion = /^presentaci|^slides?$|^deck$/i.test(opt.kind ?? '')
      const paginas = Math.max(1, Number(opt.paginas) || (presentacion ? 8 : 10))
      const partes = presentacion ? paginas : Math.max(3, Math.round(paginas * 0.8))
      const palabras = presentacion ? 50 : Math.round((paginas * 380) / partes)
      const t = Date.now()
      io.err(`Pensando el plan (${partes} ${presentacion ? 'diapositivas' : 'secciones'})…\n`)
      const pedir = [
        `Prepara el plan de ${presentacion ? 'una presentación de ' + partes + ' diapositivas' : 'un documento de unas ' + paginas + ' páginas A4 con ' + partes + ' secciones'} sobre: «${sobre}».`,
        'Español de España. Devuelve SOLO un JSON válido, sin texto alrededor ni bloques de código, con esta forma:',
        presentacion
          ? '{"titulo": "…", "contexto": "para quién es y con qué tono, en una frase", "diapositivas": [{"titulo": "…", "etiqueta": "EN MAYÚSCULAS", "diseno": "portada|normal|seccion|cierre", "pide": "qué debe contar, concreto"}]} (la primera con diseno portada y la última cierre)'
          : '{"titulo": "…", "subtitulo": "…", "etiqueta": "TEMA · SUBTEMA EN MAYÚSCULAS", "contexto": "para quién es y con qué tono, en una frase", "secciones": [{"titulo": "1. …", "pide": "qué debe contar, concreto, en una o dos frases"}]}',
        'Los títulos de sección, numerados y cortos. Que las partes no se solapen.'
      ].join('\n')
      const out = await new Promise((ok, ko) => {
        const child = spawn('claude', ['-p', '--model', opt['modelo-plan'] ?? 'haiku', '--output-format', 'json'], { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
        let o = ''
        child.stdout.on('data', (d) => (o += d))
        child.on('error', ko)
        child.on('close', () => ok(o))
        child.stdin.end(pedir)
      })
      let res
      try {
        res = JSON.parse(out)
      } catch {
        die(`El modelo no ha devuelto un plan: ${String(out).slice(0, 200)}`)
      }
      if (res.is_error) die(`No se pudo hacer el plan: ${res.result}${/auth|login|OAuth/i.test(String(res.result)) ? '. Ejecuta «claude» en una terminal e inicia sesión.' : ''}`)
      const txt = String(res.result ?? '')
      const json = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)
      let p
      try {
        p = JSON.parse(json)
      } catch {
        die(`El plan no es JSON válido: ${txt.slice(0, 200)}`)
      }
      p.tipo = presentacion ? 'presentacion' : 'documento'
      if (!presentacion) p.palabras = palabras
      const lista = (presentacion ? p.diapositivas : p.secciones) ?? []
      io.err(`Plan en ${((Date.now() - t) / 1000).toFixed(1)} s: «${p.titulo}»\n${lista.map((x) => '  · ' + x.titulo).join('\n')}\n`)
      return p
    }
    // Generación en paralelo: un plan con secciones (o diapositivas); cada una la escribe un modelo
    // distinto a la vez, en directo, en su hueco del documento.
    const path = file(0)
    let plan
    if (typeof opt.plan === 'string') {
      if (!existsSync(R(opt.plan))) die(`No existe ${opt.plan}`)
      plan = JSON.parse(readFileSync(R(opt.plan), 'utf8').replace(/^\uFEFF/, ''))
    } else {
      // De una frase: un modelo rápido hace el plan (índice y qué contar en cada parte).
      const sobre = typeof opt.sobre === 'string' ? opt.sobre : args[1]
      if (!sobre) die('Uso: buho-docs generar <archivo.md> "de qué va el documento" [--paginas 10] [--kind presentacion] [--tema id]  ·  o con --plan plan.json')
      plan = await planDesde(sobre)
    }
    if (typeof opt.tema === 'string') plan.tema = opt.tema
    const deck = /^presentaci/i.test(plan.tipo ?? '') || Array.isArray(plan.diapositivas)
    const items = (deck ? plan.diapositivas : plan.secciones) ?? []
    if (!items.length) die('El plan no tiene «secciones» (documento) ni «diapositivas» (presentación)')
    const modelo = opt.modelo ?? plan.modelo ?? 'haiku'
    const paralelo = Math.max(1, Number(opt.paralelo ?? plan.paralelo) || 8)
    const quien = author() ?? `Claude (${modelo})`
    const q = (s) => JSON.stringify(String(s ?? ''))
    const id = (i) => `gen-${i + 1}`
    // 1 · Esqueleto: cabecera, títulos y un hueco por sección (se ve al momento).
    const skel = items
      .map((it, i) =>
        deck
          ? `${i ? '---\n\n' : ''}${it.diseno ? `@diseño: ${it.diseno}\n` : ''}${it.etiqueta ? `@etiqueta: ${it.etiqueta}\n` : ''}\n${i === 0 && !it.diseno ? '# ' : '## '}${it.titulo}\n\n::: hueco id=${id(i)} texto="Escribiendo…"\n:::\n`
          : `## ${it.titulo}\n\n::: hueco id=${id(i)} texto="Escribiendo «${String(it.titulo).replace(/"/g, "'")}»…"\n:::\n`
      )
      .join('\n')
    const t0 = Date.now()
    if (existsSync(path)) {
      await call('POST', '/v1/batch', { path, ops: [{ op: 'append', content: skel }], author: quien })
    } else {
      const front = ['---', `tipo: ${deck ? 'presentacion' : 'documento'}`, plan.tema ? `tema: ${plan.tema}` : plan.estilo ? `estilo: ${plan.estilo}` : null, `titulo: ${q(plan.titulo ?? 'Sin título')}`, plan.subtitulo ? `subtitulo: ${q(plan.subtitulo)}` : null, plan.etiqueta ? `etiqueta: ${q(plan.etiqueta)}` : null, '---', '']
        .filter((l) => l !== null)
        .join('\n')
      await call('POST', '/v1/batch', { path, ops: [{ op: 'write', content: front + '\n' + skel }], author: quien })
    }
    io.err(`Esqueleto con ${items.length} ${deck ? 'diapositivas' : 'secciones'} en ${Date.now() - t0} ms. Escribiendo ${Math.min(paralelo, items.length)} a la vez con ${modelo}…\n`)
    // 2 · Un modelo por sección, `paralelo` a la vez, cada uno escribiendo en directo en su hueco.
    const sintaxis = deck
      ? 'Es el CONTENIDO de una diapositiva 16:9 (sin el título, que ya está). Muy breve: de 3 a 5 viñetas cortas, o un bloque «::: tarjetas 2» o «::: tarjetas 3» con «### Título {icon=reloj}» y una línea de texto por tarjeta, o un «::: cifras 3» con «- **cifra** texto». Como mucho 60 palabras.'
      : `Es el CUERPO de una sección de un documento A4 (sin el título, que ya está). Unas ${'${palabras}'} palabras. Párrafos claros, negritas para lo importante, alguna lista. Puedes usar como mucho un bloque visual: «::: caja icon=bombilla» … «:::», o «::: tarjetas 3» con «### Título {icon=reloj}» y texto, o una tabla Markdown.`
    const breve = 'Es el texto de una diapositiva de portada o de cierre: solo una o dos frases cortas (con alguna negrita), sin listas ni bloques.'
    // Modo convertir: la parte trae su texto original («fuente», o «fuente_archivo») y solo se maqueta.
    const fuenteDe = (it) => it.fuente ?? (it.fuente_archivo ? readFileSync(R(it.fuente_archivo), 'utf8') : '')
    const convertir = (it, i) =>
      [
        `Convierte a Markdown de Búho Docs la parte ${i + 1} de ${items.length} («${it.titulo}») de un documento titulado «${plan.titulo ?? ''}». Es un texto extraído de un PDF o Word: los saltos de línea y columnas pueden estar rotos.`,
        'Mantén TODO el contenido, con las mismas palabras y cifras: no resumas, no añadas, no inventes. Recompón párrafos, listas y tablas (las tablas como tablas Markdown | col | col |). Usa ### para los apartados internos. Si encaja, una idea clave en «::: caja icon=bombilla» … «:::».',
        'No pongas el título de la parte (ya está). Devuelve solo el Markdown, sin bloques de código alrededor ni comentarios.',
        '--- TEXTO ORIGINAL ---',
        fuenteDe(it)
      ].join('\n')
    const prompt = (it, i) =>
      fuenteDe(it) ? convertir(it, i) : [
        `Escribe en español de España, en Markdown, para ${deck ? 'una presentación' : 'un documento'} titulado «${plan.titulo ?? ''}».`,
        plan.contexto ? `Contexto: ${plan.contexto}` : '',
        `Parte ${i + 1} de ${items.length}: «${it.titulo}».`,
        it.pide ? `Qué debe contar: ${it.pide}` : '',
        deck && /^(portada|cierre|seccion|cita)$/i.test(it.diseno ?? '') ? breve : sintaxis.replace('${palabras}', String(it.palabras ?? plan.palabras ?? 450)),
        'Iconos válidos: reloj, check, equipo, ventas, datos, escudo, objetivo, cerebro, ley, alerta, bombilla, dinero, soporte, robot.',
        'No inventes cifras, estudios ni porcentajes concretos. No repitas el título. Devuelve solo el Markdown, sin bloques de código alrededor ni comentarios.'
      ]
        .filter(Boolean)
        .join('\n')
    const runOne = async (it, i) => {
      const t = Date.now()
      const st = await call('POST', '/v1/stream/start', { path, hueco: id(i), author: quien, summary: `${items.length} ${deck ? 'diapositivas' : 'secciones'} generadas en paralelo` })
      const child = spawn('claude', ['-p', '--model', modelo, '--output-format', 'stream-json', '--include-partial-messages', '--verbose'], { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'ignore'] })
      child.stdin.end(prompt(it, i))
      const res = await pipeClaude(child.stdout, st.id)
      if (res.error || !res.chars) {
        // El hueco vuelve (con el motivo) para poder reintentar esa parte.
        const why = (res.error ?? 'el modelo no ha devuelto texto').replace(/"/g, "'").slice(0, 120)
        await call('POST', '/v1/stream/chunk', { id: st.id, text: `::: hueco id=${id(i)} texto="Falló: ${why}"\n:::` })
        await call('POST', '/v1/stream/end', { id: st.id })
        fallos.push(`${it.titulo}: ${why}`)
        io.err(`  ✗ ${it.titulo} · ${why}\n`)
        return null
      }
      const r = await call('POST', '/v1/stream/end', { id: st.id })
      io.err(`  ✓ ${it.titulo} · ${r.chars} caracteres · ${((Date.now() - t) / 1000).toFixed(1)} s\n`)
      return r
    }
    const fallos = []
    const queue = items.map((it, i) => () => runOne(it, i))
    await Promise.all(Array.from({ length: Math.min(paralelo, queue.length) }, async () => {
      while (queue.length) await queue.shift()()
    }))
    const ck = await call('GET', '/v1/check' + qs({ path }))
    const total = ((Date.now() - t0) / 1000).toFixed(1)
    if (opt.json) out({ ok: true, path, segundos: Number(total), pages: ck.pages, warnings: ck.warnings })
    else {
      print(`Hecho en ${total} s: ${ck.pages} ${deck ? 'diapositivas' : 'páginas'} · ${path}`)
      for (const w of ck.warnings) print(`  ${w.level === 'error' ? 'ERROR' : 'aviso'}${w.slide ? ` diap. ${w.slide}` : ''}${w.line ? ` línea ${w.line}` : ''}: ${w.message}`)
    }
    if (fallos.length) {
      io.err(`\n${fallos.length} parte(s) fallaron y quedan como hueco:\n  ${fallos.join('\n  ')}\n${/auth|login|OAuth/i.test(fallos.join(' ')) ? 'Parece que la sesión de claude ha caducado: abre una terminal, ejecuta «claude» e inicia sesión.\n' : ''}`)
      exitWith(1)
    }
    break
  }
  case 'bloques': {
    const r = await call('GET', '/v1/bloques')
    if (opt.json) { out(r); break }
    for (const b of r.bloques) print(`${b.id.padEnd(14)} ${b.label}${b.propio ? '  (propio)' : ''}`)
    print(`\nTus bloques: guarda .md en ${r.carpeta}`)
    break
  }
  case 'insertar': {
    const path = file(0)
    if (!args[1] && typeof opt.file !== 'string' && typeof opt.text !== 'string') die('Uso: buho-docs insertar <archivo.md> <bloque> [--despues "Título"]  (o --file contenido.md)')
    const txt = typeof opt.file === 'string' || typeof opt.text === 'string' ? await content(9) : undefined
    changed(await call('POST', '/v1/insertar', { path, bloque: txt ? undefined : args[1], content: txt, despues: opt.despues, author: author() }))
    break
  }
  case 'rellenar': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs rellenar <archivo.md> <id-del-hueco> (--imagen foto.png [--ancho 80%] | --file contenido.md | --text "…")')
    const img = typeof opt.imagen === 'string' ? opt.imagen : undefined
    changed(await call('POST', '/v1/rellenar', { path, id: args[1], imagen: img, ancho: opt.ancho, alt: opt.alt, content: img ? undefined : await content(2), author: author() }))
    break
  }
  case 'huecos': {
    const r = await call('GET', '/v1/huecos' + qs({ path: file(0) }))
    if (opt.json) { out(r); break }
    if (!r.length) print('No hay huecos pendientes.')
    for (const h of r) print(`${(h.id || '(sin id)').padEnd(20)} línea ${h.line}  ${h.texto}`)
    break
  }
  case 'indice': {
    changed(await call('POST', '/v1/indice', { path: file(0), niveles: opt.niveles, quitar: !!opt.quitar, author: author() }))
    break
  }
  case 'plantillas': {
    const r = await call('GET', '/v1/plantillas')
    if (opt.json) { out(r); break }
    for (const p of r.plantillas) print(`${p.id.padEnd(12)} ${p.tipo === 'presentacion' ? '[presentación]' : '[documento]   '} ${p.nombre} · ${p.descripcion}`)
    print(`\nTus plantillas: guarda .md en ${r.carpeta}`)
    break
  }
  case 'temas': {
    const r = await call('GET', '/v1/temas')
    if (opt.json) { out(r); break }
    for (const t of r.temas) print(`${t.id.padEnd(14)} ${t.nombre}${t.propio ? ' (propio)' : ''} · ${t.colores.principal} / ${t.colores.acento} · portada ${t.portada ?? 'ninguna'}${t.logo ? ' · con logo' : ''}`)
    print(`\nTus temas: ${r.carpeta}\\<id>\\tema.json (+ logo y estilo.css)`)
    break
  }
  case 'tema': {
    if (args[0] === 'crear') {
      if (!args[1]) die('Uso: buho-docs tema crear <id> --principal "#1f3b63" --acento "#2f80ed" [--nombre "…"] [--logo logo.png] [--marca "…"] [--portada simple|ninguna]')
      const r = await call('POST', '/v1/temas', { id: args[1], nombre: opt.nombre, principal: opt.principal, acento: opt.acento, suave: opt.suave, texto: opt.color_texto, titulos: opt.titulos, fuenteTexto: opt.texto, logo: typeof opt.logo === 'string' ? R(opt.logo) : undefined, marca: opt.marca, pie: opt.pie, portada: opt.portada, base: opt.base })
      opt.json ? out(r) : print(`Tema «${r.nombre}» creado (${r.id}). Úsalo con: buho-docs tema <archivo.md> ${r.id}`)
      break
    }
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs tema <archivo.md> <id>  (ids en buho-docs temas)')
    changed(await call('POST', '/v1/batch', { path, ops: [{ op: 'meta', key: 'estilo', value: null }, { op: 'meta', key: 'tema', value: args[1] }], author: author() }))
    break
  }
  case 'importar': {
    const src = file(0, 'archivo a importar (.docx, .pdf, .html, .txt)')
    const salida = typeof opt.salida === 'string' ? R(opt.salida) : undefined
    const t0 = Date.now()
    // Los PDF no tienen estructura (las tablas salen aplanadas): por defecto se maquetan con IA en
    // paralelo. Con --rapido, solo la conversión automática (segundos, sin IA). Word va bien sin IA.
    if (/\.pdf$/i.test(src) && !opt.rapido) opt.ia = true
    const r = await call('POST', '/v1/importar', { path: src, salida, tema: opt.ia ? undefined : opt.tema, abrir: !opt.ia })
    if (!opt.ia) {
      if (opt.json) { out(r); break }
      print(`Importado en ${r.ms} ms: «${r.titulo}» · ${r.palabras} palabras · ${r.secciones.length} secciones${r.imagenes ? ` · ${r.imagenes} imágenes` : ''}\n${r.path}`)
      for (const a of r.avisos) io.err(`  aviso: ${a}\n`)
      break
    }
    // --ia: el texto importado se reparte por secciones y varios modelos lo maquetan a la vez (sin
    // resumir ni inventar), en directo, en un documento nuevo.
    io.err(`Importado en ${r.ms} ms (${r.secciones.length} secciones). Repaso con IA en paralelo…\n`)
    const md = readFileSync(r.path, 'utf8')
    const cuerpo = md.replace(/^---[\s\S]*?\n---\n/, '')
    const partes = cuerpo.split(/^(?=## )/m).map((x) => x.trim()).filter(Boolean)
    const secciones = partes.map((x, i) => {
      const m = x.match(/^## (.+)\n?/)
      return { titulo: m ? m[1].trim() : i === 0 ? 'Introducción' : `Parte ${i + 1}`, fuente: m ? x.slice(m[0].length) : x }
    }).filter((x) => x.fuente.trim())
    const planFile = join(dirname(r.path), `.${basename(r.path, '.md')}.plan.json`)
    writeFileSync(planFile, JSON.stringify({ tipo: 'documento', titulo: r.titulo, tema: opt.tema ?? 'buho', secciones }))
    unlinkSync(r.path)
    const code = await runCli(['generar', r.path, '--plan', planFile, ...(opt.modelo ? ['--modelo', opt.modelo] : []), '--paralelo', String(opt.paralelo ?? secciones.length), ...(author() ? ['--author', author()] : [])], io)
    unlinkSync(planFile)
    io.err(`Total, de ${basename(src)} al documento maquetado: ${((Date.now() - t0) / 1000).toFixed(1)} s\n`)
    return code
  }
  case 'paginas': {
    const r = await call('GET', '/v1/paginas' + qs({ path: file(0) }))
    if (opt.json) { out(r); break }
    print(`${r.total} ${r.kind === 'presentacion' ? 'diapositivas' : 'páginas'}`)
    for (const p of r.pages) print(`${String(p.n).padStart(3)}  ${String(p.tokens).padStart(4)} tok  ${p.titles.length ? p.titles.join(' · ') : p.preview}`)
    break
  }
  case 'pagina': {
    const n = Number(args[1])
    if (!Number.isInteger(n)) die('Uso: buho-docs pagina <archivo.md> <n> [--captura] [--width 900] [--out p.png]')
    const r = await call('GET', '/v1/pagina' + qs({ path: file(0), n, captura: opt.captura ? 'true' : undefined, width: opt.width, out: typeof opt.out === 'string' ? R(opt.out) : undefined }))
    if (opt.json) { out(r); break }
    print(r.text)
    io.err(`\n— página ${r.n} de ${r.total} · ${r.tokens} tokens${r.captura ? ` · captura: ${r.captura}` : ''}\n`)
    break
  }
  case 'mapa': {
    const r = await call('GET', '/v1/mapa' + qs({ path: file(0), bloques: opt.bloques ? 'true' : undefined }))
    if (opt.json) { out(r); break }
    const N = (n) => Number(n).toLocaleString('es-ES')
    print(`${r.kind === 'presentacion' ? 'Presentación' : 'Documento'} «${r.title}» · ${N(r.tokens)} tokens · ${r.nBlocks} bloques · versión ${r.hash}`)
    for (const s of r.sections) print(`#${s.id.padEnd(8)} ${'  '.repeat(s.level - 1)}${s.title}  ·  ${N(s.tokens)} tok  ·  ${s.blocks} bloques  ·  l. ${s.line}-${s.end}`)
    if (r.blocks) {
      print('')
      for (const b of r.blocks) print(`#${b.id.padEnd(8)} ${b.type.padEnd(9)} ${String(b.tokens).padStart(4)} tok  ${b.preview}`)
    }
    break
  }
  case 'leer': {
    const r = await call('GET', '/v1/leer' + qs({ path: file(0), seccion: opt.seccion, bloque: opt.bloque, desde: opt.desde, max: opt.max ?? opt['max-tokens'], ids: opt.ids ? 'true' : undefined }))
    if (opt.json) { out(r); break }
    print(r.text)
    io.err(`\n— ${r.blocks} bloques · ${r.tokens} tokens${r.next ? ` · sigue en --desde ${r.next}` : ''}\n`)
    break
  }
  case 'buscar': {
    const folder = typeof opt.carpeta === 'string' ? R(opt.carpeta) : undefined
    const q = folder ? args[0] : args[1]
    if (!q) die('Uso: buho-docs buscar <archivo.md> "consulta"  ·  buho-docs buscar "consulta" --carpeta <carpeta>')
    const r = await call('GET', '/v1/buscar' + qs({ q, path: folder ? undefined : file(0), carpeta: folder, limite: opt.limite }))
    if (opt.json) { out(r); break }
    if (!r.hits.length) print(`Nada sobre «${q}» (${r.files} documento(s), ${r.ms} ms).`)
    for (const h of r.hits) print(`#${h.id.padEnd(8)} ${String(h.score).padStart(5)}  ${folder ? h.path.split(/[\\/]/).pop() + ' › ' : ''}${h.section || '(inicio)'} · l. ${h.line}\n          ${h.snippet}`)
    io.err(`— ${r.hits.length} resultado(s) en ${r.files} documento(s) · ${r.ms} ms\n`)
    break
  }
  case 'bloque': {
    const r = await call('GET', '/v1/bloque' + qs({ path: file(0), id: args[1] }))
    if (opt.json) out(r)
    else print(`#${r.id} · ${r.type} · ${r.path || '(inicio)'} · líneas ${r.line}-${r.end}\n\n${r.markdown}`)
    break
  }
  case 'editar': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs editar <archivo.md> #id (--file nuevo.md | --text "…") [--mode replace|before|after|delete]')
    const mode = opt.mode ?? (opt.borrar ? 'delete' : 'replace')
    changed(await call('POST', '/v1/bloque', { path, id: args[1], mode, content: mode === 'delete' ? '' : await content(2), author: author() }))
    break
  }
  case 'skill': {
    const p = skillPath()
    if (!p) die('No encuentro el SKILL.md (va junto al CLI, en la carpeta «cli» de la app).')
    io.out(opt.path ? p + '\n' : readFileSync(p, 'utf8'))
    break
  }
  default: {
    const help = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\r?\n\/\*\*?\r?\n?/, '').replace(/^ \* ?/gm, '')
    const p = skillPath()
    io.out(help + (p ? `\nGuía completa (sintaxis, bloques, diseños de diapositiva, ejemplos y reglas): ${p}\n` : '') + '\n')
    exitWith(cmd && cmd !== 'help' ? 1 : 0)
  }
}
  return 0
}

/** Fin del comando con un código de salida (sin cerrar el proceso: dentro de la app hay muchos a la vez). */
export class CliExit extends Error {
  constructor(code) {
    super('exit ' + code)
    this.code = code
  }
}

/** Ejecución normal desde la terminal (Node o el ejecutable de la app en modo Node). */
const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const io = { cwd: process.cwd(), env: process.env, stdin: process.stdin, out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }
  runCli(process.argv.slice(2), io).then(
    (code) => process.exit(code ?? 0),
    (e) => {
      if (e instanceof CliExit) process.exit(e.code)
      process.stderr.write(String(e?.stack ?? e) + '\n')
      process.exit(1)
    }
  )
}
