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
 *
 *   Revisión (control de cambios y comentarios):
 *   buho-docs <cualquier cambio> … --proponer       # el cambio queda como propuesta en vez de escribirse
 *   buho-docs revision <archivo.md> [si|no]          # modo revisión: todo cambio de la IA llega como propuesta
 *   buho-docs propuestas <archivo.md>                # pendientes, con su diff
 *   buho-docs aceptar|rechazar <archivo.md> <id|todas>
 *   buho-docs comentarios <archivo.md> [--abiertos]  # con su línea y su bloque (#id)
 *   buho-docs comentar <archivo.md> "texto" (--cita "…" | --bloque #b… | --linea N)
 *   buho-docs responder <archivo.md> <id> "respuesta" [--resolver] · resolver <archivo.md> <id>
 *   buho-docs atender <archivo.md> [--directo] [--modelo sonnet]  # un agente por bloque comentado, a la vez
 *
 *   Comprobación visual (siempre, tras cambiar algo):
 *   (cada cambio dice qué páginas ha tocado y sus avisos visuales)
 *   buho-docs revisar <archivo.md> [páginas] [--sin-capturas]  # capturas y avisos de lo cambiado desde la última revisión
 *   buho-docs scan <archivo.md> [--capturas]        # todo el documento: avisos por página y mosaico (todas en una imagen)
 *
 *   Torneo (varias versiones de una zona a la vez; eliges la mejor):
 *   buho-docs torneo <archivo.md> (--seccion "T" | --bloque #b… | --hueco id | --diapositiva N) [--n 3] [--modelos sonnet,opus] [--pide "…"]
 *   buho-docs elegir <archivo.md> <propuesta>       # aplica esa variante y descarta las demás
 *
 *   Aire IA (frases y costumbres de texto generado):
 *   buho-docs estilo <archivo.md>                   # dónde está y qué hacer (determinista)
 *   buho-docs humanizar <archivo.md> [--directo]    # un agente por bloque, a la vez; deja propuestas
 *
 *   Modelos (generar, torneo, atender, humanizar): --proveedor claude|cerebras|groq, o --mega (el más rápido)
 *   buho-docs proveedores                           # qué hay configurado
 *   buho-docs proveedor cerebras --env archivo.env [--defecto]   # clave leída del .env (no se enseña)
 *
 *   Imágenes:
 *   buho-docs imagenes buscar "consulta" [--n 8] [--forma horizontal]   # banco con licencia: hoja de contactos
 *   buho-docs imagenes poner <doc> <búsqueda> <n> [--seccion "T"] [--ancho 70]   # con su pie de créditos
 *   buho-docs imagenes generar <doc> "qué imagen" [--seccion "T"]   # OpenAI, de pago: proveedor openai --imagenes si
 *
 *   buho-docs open <archivo.md>                     (lo abre y lo enseña)
 *   buho-docs read <archivo.md> [--lines]           (contenido; --lines con números de línea)
 *   buho-docs outline <archivo.md>                  (títulos y diapositivas con su línea)
 *   buho-docs write <archivo.md> --file nuevo.md    (reescribe entero; - lee de la entrada estándar)
 *   buho-docs replace <archivo.md> "texto" "nuevo" [--all]          (erratas y cambios puntuales)
 *   buho-docs section <archivo.md> "Título" --file parte.md [--mode body|replace|append|before|after|delete]
 *   buho-docs slide <archivo.md> <n> --file diapo.md [--mode replace|insert|delete|move] [--to N]
 *   buho-docs append <archivo.md> --file mas.md
 *   buho-docs meta <archivo.md> <campo> ["valor"]   (cabecera; sin valor lo quita)
 *   buho-docs export <archivo.md> [--out archivo.pdf] [--word|--pptx]   # Word / PowerPoint editables
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


const FLAGS = new Set(['all', 'lines', 'json', 'no-launch', 'stdin', 'path', 'help', 'claude', 'quitar', 'ids', 'bloques', 'borrar', 'captura', 'ia', 'rapido', 'word', 'proponer', 'todas', 'abiertos', 'resolver', 'directo', 'pptx', 'powerpoint', 'office', 'cambiadas', 'capturas', 'sin-capturas', 'sin-mosaico', 'mega', 'defecto'])
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
    // Con tiempo límite: una app que aún arranca acepta la conexión pero tarda en contestar.
    return (await fetch(info.url + '/v1/status', { headers: { authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(2000) })).ok
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
  // En Windows con Start-Process (ShellExecute, como un doble clic): la app no hereda las tuberías de quien
  // llamó al CLI. Si las heredase (también con «start»), PowerShell o un agente esperarían a que se cerrase.
  if (process.platform === 'win32') spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${exe.replace(/'/g, "''")}'`], { stdio: 'ignore', env, windowsHide: true }).unref()
  else spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref()
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
const call0 = io.call ?? httpCall
/** --proponer en cualquier comando que cambie el documento: queda como propuesta (control de cambios). */
const call = (method, path, body) =>
  call0(method, path, method === 'POST' && body && (opt.proponer || typeof opt.comentario === 'string') ? { ...body, ...(opt.proponer ? { proponer: true } : {}), ...(typeof opt.comentario === 'string' ? { comentario: opt.comentario.replace(/^#/, '') } : {}) } : body)

/**
 * Proveedor de texto para los agentes: --proveedor claude|cerebras|groq, o --mega (el más rápido que
 * esté configurado); si no, el que tenga la app por defecto (claude salvo que se cambie).
 */
let proveedorCache
async function proveedorTexto() {
  if (typeof opt.proveedor === 'string') return opt.proveedor
  const e = (proveedorCache ??= await call('GET', '/v1/proveedores'))
  if (opt.mega) return ['cerebras', 'groq'].find((id) => e.proveedores.find((p) => p.id === id)?.configurado) ?? die('El modo --mega necesita Cerebras o Groq: buho-docs proveedor cerebras --env archivo.env')
  return e.porDefecto ?? 'claude'
}
/** Pide un texto al modelo. Devuelve { is_error, result } como `claude -p --output-format json`. */
async function pedirLLM(pedir, modeloClaude) {
  const p = await proveedorTexto()
  if (p !== 'claude') {
    const r = await call('POST', '/v1/llm', { proveedor: p, prompt: pedir, modelo: typeof opt['modelo-rapido'] === 'string' ? opt['modelo-rapido'] : undefined })
    return r.ok ? { result: r.texto, proveedor: p, ms: r.ms } : { is_error: true, result: r.error }
  }
  const salida = await new Promise((ok) => {
    const child = spawn('claude', ['-p', '--model', modeloClaude, '--output-format', 'json'], { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let o = ''
    child.stdout.on('data', (d) => (o += d))
    child.on('error', (e) => ok(JSON.stringify({ is_error: true, result: String(e) })))
    child.on('close', () => ok(o))
    child.stdin.end(pedir)
  })
  try {
    return JSON.parse(salida)
  } catch {
    return { is_error: true, result: String(salida).slice(0, 160) || 'sin respuesta' }
  }
}

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
  if (r.id) print(`Id nuevo del bloque: #${r.id}${r.ids?.length > 1 ? ` (y ${r.ids.slice(1).map((x) => '#' + x).join(', ')})` : ''}`)
  avisosPaginas(r)
}

/** Qué páginas tocó un cambio y qué problemas visuales tienen: el agente debe comprobarlas. */
function avisosPaginas(r) {
  if (!r.paginas?.length) return
  print(`Páginas tocadas: ${r.paginas.join(', ')}${r.totalPaginas ? ` (de ${r.totalPaginas})` : ''}`)
  for (const a of r.avisos ?? []) print(`  ${a.nivel === 'error' ? 'ERROR' : 'aviso'} pág. ${a.pagina}${a.linea ? ` línea ${a.linea}` : ''}: ${a.mensaje}`)
  if (r.changed) print(`Compruébalo: buho-docs revisar "${r.path}"   (capturas de esas páginas)`)
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
    const pp = opt.pptx || opt.powerpoint || /^(pptx|powerpoint)$/i.test(String(opt.formato ?? '')) || /\.pptx$/i.test(String(opt.out ?? ''))
    const word = opt.word || /^(docx|word)$/i.test(String(opt.formato ?? '')) || /\.docx$/i.test(String(opt.out ?? ''))
    const office = pp || word || opt.office
    io.err(pp ? 'Exportando a PowerPoint…\n' : word ? 'Exportando a Word…\n' : office ? 'Exportando…\n' : 'Exportando a PDF…\n')
    const r = await call('POST', '/v1/export', { path, out: typeof opt.out === 'string' ? R(opt.out) : undefined, formato: pp ? 'pptx' : word ? 'docx' : office ? 'office' : undefined })
    if (opt.json) { out(r); break }
    if (office) { print(`${r.file.endsWith('.pptx') ? 'PowerPoint' : 'Word'}: ${r.file} · ${(r.bytes / 1024).toFixed(0)} KB${r.slides ? ` · ${r.slides} diapositivas` : ''}`); break }
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
    else {
      print(`Hecho: ${r.applied} cambio${r.applied === 1 ? '' : 's'} de una vez${r.created ? ' (documento creado)' : ''} · ${r.path} · el usuario lo ve en directo`)
      avisosPaginas(r)
    }
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
        'El «titulo» es el que leerá el destinatario en la portada: concreto y atractivo, sobre el tema. Nunca el tipo de documento ni palabras del encargo («lead magnet», «guía para…», «documento de…»), ni una sección de «introducción al documento».',
        'Los títulos de sección, numerados y cortos. Que las partes no se solapen.'
      ].join('\n')
      const out = JSON.stringify(await pedirLLM(pedir, opt['modelo-plan'] ?? 'haiku'))
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
    io.err(`Esqueleto con ${items.length} ${deck ? 'diapositivas' : 'secciones'} en ${Date.now() - t0} ms. Escribiendo ${Math.min(paralelo, items.length)} a la vez con ${(await proveedorTexto()) === 'claude' ? modelo : await proveedorTexto()}…\n`)
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
    const { guia: guiaEstilo } = await call('GET', '/v1/guia-estilo')
    const prompt = (it, i) =>
      fuenteDe(it) ? convertir(it, i) : [
        `Escribe en español de España, en Markdown, para ${deck ? 'una presentación' : 'un documento'} titulado «${plan.titulo ?? ''}».`,
        plan.contexto ? `Contexto: ${plan.contexto}` : '',
        `Parte ${i + 1} de ${items.length}: «${it.titulo}».`,
        it.pide ? `Qué debe contar: ${it.pide}` : '',
        deck && /^(portada|cierre|seccion|cita)$/i.test(it.diseno ?? '') ? breve : sintaxis.replace('${palabras}', String(it.palabras ?? plan.palabras ?? 450)),
        'Iconos válidos: reloj, check, equipo, ventas, datos, escudo, objetivo, cerebro, ley, alerta, bombilla, dinero, soporte, robot.',
        guiaEstilo,
        'No inventes cifras, estudios, porcentajes, casos de centros o empresas concretas, ni nombres de productos o herramientas que no existan; si no tienes un dato real, explica sin cifras. No empieces con un título (ya está puesto). Devuelve solo el Markdown, sin bloques de código alrededor ni comentarios.'
      ]
        .filter(Boolean)
        .join('\n')
    const runOne = async (it, i) => {
      const t = Date.now()
      const st = await call('POST', '/v1/stream/start', { path, hueco: id(i), author: quien, summary: `${items.length} ${deck ? 'diapositivas' : 'secciones'} generadas en paralelo` })
      let res
      if ((await proveedorTexto()) === 'claude') {
        const child = spawn('claude', ['-p', '--model', modelo, '--output-format', 'stream-json', '--include-partial-messages', '--verbose'], { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'ignore'] })
        child.stdin.end(prompt(it, i))
        res = await pipeClaude(child.stdout, st.id)
      } else {
        // Cerebras / Groq: la sección llega entera en un par de segundos.
        const r = await pedirLLM(prompt(it, i), modelo)
        const txt = r.is_error ? '' : String(r.result ?? '').trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1')
        if (txt) await call('POST', '/v1/stream/chunk', { id: st.id, text: txt })
        res = r.is_error ? { error: String(r.result) } : { chars: txt.length }
      }
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
  // ─── Revisión: propuestas y comentarios ───
  case 'revision': {
    const path = file(0)
    const modo = args[1]
    const r = await call(modo ? 'POST' : 'GET', '/v1/revision' + (modo ? '' : qs({ path })), modo ? { path, modo } : undefined)
    if (opt.json) { out(r); break }
    print(`Modo revisión: ${r.modo ? 'sí (los cambios de la IA llegan como propuestas)' : 'no'} · ${r.propuestas.length} propuesta(s) · ${r.comentarios.filter((c) => c.estado === 'abierto').length} comentario(s) abiertos`)
    break
  }
  case 'propuestas': {
    const r = await call('GET', '/v1/revision' + qs({ path: file(0) }))
    if (opt.json) { out(r.propuestas); break }
    if (!r.propuestas.length) print('No hay propuestas pendientes.')
    for (const pr of r.propuestas) {
      print(`${pr.id}  ${pr.autor} · ${pr.resumen}`)
      for (const t of pr.trozos) {
        print(`  línea ${t.ahora ?? '¿?'}${t.ahora ? '' : ' (ya no encaja)'}`)
        for (const l of t.antes) print(`  - ${l}`)
        for (const l of t.despues) print(`  + ${l}`)
      }
    }
    break
  }
  case 'aceptar':
  case 'rechazar': {
    const path = file(0)
    const id = opt.todas ? 'todas' : args[1]
    if (!id) die(`Uso: buho-docs ${cmd} <archivo.md> <id-propuesta|todas>`)
    const r = await call('POST', '/v1/' + cmd, { path, id, todas: id === 'todas' })
    if (opt.json) { out(r); break }
    print(cmd === 'rechazar' ? `${r.rechazadas} propuesta(s) rechazada(s)` : `${r.aceptadas} propuesta(s) aceptada(s)${r.fallidos ? ` · ${r.message}` : ''}`)
    break
  }
  case 'comentarios': {
    const r = await call('GET', '/v1/comentarios' + qs({ path: file(0), abiertos: opt.abiertos ? 'true' : undefined }))
    if (opt.json) { out(r.comentarios); break }
    if (!r.comentarios.length) print(opt.abiertos ? 'No hay comentarios abiertos.' : 'No hay comentarios.')
    for (const c of r.comentarios) {
      print(`${c.id}  [${c.estado}] ${c.autor}: ${c.texto}`)
      print(`  sobre «${c.cita.slice(0, 90)}» · línea ${c.ahora ?? '¿?'}${c.bloque ? ` · bloque #${c.bloque.id} (${c.bloque.seccion})` : ''}`)
      for (const re of c.respuestas) print(`  ↳ ${re.autor}: ${re.texto}`)
    }
    break
  }
  case 'comentar': {
    const path = file(0)
    const texto = args[1] ?? (typeof opt.text === 'string' ? opt.text : undefined)
    if (!texto) die('Uso: buho-docs comentar <archivo.md> "comentario" (--cita "texto" | --bloque #b… | --linea N)')
    const r = await call('POST', '/v1/comentar', { path, texto, cita: opt.cita, bloque: opt.bloque, linea: opt.linea, author: author() })
    opt.json ? out(r) : print(`Comentario ${r.id} en la línea ${r.ahora}`)
    break
  }
  case 'responder': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs responder <archivo.md> <id-comentario> "respuesta" [--resolver]')
    const r = await call('POST', '/v1/responder', { path, id: args[1], texto: args[2] ?? opt.text, resolver: !!opt.resolver, author: author() })
    opt.json ? out(r) : print(`Comentario ${r.id}: ${r.estado}`)
    break
  }
  case 'resolver': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs resolver <archivo.md> <id-comentario>')
    const r = await call('POST', '/v1/resolver', { path, id: args[1], author: author() })
    opt.json ? out(r) : print('Resuelto')
    break
  }
  case 'atender': {
    // Un agente por cada bloque con comentarios abiertos, todos a la vez. Cada uno deja una propuesta
    // (o, con --directo, escribe el cambio). Los comentarios con propuesta pendiente no se repiten.
    const path = file(0)
    const modelo = typeof opt.modelo === 'string' ? opt.modelo : 'sonnet'
    const paralelo = Number(opt.paralelo) || 8
    const quien = author() ?? 'Claude'
    const rv = await call('GET', '/v1/revision' + qs({ path }))
    const ocupados = new Set(rv.propuestas.flatMap((pr) => String(pr.comentario ?? '').split(',')))
    const abiertos = rv.comentarios.filter((c) => c.estado === 'abierto' && !ocupados.has(c.id))
    if (!abiertos.length) { print('No hay comentarios abiertos sin atender.'); break }
    const grupos = new Map()
    for (const c of abiertos) {
      if (!c.bloque) { io.err(`  ✗ ${c.id}: no encuentro «${c.cita.slice(0, 50)}» en el documento\n`); continue }
      if (!grupos.has(c.bloque.id)) grupos.set(c.bloque.id, { bloque: c.bloque, cs: [] })
      grupos.get(c.bloque.id).cs.push(c)
    }
    const doc = await call('GET', '/v1/read' + qs({ path }))
    const { guia } = await call('GET', '/v1/guia-estilo')
    const t0 = Date.now()
    io.err(`Atendiendo ${abiertos.length} comentario(s) en ${grupos.size} bloque(s), en paralelo…\n`)
    const fallos = []
    let hechas = 0
    const uno = async ({ bloque, cs }) => {
      const t = Date.now()
      const pedir = [
        `Estás revisando un documento de Búho Docs titulado «${doc.title}» (${doc.kind}). El usuario ha dejado comentarios sobre un bloque. Aplica lo que pide.`,
        `Sección: ${bloque.seccion || '(principio)'}`,
        'Bloque actual (Markdown de Búho Docs: ::: caja / tarjetas / cifras / pasos / columnas … :::, {icon=…}, \\pagebreak):',
        '<<<',
        bloque.markdown,
        '>>>',
        'Comentarios del usuario:',
        ...cs.map((c) => `- Sobre «${(c.seleccion || c.cita).trim().slice(0, 300)}»: ${c.texto}`),
        '',
        guia,
        'Devuelve SOLO el Markdown que sustituye a ese bloque entero (puede ser más de un bloque si hay que añadir algo; conserva lo que no se pide cambiar, el estilo y el idioma: español de España). Si hay que quitar el bloque entero, devuelve solo la palabra ELIMINAR. Sin explicaciones ni bloques de código alrededor. No inventes cifras.'
      ].join('\n')
      const outp = JSON.stringify(await pedirLLM(pedir, modelo))
      let res
      try { res = JSON.parse(outp) } catch { res = { is_error: true, result: String(outp).slice(0, 160) || 'sin respuesta' } }
      if (res.is_error) {
        fallos.push(`#${bloque.id}: ${res.result}`)
        io.err(`  ✗ #${bloque.id} · ${String(res.result).slice(0, 120)}\n`)
        return
      }
      let txt = String(res.result ?? '').trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1')
      const borrar = /^ELIMINAR\.?$/.test(txt)
      const resumen = cs.length === 1 ? `Comentario: «${cs[0].texto.slice(0, 60)}»` : `${cs.length} comentarios en un bloque`
      const r = await call('POST', '/v1/bloque', { path, id: bloque.id, mode: borrar ? 'delete' : 'replace', content: borrar ? undefined : txt, author: quien, summary: resumen, comentario: cs.map((c) => c.id).join(','), proponer: !opt.directo })
      for (const c of cs) await call('POST', '/v1/responder', { path, id: c.id, author: quien, texto: opt.directo ? 'Hecho.' : `Propuesta ${r.propuesta ?? ''} lista para revisar.`, resolver: !!opt.directo })
      hechas++
      io.err(`  ✓ #${bloque.id} · ${cs.length} comentario(s) · ${((Date.now() - t) / 1000).toFixed(1)} s\n`)
    }
    const cola = [...grupos.values()]
    await Promise.all(Array.from({ length: Math.min(paralelo, cola.length) }, async () => {
      while (cola.length) await uno(cola.shift())
    }))
    const total = ((Date.now() - t0) / 1000).toFixed(1)
    if (opt.json) out({ ok: !fallos.length, bloques: grupos.size, hechas, fallos, segundos: Number(total) })
    else print(`${hechas} de ${grupos.size} bloque(s) atendidos en ${total} s${opt.directo ? '' : ': revisa las propuestas en la app o con buho-docs propuestas'}`)
    if (fallos.length) {
      if (/auth|login|OAuth/i.test(fallos.join(' '))) io.err('Parece que la sesión de claude ha caducado: abre una terminal, ejecuta «claude» e inicia sesión.\n')
      exitWith(1)
    }
    break
  }
  // ─── Comprobación visual ───
  case 'revisar': {
    const path = file(0)
    const r = await call('POST', '/v1/revisar', { path, paginas: typeof opt.paginas === 'string' ? opt.paginas : args[1], lineas: opt.lineas, capturas: !opt['sin-capturas'], ancho: opt.ancho })
    if (opt.json) { out(r); break }
    if (!r.paginas.length) { print(`Nada que revisar (${r.motivo}). Para todo el documento: buho-docs scan "${path}"`); break }
    print(`${r.paginas.length} página(s) ${r.motivo} de ${r.total} · ${r.problemas ? r.problemas + ' problema(s)' : 'sin problemas detectados'}`)
    for (const pg of r.paginas) {
      print(`  pág. ${pg.n} · llena al ${Math.round(pg.llenado * 100)} %${pg.titulos.length ? ' · ' + pg.titulos.slice(0, 2).join(' / ') : ''}${pg.captura ? '\n    captura: ' + pg.captura : ''}`)
      for (const a of pg.avisos) print(`    ${a.nivel === 'error' ? 'ERROR' : 'aviso'}${a.linea ? ` línea ${a.linea}` : ''}: ${a.mensaje}`)
    }
    if (r.otrasConAvisos.length) print(`Otras páginas con avisos: ${r.otrasConAvisos.join(', ')} (buho-docs scan)`)
    print('Mira las capturas: lo que no detectan las reglas (algo feo, descuadrado o que no se lee bien) también se arregla.')
    break
  }
  case 'scan': {
    const path = file(0)
    const r = await call('POST', '/v1/scan', { path, mosaico: !opt['sin-mosaico'], capturas: !!opt.capturas, columnas: opt.columnas, ancho: opt.ancho })
    if (opt.json) { out(r); break }
    print(`${r.kind === 'presentacion' ? 'Presentación' : 'Documento'}: ${r.total} ${r.kind === 'presentacion' ? 'diapositivas' : 'páginas'} · ${r.limpio ? 'sin problemas detectados' : r.problemas + ' problema(s)'}`)
    for (const pg of r.paginas) for (const a of pg.avisos) print(`  ${a.nivel === 'error' ? 'ERROR' : 'aviso'} pág. ${pg.n}${a.linea ? ` línea ${a.linea}` : ''}: ${a.mensaje}`)
    if (r.aireIA) print(`Aire IA: ${r.aireIA} marca(s) de texto generado (buho-docs estilo para verlas, humanizar para quitarlas)`)
    for (const m of r.mosaicos) print(`Mosaico págs. ${m.desde}-${m.hasta}: ${m.file}`)
    for (const c of r.capturas) print(`  pág. ${c.page}: ${c.file}`)
    break
  }
  // ─── Proveedores de modelos ───
  case 'proveedores': {
    const r = await call('GET', '/v1/proveedores')
    if (opt.json) { out(r); break }
    print(`Por defecto: ${r.porDefecto} · imágenes con IA: ${r.imagenesIA ? 'activadas (de pago)' : 'apagadas'}`)
    for (const p of r.proveedores) print(`  ${p.configurado ? '✓' : '·'} ${p.id.padEnd(9)} ${p.modelo.padEnd(22)} ${p.uso}`)
    print('Configurar: buho-docs proveedor <id> --env archivo.env [--variable NOMBRE] | --clave …  ·  --defecto  ·  openai --imagenes si|no')
    break
  }
  case 'proveedor': {
    const id = args[0]
    if (!id) die('Uso: buho-docs proveedor <cerebras|groq|openai|claude> [--env archivo.env --variable NOMBRE | --clave …] [--defecto] [--imagenes si|no]')
    if (typeof opt.env === 'string' || typeof opt.clave === 'string') await call('POST', '/v1/proveedor-clave', { proveedor: id, env: typeof opt.env === 'string' ? R(opt.env) : undefined, variable: opt.variable, clave: opt.clave })
    if (opt.defecto || typeof opt.imagenes === 'string') await call('POST', '/v1/proveedores', { ...(opt.defecto ? { porDefecto: id } : {}), ...(typeof opt.imagenes === 'string' ? { imagenesIA: /^(si|sí|true|1)$/i.test(opt.imagenes) } : {}) })
    const r = await call('GET', '/v1/proveedores')
    const p = r.proveedores.find((x) => x.id === id)
    opt.json ? out(r) : print(`${id}: ${p?.configurado ? 'configurado' : 'sin clave'}${r.porDefecto === id ? ' · por defecto' : ''}${id === 'openai' ? ` · imágenes con IA ${r.imagenesIA ? 'activadas' : 'apagadas'}` : ''}`)
    break
  }
  // ─── Imágenes ───
  case 'imagenes': {
    const sub = args[0]
    if (sub === 'buscar') {
      const q = args.slice(1).join(' ')
      if (!q) die('Uso: buho-docs imagenes buscar "qué buscas" [--n 8] [--forma horizontal|vertical|cuadrada]')
      const r = await call('POST', '/v1/imagenes/buscar', { q, n: opt.n, forma: opt.forma, tamano: opt.tamano })
      if (opt.json) { out(r); break }
      if (!r.items.length) { print(r.message); break }
      print(`Búsqueda ${r.id} · ${r.items.length} imágenes con licencia de uso comercial (Openverse)`)
      print(`Hoja de contactos (MÍRALA antes de elegir): ${r.hoja}`)
      for (const it of r.items) print(`  ${String(it.n).padStart(2)}. ${it.ancho}×${it.alto} · ${it.licencia} · ${it.autor.slice(0, 24)} · «${it.titulo.slice(0, 50)}»`)
      print(`Ponla con: buho-docs imagenes poner <doc> ${r.id} <n> [--seccion "Título" | --bloque #id | --hueco id] [--ancho 70]`)
      break
    }
    if (sub === 'poner') {
      const path = R(args[1] ?? die('Uso: buho-docs imagenes poner <doc> <búsqueda> <n> [--seccion "Título"] [--ancho 70]'))
      const r = await call('POST', '/v1/imagenes/poner', { path, busqueda: args[2], n: args[3], seccion: opt.seccion, bloque: opt.bloque, hueco: opt.hueco, ancho: opt.ancho, estilo: opt.estilo, alt: opt.alt, author: author() })
      if (opt.json) { out(r); break }
      print(`Imagen puesta: ${r.archivo}${r.w ? ` (${r.w}×${r.h})` : ''}${r.aviso ? '\n  aviso: ' + r.aviso : ''}`)
      avisosPaginas({ ...r, changed: true })
      break
    }
    if (sub === 'generar') {
      const path = R(args[1] ?? die('Uso: buho-docs imagenes generar <doc> "qué imagen" [--seccion "Título"] [--ancho 80]   (de pago; actívalo antes)'))
      const prompt = args.slice(2).join(' ') || (typeof opt.text === 'string' ? opt.text : '')
      if (!prompt) die('Falta qué imagen generar')
      io.err('Generando la imagen (OpenAI, de pago)…\n')
      const r = await call('POST', '/v1/imagenes/generar', { path, prompt, seccion: opt.seccion, bloque: opt.bloque, hueco: opt.hueco, ancho: opt.ancho, estilo: opt.estilo, alt: opt.alt, tamano: opt.tamano, calidad: opt.calidad, author: author() })
      if (opt.json) { out(r); break }
      print(`Imagen generada (${r.modelo}): ${r.archivo}`)
      avisosPaginas({ ...r, changed: true })
      break
    }
    die('Uso: buho-docs imagenes buscar|poner|generar …')
    break
  }
  // ─── Aire IA ───
  case 'estilo': {
    const r = await call('GET', '/v1/estilo' + qs({ path: file(0) }))
    if (opt.json) { out(r); break }
    if (!r.marcas) { print(`Sin aire IA (${r.palabras} palabras).`); break }
    print(`Aire IA: ${r.marcas} marca(s) en ${r.palabras} palabras (${r.porMil} por cada mil)`)
    for (const h of r.hallazgos) print(`  línea ${h.linea}${h.bloque ? ` #${h.bloque.id}` : ''} · «${h.texto.slice(0, 60)}» · ${h.mensaje}`)
    print('Arréglalo tú (editar #id) o con agentes: buho-docs humanizar <doc> (deja propuestas).')
    break
  }
  case 'humanizar': {
    // Un agente por bloque con aire IA, a la vez; reescribe sin cambiar el contenido y deja propuestas.
    const path = file(0)
    const modelo = typeof opt.modelo === 'string' ? opt.modelo : 'sonnet'
    const paralelo = Number(opt.paralelo) || 8
    const quien = author() ?? 'Claude'
    const r = await call('GET', '/v1/estilo' + qs({ path }))
    const grupos = new Map()
    for (const h of r.hallazgos) {
      if (!h.bloque) continue
      if (!grupos.has(h.bloque.id)) grupos.set(h.bloque.id, { bloque: h.bloque, hs: [] })
      grupos.get(h.bloque.id).hs.push(h)
    }
    if (!grupos.size) { print('Sin aire IA que quitar.'); break }
    io.err(`Humanizando ${grupos.size} bloque(s) (${r.marcas} marcas), a la vez…\n`)
    const t0 = Date.now()
    let hechas = 0
    const fallos = []
    const uno = async ({ bloque, hs }) => {
      const pedir = [
        'Reescribe este bloque de un documento para quitarle el «aire IA», sin cambiar lo que dice ni el formato de Búho Docs (títulos, ::: bloques, {icon=…}, tablas).',
        'Problemas detectados:',
        ...hs.map((h) => `- «${h.texto}»: ${h.mensaje}`),
        '',
        r.guia,
        '',
        '<<<',
        bloque.markdown,
        '>>>',
        'Devuelve SOLO el Markdown reescrito, sin explicaciones ni bloques de código alrededor. Español de España.'
      ].join('\n')
      const salida = JSON.stringify(await pedirLLM(pedir, modelo))
      let res
      try { res = JSON.parse(salida) } catch { res = { is_error: true, result: String(salida).slice(0, 160) || 'sin respuesta' } }
      if (res.is_error) { fallos.push(String(res.result)); io.err(`  ✗ #${bloque.id} · ${String(res.result).slice(0, 100)}\n`); return }
      const txt = String(res.result ?? '').trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1')
      const resumen = `Sin aire IA (${hs.length} marca${hs.length > 1 ? 's' : ''})`
      // Las listas no son un bloque: se cambian por su texto exacto.
      if (bloque.lista) await call('POST', '/v1/replace', { path, find: bloque.markdown, replace: txt, author: quien, summary: resumen, proponer: !opt.directo })
      else await call('POST', '/v1/bloque', { path, id: bloque.id, mode: 'replace', content: txt, author: quien, summary: resumen, proponer: !opt.directo })
      hechas++
      io.err(`  ✓ #${bloque.id} · ${hs.length} marca(s)\n`)
    }
    const cola = [...grupos.values()]
    await Promise.all(Array.from({ length: Math.min(paralelo, cola.length) }, async () => { while (cola.length) await uno(cola.shift()) }))
    const total = ((Date.now() - t0) / 1000).toFixed(1)
    const despues = await call('GET', '/v1/estilo' + qs({ path }))
    if (opt.json) { out({ ok: !fallos.length, bloques: grupos.size, hechas, antes: r.marcas, despues: despues.marcas, segundos: Number(total) }); break }
    print(`${hechas} de ${grupos.size} bloque(s) en ${total} s${opt.directo ? ` · aire IA: ${r.marcas} → ${despues.marcas}` : ': revisa las propuestas (panel Revisión o buho-docs propuestas)'}`)
    if (fallos.length) exitWith(1)
    break
  }
  // ─── Torneo: varias versiones de una zona a la vez; quien lo pide elige ───
  case 'torneo': {
    const path = file(0)
    const zona = { seccion: opt.seccion, bloque: opt.bloque, hueco: opt.hueco, diapositiva: opt.diapositiva }
    const z = await call('POST', '/v1/zona', { path, ...zona })
    const n = Math.min(8, Math.max(2, Number(opt.n) || 3))
    const modelos = String(typeof opt.modelos === 'string' ? opt.modelos : typeof opt.modelo === 'string' ? opt.modelo : 'sonnet').split(',').map((x) => x.trim()).filter(Boolean)
    const enfoques = typeof opt.enfoques === 'string' ? opt.enfoques.split('|') : ['', 'más concisa y directa: la mitad de palabras', 'más visual: con bloques de Búho Docs (tarjetas, cifras, pasos, columnas; gráfico solo con datos reales)', 'más concreta: ejemplos y casos prácticos', 'otra estructura y otro ángulo distinto', 'más persuasiva, orientada a la decisión']
    const pide = typeof opt.pide === 'string' ? opt.pide : typeof opt.file === 'string' ? await content(9) : ''
    const grupo = 't' + Date.now().toString(36)
    const quien = author() ?? 'Claude'
    const { guia } = await call('GET', '/v1/guia-estilo')
    const deck = z.kind === 'presentacion'
    const que = z.zona === 'seccion' ? `el cuerpo de la sección «${z.seccion}»` : z.zona === 'bloque' ? `el bloque #${z.bloque}${z.seccion ? ` (sección ${z.seccion})` : ''}` : z.zona === 'hueco' ? `el hueco «${z.hueco}» (${z.pide})` : `la diapositiva ${z.diapositiva}`
    io.err(`Torneo ${grupo}: ${n} versiones de ${que}, a la vez (${modelos.join(', ')})…\n`)
    const t0 = Date.now()
    const una = async (k) => {
      const modelo = modelos[k % modelos.length]
      const enfoque = (enfoques[k % enfoques.length] ?? '').trim()
      const pedir = [
        `Estás escribiendo en Búho Docs ${deck ? 'una presentación' : 'un documento'} titulado «${z.titulo}». Español de España.`,
        `Escribe ${que}.`,
        pide ? `Lo que se pide: ${pide}` : '',
        enfoque ? `Enfoque de esta versión: ${enfoque}.` : '',
        z.markdown ? 'Lo que hay ahora (reescríbelo, puedes cambiarlo entero):\n<<<\n' + z.markdown + '\n>>>' : '',
        'Markdown de Búho Docs: ## y ### para títulos; bloques ::: caja | tarjetas N (cada ### una tarjeta, {icon=…}) | cifras N (- **8** texto) | pasos | columnas (+++ separa) | grafico barras (con una tabla) … :::.',
        deck ? 'Es una diapositiva 16:9: un título ## corto y poco texto (de 2 a 4 tarjetas o de 3 a 5 viñetas). Puedes poner directivas al principio (@diseño: normal, @etiqueta: …).' : '',
        z.zona === 'seccion' ? 'No repitas el título de la sección.' : '',
        guia,
        'No inventes cifras ni estudios. Devuelve SOLO el Markdown, sin explicaciones ni bloques de código alrededor.'
      ].filter(Boolean).join('\n')
      const t = Date.now()
      const salida = JSON.stringify(await pedirLLM(pedir, modelo))
      let res
      try { res = JSON.parse(salida) } catch { res = { is_error: true, result: String(salida).slice(0, 160) || 'sin respuesta' } }
      if (res.is_error) return { k, modelo, enfoque, error: String(res.result) }
      const txt = String(res.result ?? '').trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1')
      const v = await call('POST', '/v1/variante', { path, ...zona, content: txt, grupo, variante: k + 1, enfoque: enfoque || modelo, author: `${quien} · ${modelo}` })
      io.err(`  ✓ variante ${k + 1} · ${modelo}${enfoque ? ' · ' + enfoque.split(':')[0] : ''} · ${((Date.now() - t) / 1000).toFixed(1)} s\n`)
      return { k, modelo, enfoque, chars: txt.length, ...v }
    }
    const rs = await Promise.all(Array.from({ length: n }, (_, k) => una(k)))
    const total = ((Date.now() - t0) / 1000).toFixed(1)
    if (opt.json) { out({ ok: true, grupo, segundos: Number(total), variantes: rs }); break }
    print(`Torneo ${grupo} en ${total} s:`)
    for (const v of rs) {
      if (v.error) { print(`  v${v.k + 1} · ${v.modelo} · FALLÓ: ${v.error.slice(0, 120)}`); continue }
      print(`  v${v.k + 1} · ${v.modelo}${v.enfoque ? ' · ' + v.enfoque : ''} · propuesta ${v.propuesta} · ${v.chars} caracteres · págs. ${(v.paginas ?? []).join(', ')}${v.avisos?.length ? ` · ${v.avisos.length} aviso(s)` : ''}`)
      for (const c of v.capturas ?? []) print(`      captura: ${c}`)
      for (const a of v.avisos ?? []) print(`      ${a.nivel === 'error' ? 'ERROR' : 'aviso'} pág. ${a.pagina}: ${a.mensaje}`)
    }
    print(`Mira las capturas y elige: buho-docs elegir "${path}" <propuesta>   (las demás variantes se descartan; o déjalas para que elija el usuario en el panel Revisión)`)
    if (rs.some((v) => v.error && /auth|login|OAuth/i.test(v.error))) io.err('Parece que la sesión de claude ha caducado: abre una terminal, ejecuta «claude» e inicia sesión.\n')
    break
  }
  case 'elegir': {
    const path = file(0)
    if (!args[1]) die('Uso: buho-docs elegir <archivo.md> <propuesta>   (de un torneo: las demás variantes se descartan)')
    const r = await call('POST', '/v1/aceptar', { path, id: args[1], author: author() })
    if (opt.json) { out(r); break }
    print(`Elegida ${args[1]}${r.fallidos ? ' · ' + r.message : ''}`)
    avisosPaginas(r)
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
