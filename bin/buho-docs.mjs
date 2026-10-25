#!/usr/bin/env node
/**
 * buho-docs · CLI de Búho Docs para agentes de IA (Claude, Codex, Copilot, scripts…) y personas.
 * Documentos A4 y presentaciones 16:9 en Markdown con el estilo Búho; PDF con un comando.
 * Habla con la app (<userData>/api.json trae URL y token); si está cerrada, la abre. El usuario ve
 * cada cambio en directo y queda firmado en el historial con --author.
 *
 *   buho-docs status | docs | templates | skill
 *   buho-docs new <archivo.md> [--kind documento|presentacion] [--title "…"] [--subtitle "…"] [--file contenido.md]
 *   buho-docs open <archivo.md>                     (lo abre y lo enseña)
 *   buho-docs read <archivo.md> [--lines]           (contenido; --lines con números de línea)
 *   buho-docs outline <archivo.md>                  (títulos y diapositivas con su línea)
 *   buho-docs write <archivo.md> --file nuevo.md    (reescribe entero; - lee de la entrada estándar)
 *   buho-docs replace <archivo.md> "texto" "nuevo" [--all]          (erratas y cambios puntuales)
 *   buho-docs section <archivo.md> "Título" --file parte.md [--mode body|replace|append|before|after|delete]
 *   buho-docs slide <archivo.md> <n> --file diapo.md [--mode replace|insert|delete|move] [--to N]
 *   buho-docs append <archivo.md> --file mas.md
 *   buho-docs meta <archivo.md> <campo> ["valor"]   (cabecera; sin valor lo quita)
 *   buho-docs export <archivo.md> [--out archivo.pdf]
 *   buho-docs check <archivo.md>                    (páginas y avisos: diapositivas que no caben, imágenes…)
 *   buho-docs history <archivo.md> [--limit 20] | diff <archivo.md> [id] | restore <archivo.md> <id>
 *   buho-docs show <archivo.md> [--line N]          (lo enseña en la app, en esa línea)
 *   buho-docs tag <archivo.md> --author Claude      (firma tu próximo guardado directo del archivo)
 *   buho-docs batch <archivo.md> --file cambios.json  (varios cambios de una vez; crea el .md si no existe)
 *   buho-docs stream <archivo.md> [--section "Título"] [--mode body|append|after|write] [--claude] < texto
 *                                                   (el texto aparece en directo mientras llega)
 *   buho-docs snapshot <archivo.md> [--pages 1-3,8|todas] [--width 900] [--out p.png | --dir carpeta]   (fotos de páginas)
 *   buho-docs generar <archivo.md> --plan plan.json [--modelo haiku] [--paralelo 8]   (secciones o diapositivas
 *                                                   escritas a la vez por varios modelos, en directo)
 *   buho-docs bloques | insertar <archivo.md> <bloque> [--despues "Título"]   (bloques ya maquetados)
 *   buho-docs huecos <archivo.md> | rellenar <archivo.md> <id> (--imagen foto.png | --file contenido.md)
 *   buho-docs indice <archivo.md> [--niveles 2|3] [--quitar]   (índice automático con números de página)
 *
 * El texto nuevo se pasa con --file <ruta>, con --text "…" o con - (entrada estándar).
 * Opciones globales: --author <nombre> (firma en el historial), --json, --no-launch.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Versión portable (portable.txt junto a BuhoDocs.exe): los datos, y con ellos api.json, van en «datos».
const portableDir = existsSync(join(here, '..', 'portable.txt')) ? join(here, '..', 'datos') : null
const dataDir = process.env.BUHO_DATA_DIR || portableDir || join(process.env.APPDATA || join(process.env.HOME || '', '.config'), 'BuhoDocs')

function die(msg, code = 1) {
  process.stderr.write(msg + '\n')
  process.exit(code)
}

const FLAGS = new Set(['all', 'lines', 'json', 'no-launch', 'stdin', 'path', 'help', 'claude', 'quitar'])
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
const { pos, opt } = parseArgs(process.argv.slice(2))
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
  const exe = opt['no-launch'] || process.env.BUHO_NO_LAUNCH ? undefined : appExe()
  if (!exe) die('Búho Docs no está abierto. Ábrelo (o instala la app) y vuelve a intentarlo.', 2)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref()
  process.stderr.write('Abriendo Búho Docs…\n')
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250))
    info = readInfo()
    if (await alive(info)) return info
  }
  die('He abierto Búho Docs pero no responde. Prueba de nuevo en unos segundos.', 2)
}

let conn = null
async function call(method, path, body) {
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

const qs = (o) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== true && v !== false) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n')
const print = (s) => process.stdout.write(s + '\n')

const file = (i, what = 'archivo .md') => {
  const a = args[i]
  if (!a) die(`Falta el ${what}. Uso: buho-docs ${cmd} <archivo.md> …  (buho-docs help)`)
  return resolve(a)
}

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
}

/** Texto nuevo: --file, --text, - (entrada estándar) o el argumento en la posición indicada. */
async function content(i, required = true) {
  if (typeof opt.file === 'string') {
    if (!existsSync(opt.file)) die(`No existe ${opt.file}`)
    return readFileSync(opt.file, 'utf8').replace(/^\uFEFF/, '')
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
    const r = await call('POST', '/v1/new', { path, kind: opt.kind, title: opt.title, subtitle: opt.subtitle, estilo: opt.estilo, content: c, author: author() })
    opt.json ? out(r) : print(`Creado ${r.path} (${r.kind}) y abierto en Búho Docs`)
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
    } else process.stdout.write(r.content)
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
    process.stderr.write('Exportando a PDF…\n')
    const r = await call('POST', '/v1/export', { path, out: typeof opt.out === 'string' ? resolve(opt.out) : undefined })
    if (opt.json) { out(r); break }
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
        if (!existsSync(o.file)) die(`No existe ${o.file}`)
        o.content = readFileSync(o.file, 'utf8').replace(/^\uFEFF/, '')
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
      await pipeClaude(process.stdin, st.id)
      const r = await call('POST', '/v1/stream/end', { id: st.id })
      opt.json ? out(r) : print(`Escrito en directo: ${r.chars} caracteres · ${r.path}`)
      break
    }
    // --claude: lee la salida de `claude -p … --output-format stream-json --include-partial-messages --verbose`
    let buf = ''
    let streamed = false
    let finalText = ''
    for await (const chunk of process.stdin) {
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
    const r = await call('GET', '/v1/snapshot' + qs({ path: file(0), pages: opt.pages ?? opt.page, width: opt.width, out: typeof opt.out === 'string' ? resolve(opt.out) : undefined, dir: typeof opt.dir === 'string' ? resolve(opt.dir) : undefined }))
    opt.json ? out(r) : print(r.files.map((x) => x.file).join('\n'))
    break
  }
  case 'generar': {
    // Generación en paralelo: un plan con secciones (o diapositivas); cada una la escribe un modelo
    // distinto a la vez, en directo, en su hueco del documento.
    const path = file(0)
    if (typeof opt.plan !== 'string' || !existsSync(opt.plan)) die('Uso: buho-docs generar <archivo.md> --plan plan.json [--modelo haiku] [--paralelo 8]  (formato del plan en buho-docs skill)')
    const plan = JSON.parse(readFileSync(opt.plan, 'utf8').replace(/^﻿/, ''))
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
      const front = ['---', `tipo: ${deck ? 'presentacion' : 'documento'}`, plan.estilo ? `estilo: ${plan.estilo}` : null, `titulo: ${q(plan.titulo ?? 'Sin título')}`, plan.subtitulo ? `subtitulo: ${q(plan.subtitulo)}` : null, plan.etiqueta ? `etiqueta: ${q(plan.etiqueta)}` : null, '---', '']
        .filter((l) => l !== null)
        .join('\n')
      await call('POST', '/v1/batch', { path, ops: [{ op: 'write', content: front + '\n' + skel }], author: quien })
    }
    process.stderr.write(`Esqueleto con ${items.length} ${deck ? 'diapositivas' : 'secciones'} en ${Date.now() - t0} ms. Escribiendo ${Math.min(paralelo, items.length)} a la vez con ${modelo}…\n`)
    // 2 · Un modelo por sección, `paralelo` a la vez, cada uno escribiendo en directo en su hueco.
    const sintaxis = deck
      ? 'Es el CONTENIDO de una diapositiva 16:9 (sin el título, que ya está). Muy breve: de 3 a 5 viñetas cortas, o un bloque «::: tarjetas 2» o «::: tarjetas 3» con «### Título {icon=reloj}» y una línea de texto por tarjeta, o un «::: cifras 3» con «- **cifra** texto». Como mucho 60 palabras.'
      : `Es el CUERPO de una sección de un documento A4 (sin el título, que ya está). Unas ${'${palabras}'} palabras. Párrafos claros, negritas para lo importante, alguna lista. Puedes usar como mucho un bloque visual: «::: caja icon=bombilla» … «:::», o «::: tarjetas 3» con «### Título {icon=reloj}» y texto, o una tabla Markdown.`
    const breve = 'Es el texto de una diapositiva de portada o de cierre: solo una o dos frases cortas (con alguna negrita), sin listas ni bloques.'
    // Modo convertir: la parte trae su texto original («fuente», o «fuente_archivo») y solo se maqueta.
    const fuenteDe = (it) => it.fuente ?? (it.fuente_archivo ? readFileSync(it.fuente_archivo, 'utf8') : '')
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
        process.stderr.write(`  ✗ ${it.titulo} · ${why}\n`)
        return null
      }
      const r = await call('POST', '/v1/stream/end', { id: st.id })
      process.stderr.write(`  ✓ ${it.titulo} · ${r.chars} caracteres · ${((Date.now() - t) / 1000).toFixed(1)} s\n`)
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
      process.stderr.write(`\n${fallos.length} parte(s) fallaron y quedan como hueco:\n  ${fallos.join('\n  ')}\n${/auth|login|OAuth/i.test(fallos.join(' ')) ? 'Parece que la sesión de claude ha caducado: abre una terminal, ejecuta «claude» e inicia sesión.\n' : ''}`)
      process.exit(1)
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
  case 'skill': {
    const p = skillPath()
    if (!p) die('No encuentro el SKILL.md (va junto al CLI, en la carpeta «cli» de la app).')
    process.stdout.write(opt.path ? p + '\n' : readFileSync(p, 'utf8'))
    break
  }
  default: {
    const help = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\r?\n\/\*\*?\r?\n?/, '').replace(/^ \* ?/gm, '')
    const p = skillPath()
    process.stdout.write(help + (p ? `\nGuía completa (sintaxis, bloques, diseños de diapositiva, ejemplos y reglas): ${p}\n` : '') + '\n')
    process.exit(cmd && cmd !== 'help' ? 1 : 0)
  }
}
