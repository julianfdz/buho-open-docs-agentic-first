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

const FLAGS = new Set(['all', 'lines', 'json', 'no-launch', 'stdin', 'path', 'help'])
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
  return Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '')
}

/** Texto nuevo: --file, --text, - (entrada estándar) o el argumento en la posición indicada. */
async function content(i, required = true) {
  if (typeof opt.file === 'string') {
    if (!existsSync(opt.file)) die(`No existe ${opt.file}`)
    return readFileSync(opt.file, 'utf8').replace(/^﻿/, '')
  }
  if (typeof opt.text === 'string') return opt.text
  if (opt.stdin || args[i] === '-') return readStdin()
  if (args[i] !== undefined) return args[i]
  if (required) die('Falta el texto: usa --file <archivo>, --text "…" o - para leerlo de la entrada estándar')
  return undefined
}

const author = () => (typeof opt.author === 'string' ? opt.author : undefined)

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
    const r = await call('POST', '/v1/new', { path, kind: opt.kind, title: opt.title, subtitle: opt.subtitle, content: c, author: author() })
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
