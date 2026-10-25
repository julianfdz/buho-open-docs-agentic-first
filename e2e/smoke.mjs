/**
 * Prueba de punta a punta con la app aislada (BUHO_DATA_DIR) y copias de los ejemplos en e2e/.out:
 * abrir por CLI, cambios de la IA en directo (resaltados en editor y vista), escribir en la app con
 * autoguardado, erratas, secciones, diapositivas, avisos de diapositiva que no cabe, historial firmado,
 * vuelta atrás, edición directa del archivo firmada con `tag` y exportación a PDF (A4 y 16:9).
 */
import { _electron as electron } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'e2e', '.out')
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'docs'), { recursive: true })
const doc = join(out, 'docs', 'beneficios.md')
const deck = join(out, 'docs', 'presentacion.md')
copyFileSync(join(root, 'examples', 'beneficios-ia-pymes.md'), doc)
copyFileSync(join(root, 'examples', 'beneficios-ia-pymes-slides.md'), deck)

const env = { ...process.env, BUHO_DATA_DIR: join(out, 'data'), BUHO_E2E: '1', BUHO_API_PORT: '47399', BUHO_NO_LAUNCH: '1' }
delete env.ELECTRON_RUN_AS_NODE
const run = promisify(execFile)
const cli = async (...a) => (await run('node', [join(root, 'bin', 'buho-docs.mjs'), ...a], { env, encoding: 'utf8', timeout: 120000 })).stdout
const cliJson = async (...a) => JSON.parse(await cli(...a, '--json'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const text = (p) => readFileSync(p, 'utf8')
let failed = false
const check = (ok, msg) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`)
  if (!ok) failed = true
}
async function until(fn, ms = 8000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await fn()) return true
    await sleep(150)
  }
  return false
}

const app = await electron.launch({ args: [root], env, timeout: 30000 })
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.waitForSelector('.home', { timeout: 15000 })
  for (let i = 0; i < 40; i++) { try { await cli('status'); break } catch { await sleep(250) } }
  await page.screenshot({ path: join(out, '01-inicio.png') })

  // Abrir por CLI: la app lo enseña.
  await cli('open', doc)
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  const frame = page.frameLocator('iframe.preview')
  await frame.locator('.pg').first().waitFor({ timeout: 20000 })
  await page.waitForSelector('.status .pill')
  check((await page.locator('.tab.on').innerText()).includes('Beneficios'), 'El CLI abre el documento en una pestaña')
  await until(async () => /páginas/.test(await page.locator('.status').innerText()))
  check(/3 páginas/.test(await page.locator('.status').innerText()), `Vista previa paginada: ${(await page.locator('.status').innerText()).match(/\d+ páginas/)?.[0]}`)
  await page.screenshot({ path: join(out, '02-documento.png') })

  // Esquema y lectura para agentes.
  const ol = await cliJson('outline', doc)
  check(ol.headings.length >= 5 && ol.headings.some((h) => h.text === 'Por dónde empezar'), `outline: ${ol.headings.length} títulos`)

  // La IA reescribe una sección: se ve en directo y resaltada.
  writeFileSync(join(out, 'seccion.md'), 'La IA ya **no es cosa de grandes empresas**: cualquier pyme puede empezar este mes.\n\nEsta frase la ha escrito la IA en la prueba.\n')
  await cli('section', doc, 'La respuesta corta', '--file', join(out, 'seccion.md'), '--author', 'Claude')
  const live = await until(async () => (await page.locator('.cm-content').innerText()).includes('Esta frase la ha escrito la IA'))
  check(live, 'Cambio de la IA visible en el editor sin recargar')
  check(await until(async () => (await frame.locator('#root').innerText()).includes('Esta frase la ha escrito la IA')), 'Cambio de la IA visible en la vista previa')
  check((await page.locator('.cm-flash').count()) > 0, 'Líneas cambiadas resaltadas en el editor')
  check(await until(async () => (await frame.locator('.flash').count()) > 0, 3000), 'Bloques cambiados resaltados en la vista previa')
  check((await page.locator('.toast').innerText()).includes('Claude'), `Aviso: «${await page.locator('.toast').innerText()}»`)
  await page.screenshot({ path: join(out, '03-cambio-ia.png') })

  // Errata: la corrige la IA con replace.
  await cli('replace', doc, 'pyme puede empezar', 'pyme puede empezar ya', '--author', 'Claude')
  check(text(doc).includes('pyme puede empezar ya'), 'replace cambia el texto exacto')
  let err = ''
  try {
    await cli('replace', doc, 'IA', 'X')
  } catch (e) {
    err = e.stderr
  }
  check(/aparece \d+ veces/.test(err), 'replace no toca nada si el texto es ambiguo')

  // El usuario escribe en la app: autoguardado y en el historial como «Tú».
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nTexto escrito por la persona.')
  check(await until(async () => text(doc).includes('Texto escrito por la persona.'), 5000), 'Lo escrito en la app se guarda solo en el .md')

  // La IA escribe justo después: antes guarda lo pendiente de la app (no se pierde nada).
  await page.keyboard.type(' Y algo más.')
  await cli('append', doc, '--text', 'Párrafo final añadido por la IA.', '--author', 'Codex')
  const t1 = text(doc)
  check(t1.includes('Y algo más.') && t1.includes('Párrafo final añadido por la IA.'), 'Lo pendiente de la app se guarda antes del cambio de la IA')

  // Cabecera.
  await cli('meta', doc, 'subtitulo', 'Subtítulo cambiado por la IA', '--author', 'Claude')
  check(await until(async () => (await frame.locator('#root').innerText()).includes('Subtítulo cambiado')), 'meta cambia la portada')

  // Edición directa del archivo (herramientas propias del agente) firmada con tag.
  await cli('tag', doc, '--author', 'Gemini')
  writeFileSync(doc, text(doc).replace('## Tres tipos de beneficio', '## Tres beneficios claros'))
  check(await until(async () => (await page.locator('.cm-content').innerText()).includes('Tres beneficios claros')), 'Edición directa del archivo detectada en directo')

  // Historial firmado.
  await sleep(300)
  const h = await cliJson('history', doc)
  const authors = h.map((x) => (x.kind === 'user' ? 'Tú' : x.author))
  check(['Claude', 'Codex', 'Gemini', 'Tú'].every((a) => authors.includes(a)), `Historial con autores: ${[...new Set(authors)].join(', ')}`)
  await page.locator('button[title^="Historial"]').click()
  await page.waitForSelector('.hitem')
  await page.locator('.hitem.k-ai').first().click()
  await page.waitForSelector('.hunk')
  await page.screenshot({ path: join(out, '04-historial.png') })
  const d = await cliJson('diff', doc)
  check(/Tres beneficios claros/.test(d.diff), 'diff de la última entrada')

  // Volver atrás.
  const first = h[h.length - 1]
  await cli('restore', doc, first.id.slice(0, 8), '--author', 'Claude')
  check(text(doc) === readFileSync(join(root, 'examples', 'beneficios-ia-pymes.md'), 'utf8'), 'restore vuelve a la versión inicial')

  // PDF A4.
  const pdf = await cliJson('export', doc)
  check(existsSync(pdf.file) && pdf.pages === 3 && readFileSync(pdf.file).subarray(0, 5).toString() === '%PDF-', `PDF A4: ${pdf.pages} páginas, ${(pdf.bytes / 1024).toFixed(0)} KB`)

  // Presentación: diapositivas, avisos y PDF 16:9.
  await cli('open', deck)
  await frame.locator('.slide').first().waitFor({ timeout: 10000 })
  await page.screenshot({ path: join(out, '05-presentacion.png') })
  const so = await cliJson('outline', deck)
  check(so.slides.length === 7 && so.slides[0].layout === 'portada', `outline de la presentación: ${so.slides.length} diapositivas`)
  writeFileSync(join(out, 'diapo.md'), '@etiqueta: PRUEBA\n\n## Diapositiva nueva de la IA\n\n- Primera idea\n- Segunda idea\n')
  await cli('slide', deck, '3', '--mode', 'insert', '--file', join(out, 'diapo.md'), '--author', 'Claude')
  check((await cliJson('outline', deck)).slides[2].title === 'Diapositiva nueva de la IA', 'slide --mode insert')
  check(await until(async () => (await frame.locator('.slide').count()) === 8), 'La vista previa enseña la diapositiva nueva')
  writeFileSync(join(out, 'larga.md'), '## Demasiado texto\n\n' + Array.from({ length: 30 }, (_, i) => `- Punto ${i + 1} con bastante texto para que no quepa en la diapositiva`).join('\n'))
  await cli('slide', deck, '3', '--file', join(out, 'larga.md'), '--author', 'Claude')
  const ck = await cliJson('check', deck)
  check(ck.warnings.some((w) => w.slide === 3 && /no cabe/.test(w.message)), `check avisa de la diapositiva que no cabe: «${ck.warnings[0]?.message}»`)
  await cli('slide', deck, '3', '--mode', 'delete', '--author', 'Claude')
  await cli('slide', deck, '6', '--mode', 'move', '--to', '2', '--author', 'Claude')
  check((await cliJson('outline', deck)).slides[1].title === 'Tres pasos, en este orden', 'slide --mode move')
  const dp = await cliJson('export', deck, '--out', join(out, 'presentacion.pdf'))
  check(dp.pages === 7, `PDF 16:9: ${dp.pages} diapositivas`)

  // Documento nuevo desde el CLI.
  const nd = await cliJson('new', join(out, 'docs', 'nuevo.md'), '--kind', 'presentacion', '--title', 'Prueba nueva')
  check(existsSync(nd.path) && nd.kind === 'presentacion', 'new crea una presentación desde plantilla')
  const ck2 = await cliJson('check', nd.path)
  check(ck2.warnings.length === 0, `La plantilla no da avisos (${ck2.warnings.map((w) => w.message).join('; ')})`)

  // Clic en la vista → el editor va a esa línea.
  await cli('open', doc)
  await frame.locator('.pg').first().waitFor()
  await sleep(600)
  await frame.locator('h2', { hasText: 'Por dónde empezar' }).first().click()
  await sleep(300)
  const line = await page.locator('.cm-activeLine').innerText()
  check(line.includes('Por dónde empezar'), `Clic en la vista lleva el editor a la línea: «${line}»`)

  // Tema oscuro.
  await page.locator('button[title="Tema claro / oscuro"]').click()
  await sleep(400)
  await page.screenshot({ path: join(out, '06-oscuro.png') })
  await page.locator('button[title="Tema claro / oscuro"]').click()
} catch (e) {
  console.error(e)
  failed = true
} finally {
  await app.close()
}
console.log(failed ? '\nFALLA' : '\nTodo bien')
process.exit(failed ? 1 : 0)
