/**
 * Banco de velocidad: Búho Docs frente a la forma «de siempre» (script de Python con reportlab).
 * Mismo Markdown de origen (~20 páginas, bench/generar.mjs) y los mismos 5 arreglos para los dos:
 *
 *   A · Búho Docs: el agente usa el CLI (crear, cambios pequeños, exportar). La app está abierta y
 *       aislada (BUHO_DATA_DIR), como la vería el usuario.
 *   B · Script: cada versión del Markdown se convierte entera a PDF con bench/reportlab_render.py.
 *
 *   npm run build && node bench/velocidad.mjs [--secciones 18] [--rondas 3]
 *
 * Mide el tiempo de máquina (sin contar lo que tarda el modelo en pensar y escribir) y deja el
 * resultado en bench/resultados.md.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { generar } from './generar.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'bench', '.out')
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? Number(process.argv[i + 1]) : d
}
const SECCIONES = arg('secciones', 26)
const RONDAS = arg('rondas', 3)
const run = promisify(execFile)
const now = () => performance.now()
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const env = { ...process.env, BUHO_DATA_DIR: join(out, 'data'), BUHO_API_PORT: '47396', BUHO_E2E: '1', BUHO_NO_LAUNCH: '1' }
delete env.ELECTRON_RUN_AS_NODE

// El CLI como lo usa un agente con la app instalada: el ejecutable de la app en modo Node.
const packaged = join(root, 'dist', 'win-unpacked', 'BuhoDocs.exe')
const cliBin = existsSync(packaged) ? packaged : process.execPath
const cliEnv = existsSync(packaged) ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env
const cli = async (...a) => (await run(cliBin, [join(root, 'bin', 'buho-docs.mjs'), ...a], { env: cliEnv, encoding: 'utf8', maxBuffer: 1 << 26 })).stdout
const timed = async (fn) => {
  const t = now()
  const r = await fn()
  return [now() - t, r]
}

// ─── Arreglos (los mismos para los dos) ────────────────────────────────────────────────────────
const nueva = join(out, 'seccion.md')
writeFileSync(nueva, 'Texto reescrito por la IA en el banco de pruebas: la administración concentra tareas de conciliación y registro que se pueden automatizar casi por completo.\n\n- Conciliación automática de cobros\n- Lectura de facturas\n- Avisos de desviaciones\n')
const final = join(out, 'final.md')
writeFileSync(final, '## Conclusiones\n\nSección añadida al final por la IA en el banco de pruebas.\n')
const FIXES = [
  ['Errata', (d) => ['replace', d, 'La efiencia', 'La eficiencia', '--author', 'Bench']],
  ['Cifra en una tabla', (d) => ['replace', d, '12,5 %', '18,0 %', '--author', 'Bench']],
  ['Reescribir una sección', (d) => ['section', d, '4. Administración', '--file', nueva, '--author', 'Bench']],
  ['Cambiar el título', (d) => ['meta', d, 'titulo', 'Informe de oportunidades de IA (revisado)', '--author', 'Bench']],
  ['Añadir sección final', (d) => ['append', d, '--file', final, '--author', 'Bench']]
]

// ─── Arranque de la app aislada ────────────────────────────────────────────────────────────────
const electronBin = (await import('electron')).default
const app = spawn(electronBin, [root], { env, stdio: 'ignore' })
for (let i = 0; i < 120; i++) {
  try {
    await cli('status')
    break
  } catch {
    await new Promise((r) => setTimeout(r, 250))
  }
}

const res = { buho: [], script: [] }
try {
  for (let ronda = 1; ronda <= RONDAS; ronda++) {
    const dir = join(out, `ronda${ronda}`)
    mkdirSync(dir, { recursive: true })
    const src = join(dir, 'origen.md')
    writeFileSync(src, generar(SECCIONES))
    const doc = join(dir, 'buho.md')
    const snaps = []

    // A · Búho Docs
    const A = { pasos: {} }
    const [tNew] = await timed(() => cli('new', doc, '--file', src, '--author', 'Bench'))
    const [tExp0, e0] = await timed(() => cli('export', doc, '--json'))
    A.paginas = JSON.parse(e0).pages
    A.pasos['Crear'] = tNew
    A.pasos['PDF inicial'] = tExp0
    snaps.push(readFileSync(doc, 'utf8'))
    A.fixes = []
    for (const [name, f] of FIXES) {
      const [tEdit] = await timed(() => cli(...f(doc)))
      const [tExp, ex] = await timed(() => cli('export', doc, '--json', '--out', join(dir, `buho-${A.fixes.length + 1}.pdf`)))
      const e = JSON.parse(ex)
      A.fixes.push({ name, edit: tEdit, render: (e.timings?.markdown ?? 0) + (e.timings?.maquetar ?? 0), export: tExp })
      snaps.push(readFileSync(doc, 'utf8'))
    }
    // Lo normal con un agente: entre un comando y el siguiente el modelo tarda en escribir (aquí 1,5 s,
    // que no se cuentan). Mientras tanto la app ya ha preparado el PDF.
    const [tEditT] = await timed(() => cli('replace', doc, 'Conclusiones', 'Conclusiones finales', '--author', 'Bench'))
    await new Promise((r) => setTimeout(r, 1500))
    const [tExpT, exT] = await timed(() => cli('export', doc, '--json', '--out', join(dir, 'buho-pensando.pdf')))
    A.pensando = { edit: tEditT, export: tExpT, caliente: JSON.parse(exT).caliente }
    const [tStatus] = await timed(() => cli('status'))
    A.cliVacio = tStatus
    res.buho.push(A)

    // B · Script reportlab: cada versión se regenera entera
    const B = { fixes: [] }
    const py = async (i) => {
      const md = join(dir, `script-${i}.md`)
      writeFileSync(md, snaps[i])
      const [t, r] = await timed(() => run('python', [join(root, 'bench', 'reportlab_render.py'), md, join(dir, `script-${i}.pdf`)], { encoding: 'utf8' }))
      return [t, Number(r.stdout.trim())]
    }
    const [t0, pages] = await py(0)
    B.inicial = t0
    B.paginas = pages
    for (let i = 1; i <= FIXES.length; i++) B.fixes.push({ name: FIXES[i - 1][0], regen: (await py(i))[0] })
    res.script.push(B)
    console.log(`Ronda ${ronda}: Búho ${A.paginas} págs · script ${B.paginas} págs`)
  }
} finally {
  app.kill()
}

// ─── Informe ─────────────────────────────────────────────────────────────────────────────────
const s = (ms) => `${(ms / 1000).toFixed(2)} s`
const m = (f) => median(f)
const A = res.buho
const B = res.script
const crear = m(A.map((a) => a.pasos.Crear))
const pdf0 = m(A.map((a) => a.pasos['PDF inicial']))
const sc0 = m(B.map((b) => b.inicial))
const rows = FIXES.map(([name], i) => {
  const edit = m(A.map((a) => a.fixes[i].edit))
  const exp = m(A.map((a) => a.fixes[i].export))
  const render = m(A.map((a) => a.fixes[i].render))
  const regen = m(B.map((b) => b.fixes[i].regen))
  return { name, edit, render, exp, regen }
})
const sumEdit = rows.reduce((x, r) => x + r.edit, 0)
const sumExp = rows.reduce((x, r) => x + r.exp, 0)
const sumRegen = rows.reduce((x, r) => x + r.regen, 0)
const md = [
  `# Banco de velocidad · Búho Docs frente a script reportlab`,
  '',
  `${new Date().toLocaleString('es-ES')} · documento de ${A[0].paginas} páginas (Búho) / ${B[0].paginas} (script) · mediana de ${RONDAS} rondas · CLI: ${existsSync(packaged) ? 'BuhoDocs.exe en modo Node (como un agente con la app instalada)' : 'Node'}`,
  '',
  '## De cero a PDF',
  '',
  '| Paso | Búho Docs | Script reportlab |',
  '|---|---|---|',
  `| Crear y verlo en pantalla | ${s(crear)} | — |`,
  `| Primer PDF | ${s(pdf0)} | ${s(sc0)} |`,
  `| **Total** | **${s(crear + pdf0)}** | **${s(sc0)}** |`,
  '',
  '## Los 5 arreglos',
  '',
  '| Arreglo | Búho: cambio en vivo | Búho: maquetar 20 págs | Búho: PDF justo después | Script: regenerar PDF |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${s(r.edit)} | ${s(r.render)} | ${s(r.exp)} | ${s(r.regen)} |`),
  `| **Total** | **${s(sumEdit)}** | | **${s(sumExp)}** | **${s(sumRegen)}** |`,
  '',
  `- Búho, 5 arreglos en vivo y un PDF al final: **${s(sumEdit + rows[rows.length - 1].exp)}**. Script, regenerando tras cada arreglo: **${s(sumRegen)}**.`,
  `- Caso normal con un agente (el modelo tarda un momento en escribir el siguiente comando): cambio ${s(m(A.map((a) => a.pensando.edit)))} y PDF **${s(m(A.map((a) => a.pensando.export)))}**${A.every((a) => a.pensando.caliente) ? ' (ya estaba hecho en segundo plano: solo se escribe)' : ''}.`,
  `- Coste fijo de una llamada al CLI sin trabajo (\`status\`): ${s(m(A.map((a) => a.cliVacio)))}.`,
  '- No cuenta lo que tarda el modelo en escribir: eso es igual o menor en Búho (un arreglo es un comando corto; con el script hay que editar el script y relanzarlo).',
  '- Tampoco cuenta la verificación: con el script, para ver el resultado hay que convertir el PDF a imágenes y mirarlas; en Búho lo ves en directo y `check` avisa en texto.',
  ''
].join('\n')
writeFileSync(join(root, 'bench', 'resultados.md'), md)
writeFileSync(join(out, 'resultados.json'), JSON.stringify(res, null, 2))
console.log('\n' + md)
