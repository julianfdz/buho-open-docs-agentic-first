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
const call = async (method, p, body) => {
  const { url, token } = JSON.parse(readFileSync(join(out, 'data', 'api.json'), 'utf8'))
  const r = await fetch(url + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
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

writeFileSync(join(out, 'grafico.md'), ['::: grafico columnas titulo="Ventas"', '| Mes | Ventas |', '|---|---|', '| Ene | 10 |', '| Feb | 14 |', ':::', ''].join('\n'))
const app = await electron.launch({ args: [root], env, timeout: 30000 })
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.waitForSelector('.home', { timeout: 15000 })
  for (let i = 0; i < 40; i++) { try { await cli('status'); break } catch { await sleep(250) } }
  await page.screenshot({ path: join(out, '01-inicio.png') })

  // Abrir por CLI: la app lo enseña.
  await cli('open', doc)
  // La vista por defecto es solo la página (como Word); la prueba usa página + Markdown.
  await page.locator('button[title="Página y Markdown"]').click()
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  const frame = page.frameLocator('iframe.preview')
  await frame.locator('.pg').first().waitFor({ timeout: 20000 })
  await page.waitForSelector('.status .pill')
  check((await page.locator('.tab.on').innerText()).includes('Beneficios'), 'El CLI abre el documento en una pestaña')
  await until(async () => /páginas/.test(await page.locator('.status').innerText()))
  check(/5 páginas/.test(await page.locator('.status').innerText()), `Vista previa paginada: ${(await page.locator('.status').innerText()).match(/\d+ páginas/)?.[0]}`)
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

  // Lote: varios cambios en una sola llamada y una sola entrada del historial.
  writeFileSync(join(out, 'ops.json'), JSON.stringify([
    { op: 'replace', find: 'Dónde ahorra horas', replace: 'Dónde ahorra horas de verdad' },
    { op: 'meta', key: 'lugar', value: 'Cartagena' },
    { op: 'append', content: '## Anexo del lote\n\nTexto añadido en lote.' }
  ]))
  const nHist = (await cliJson('history', doc)).length
  const bt = await cliJson('batch', doc, '--file', join(out, 'ops.json'), '--author', 'Claude')
  const h2 = await cliJson('history', doc)
  check(bt.applied === 3 && h2.length === nHist + 1 && text(doc).includes('Cartagena') && text(doc).includes('Anexo del lote'), `batch: ${bt.applied} cambios en una entrada del historial`)
  let bErr = ''
  try {
    writeFileSync(join(out, 'malo.json'), JSON.stringify([{ op: 'replace', find: 'Cartagena', replace: 'Lorca' }, { op: 'replace', find: 'texto que no existe', replace: 'x' }]))
    await cli('batch', doc, '--file', join(out, 'malo.json'))
  } catch (e) {
    bErr = e.stderr
  }
  check(/Cambio 2/.test(bErr) && text(doc).includes('Cartagena'), 'batch con un cambio imposible no aplica ninguno')

  // Escritura en directo: el texto aparece en el editor mientras llega.
  const { spawn } = await import('node:child_process')
  const sp = spawn('node', [join(root, 'bin', 'buho-docs.mjs'), 'stream', doc, '--section', 'Anexo del lote', '--author', 'Claude'], { env })
  const frase = 'Esta frase llega poco a poco, como si la escribiera la IA en este momento. '.repeat(4)
  let seenPartial = false
  for (let i = 0; i < frase.length; i += 12) {
    sp.stdin.write(frase.slice(i, i + 12))
    await sleep(40)
    if (!seenPartial && i > frase.length / 2) seenPartial = (await page.locator('.cm-content').innerText()).includes('Esta frase llega poco a poco')
  }
  sp.stdin.end()
  await new Promise((r) => sp.on('close', r))
  check(seenPartial, 'stream: el texto se ve en el editor antes de terminar')
  check(text(doc).includes(frase.trim()), 'stream: al terminar queda guardado entero')

  // Foto de una página para agentes.
  const snap = await cliJson('snapshot', doc, '--page', '2', '--out', join(out, 'pagina2.png'))
  check(existsSync(snap.file) && readFileSync(snap.file).length > 10000, `snapshot: PNG de la página 2 (${(snap.files[0].bytes / 1024).toFixed(0)} KB)`)

  // ─── Edición visual (como en Word) ─────────────────────────────────────────────────────────
  await cli('restore', doc, first.id.slice(0, 8), '--author', 'Claude')
  await until(async () => !(await page.locator('.cm-content').innerText()).includes('Anexo del lote'))
  await sleep(500)
  const parrafo = frame.locator('p[contenteditable="true"]', { hasText: 'La IA ya no es cosa de grandes empresas' }).first()
  await parrafo.click()
  await page.keyboard.press('End')
  await parrafo.evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    getSelection().removeAllRanges()
    getSelection().addRange(r)
  })
  await page.keyboard.type(' Frase escrita sobre la página.')
  check(await until(async () => text(doc).includes('criterio. Frase escrita sobre la página.'), 5000), 'Escribir sobre la página cambia el Markdown (y se guarda)')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Párrafo nuevo con Intro.')
  check(await until(async () => /\n\nPárrafo nuevo con Intro\.\n/.test(text(doc)), 5000), 'Intro parte el párrafo en dos')
  // Negrita con la barra: doble clic en una palabra y botón «Negrita».
  await frame.locator('p[contenteditable="true"]', { hasText: 'Párrafo nuevo con Intro' }).first().evaluate((el) => {
    el.focus()
    const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes('Intro'))
    const i = t.textContent.indexOf('Intro')
    const r = document.createRange()
    r.setStart(t, i)
    r.setEnd(t, i + 5)
    getSelection().removeAllRanges()
    getSelection().addRange(r)
  })
  await sleep(100)
  await page.locator('.formatbar button[title^="Negrita"]').click()
  check(await until(async () => text(doc).includes('Párrafo nuevo con **Intro**.'), 5000), 'Negrita desde la barra de formato')
  // Deshacer (Ctrl+Z sobre la página).
  await frame.locator('p[contenteditable="true"]', { hasText: 'Párrafo nuevo con' }).first().click()
  await page.keyboard.press('Control+z')
  check(await until(async () => text(doc).includes('Párrafo nuevo con Intro.') && !text(doc).includes('**Intro**'), 5000), 'Deshacer quita la negrita')
  // Estilo del párrafo: Título 2.
  await page.locator('.fb-style[title="Estilo del párrafo"]').selectOption('h2')
  check(await until(async () => /\n## Párrafo nuevo con Intro\.\n/.test(text(doc)), 5000), 'Estilo «Título 2» desde la barra')
  // Título de la portada (va a la cabecera YAML).
  const tit = frame.locator('[data-meta="titulo"]').first()
  await tit.click()
  await page.keyboard.press('End')
  await tit.evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    getSelection().removeAllRanges()
    getSelection().addRange(r)
  })
  await page.keyboard.type(' (editado)')
  check(await until(async () => /titulo: .*\(editado\)/.test(text(doc)), 5000), 'Editar el título en la portada cambia la cabecera')
  // Índice automático con números de página.
  await page.locator('.formatbar button[title^="Índice"]').click()
  check(await until(async () => (await frame.locator('.ix-item').count()) > 3, 6000), `Índice automático: ${await frame.locator('.ix-item').count()} entradas`)
  const nums = await frame.locator('.ix-n').allInnerTexts()
  check(nums.every((n) => /^\d+$/.test(n) && n !== '00') && Number(nums[nums.length - 1]) >= 3, `Índice con números de página (${nums.join(', ')})`)
  // Insertar un bloque desde la barra.
  await frame.locator('h2[contenteditable="true"]', { hasText: 'Por dónde empezar' }).first().click()
  await page.locator('.formatbar button[title^="Insertar"]').click()
  await page.locator('.fb-drop button', { hasText: 'Aviso' }).click()
  check(await until(async () => text(doc).includes('::: caja aviso icon=alerta'), 5000), 'Insertar un bloque (aviso) desde la barra')
  await page.screenshot({ path: join(out, '07-edicion-visual.png') })

  // Huecos: se ven como «generándose» y luego se rellenan.
  await cli('insertar', doc, 'hueco', '--author', 'Claude')
  check(await until(async () => (await frame.locator('.bx-hueco').count()) === 1, 5000), 'Hueco visible en la página')
  await cli('rellenar', doc, 'pendiente', '--text', 'Contenido que llega más tarde.', '--author', 'Claude')
  check(await until(async () => (await frame.locator('.bx-hueco').count()) === 0 && (await frame.locator('#root').innerText()).includes('Contenido que llega más tarde.'), 5000), 'rellenar sustituye el hueco')

  // Estilo blanco (sin marca).
  const blank = join(out, 'docs', 'blanco.md')
  await cli('new', blank, '--estilo', 'blanco', '--title', 'Documento en blanco')
  await frame.locator('.tema-blanco').first().waitFor({ timeout: 8000 })
  check((await frame.locator('.portada').count()) === 0 && (await frame.locator('.pg-marca img').count()) === 0, 'Documento en blanco: sin portada ni marca Búho')
  await page.screenshot({ path: join(out, '08-blanco.png') })
  await cli('open', doc)
  await frame.locator('.pg').first().waitFor()

  // Volver a la versión original para el resto de la prueba.
  await cli('restore', doc, first.id.slice(0, 8), '--author', 'Claude')

  // ─── Lectura para IAs: mapa, buscar, leer y editar por id ─────────────────────────────────
  const mp = await cliJson('mapa', doc)
  check(mp.sections.length >= 4 && mp.tokens > 300 && mp.sections.every((s) => /^b[0-9a-z]+$/.test(s.id)), `mapa: ${mp.sections.length} secciones, ${mp.tokens} tokens`)
  const bs = await cliJson('buscar', doc, 'facturas albaranes conciliacion')
  check(bs.hits.length > 0 && /Administración/.test(bs.hits[0].section + bs.hits[0].snippet), `buscar encuentra la sección correcta (${bs.hits[0]?.section})`)
  const typo = await cliJson('buscar', doc, 'facturacion')
  check(typo.hits.length > 0, 'buscar tolera variantes y erratas («facturacion» ~ «facturas»)')
  const lr = await cliJson('leer', doc, '--seccion', 'Tres tipos de beneficio', '--ids')
  check(/\[#b[0-9a-z]+\]/.test(lr.text) && !/\*\*/.test(lr.text), `leer devuelve texto limpio con ids (${lr.tokens} tokens)`)
  const idBloque = bs.hits[0].id
  await cli('editar', doc, '#' + idBloque, '--text', '- **Administración**: texto cambiado por id.', '--author', 'Claude')
  check(text(doc).includes('texto cambiado por id.'), 'editar por id cambia exactamente ese bloque')
  const mp2 = await cliJson('mapa', doc)
  check(mp.sections.every((s) => mp2.sections.some((x) => x.id === s.id)), 'Los ids de las secciones no cambian al editar otro bloque')

  // Plantillas y temas
  const fac = join(out, 'docs', 'factura.md')
  await cli('new', fac, '--plantilla', 'factura', '--tema', 'corporativo')
  check(/tema: corporativo/.test(text(fac)) && text(fac).includes('Base imponible'), 'new --plantilla factura --tema corporativo')
  await cli('tema', 'crear', 'prueba', '--nombre', 'Prueba', '--principal', '#5b2a86', '--acento', '#f5a623', '--marca', 'PRUEBA')
  await cli('tema', fac, 'prueba')
  await frame.locator('.tema-id-prueba').first().waitFor({ timeout: 8000 })
  check((await frame.locator('.pg-marca').first().innerText()).includes('PRUEBA'), 'Tema propio aplicado (marca en la cabecera)')
  await cli('open', doc)
  await frame.locator('.pg').first().waitFor()

  // ─── Páginas para IAs ─────────────────────────────────────────────────────────────────────
  const pgs = await cliJson('paginas', doc)
  check(pgs.total >= 3 && pgs.pages[1].tokens > 50, `paginas: ${pgs.total} páginas con su texto`)
  const pg2 = await cliJson('pagina', doc, '2', '--captura', '--width', '400', '--out', join(out, 'pagina2-captura.png'))
  check(pg2.text.length > 100 && existsSync(pg2.captura), `pagina 2 --captura: ${pg2.tokens} tokens + PNG`)

  // ─── Importar Word / HTML ─────────────────────────────────────────────────────────────────
  const html = join(out, 'origen.html')
  writeFileSync(html, '<h1>Informe importado de prueba</h1><p>Texto con <b>negrita</b>.</p><h2>1. Primera parte</h2><ul><li>Uno</li><li>Dos</li></ul><table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>')
  const imp = await cliJson('importar', html, '--salida', join(out, 'docs', 'importado.md'), '--tema', 'corporativo')
  const impTxt = text(imp.path)
  check(imp.titulo === 'Informe importado de prueba' && /## 1\. Primera parte/.test(impTxt) && /\*\*negrita\*\*/.test(impTxt) && /\| A \| B \|/.test(impTxt), 'importar HTML: título, secciones, negrita y tabla')

  // ─── CLI siempre activo (lo que hace buho-docs.exe) ───────────────────────────────────────
  const info = JSON.parse(readFileSync(join(out, 'data', 'api.json'), 'utf8'))
  const enApp = await (await fetch(info.url + '/v1/cli?raw=1', { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ argv: ['buscar', doc, 'beneficio'], cwd: root }) })).text()
  check(/#b[0-9a-z]+/.test(enApp), 'El CLI se ejecuta dentro de la app (POST /v1/cli)')
  const varios = await Promise.all(Array.from({ length: 12 }, (_, i) => fetch(info.url + '/v1/cli', { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ argv: ['mapa', doc], cwd: root }) }).then((r) => r.json())))
  check(varios.every((r) => r.code === 0 && r.stdout.includes('tokens')), '12 comandos a la vez dentro de la app')

  // PDF A4.
  const pdf = await cliJson('export', doc)
  check(existsSync(pdf.file) && pdf.pages >= 3 && readFileSync(pdf.file).subarray(0, 5).toString() === '%PDF-', `PDF A4: ${pdf.pages} páginas, ${(pdf.bytes / 1024).toFixed(0)} KB`)

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

  // Exportar a Word: un .docx de verdad (zip con word/document.xml) con los títulos como estilos.
  const wd = await cliJson('export', doc, '--word', '--out', join(out, 'beneficios.docx'))
  const zip = readFileSync(wd.file)
  check(zip.subarray(0, 2).toString() === 'PK' && zip.includes('word/document.xml') && wd.bytes > 5000, `export --word crea un .docx (${(wd.bytes / 1024).toFixed(0)} KB)`)

  // Borradores: nuevo sin elegir dónde, se edita como cualquier documento y «guardar» lo lleva a su sitio.
  const nb = await cliJson('nuevo', 'Acta e2e', '--plantilla', 'acta')
  check(nb.sinGuardar && existsSync(nb.path) && nb.path.includes('sin-guardar'), 'nuevo crea un borrador sin guardar')
  check((await cliJson('docs')).open.some((d) => d.path === nb.path && d.sinGuardar), 'docs marca el borrador como sin guardar')
  await cli('append', nb.path, '--text', 'Punto añadido por la IA.', '--author', 'Claude')
  const destino = join(out, 'docs', 'guardados', 'Acta e2e.md')
  const gd = await cliJson('guardar', nb.path, destino)
  check(gd.path === destino && text(destino).includes('Punto añadido por la IA.') && !existsSync(dirname(nb.path)), 'guardar copia el borrador y borra su carpeta temporal')

  // Revisión: un cambio con --proponer no se escribe hasta aceptarlo; comentarios anclados a su bloque.
  await cli('open', doc)
  const antesProp = text(doc)
  const pr = await cliJson('replace', doc, 'Por dónde empezar', 'Cómo empezar', '--proponer', '--author', 'Claude')
  check(pr.propuesta && text(doc) === antesProp, 'replace --proponer deja una propuesta sin tocar el archivo')
  check(await until(async () => (await frame.locator('.m-prop').count()) > 0), 'La vista marca lo que la IA propone cambiar')
  const ac = await cliJson('aceptar', doc, pr.propuesta)
  check(ac.aceptadas === 1 && text(doc).includes('## Cómo empezar'), 'aceptar aplica la propuesta')
  const cm = await cliJson('comentar', doc, 'Hazlo más corto', '--cita', 'Cómo empezar')
  const cs = await cliJson('comentarios', doc, '--abiertos')
  check(cs.length === 1 && cs[0].id === cm.id && cs[0].bloque?.id, `comentar ancla el comentario a su bloque (#${cs[0]?.bloque?.id})`)
  await cli('resolver', doc, cm.id)
  await cli('replace', doc, '## Cómo empezar', '## Por dónde empezar', '--author', 'Claude')
  check((await cliJson('comentarios', doc, '--abiertos')).length === 0, 'resolver cierra el comentario')

  // Gráfico desde una tabla: SVG en la vista y gráfico nativo en Word.
  await cli('append', doc, '--file', join(out, 'grafico.md'), '--author', 'Claude')
  check(await until(async () => (await frame.locator('svg.grafico-svg').count()) > 0), 'Un ::: grafico se dibuja en la vista')
  const wg = await cliJson('export', doc, '--word', '--out', join(out, 'grafico.docx'))
  check(readFileSync(wg.file).includes('word/charts/'), 'Word lleva el gráfico como gráfico nativo')

  // PowerPoint de la presentación.
  const pp = await cliJson('export', deck, '--pptx', '--out', join(out, 'presentacion.pptx'))
  const pz = readFileSync(pp.file)
  check(pz.subarray(0, 2).toString() === 'PK' && pz.includes('ppt/slides/slide7.xml') && pp.slides === 7, `export --pptx: ${pp.slides} diapositivas (${(pp.bytes / 1024).toFixed(0)} KB)`)

  // Comprobación visual: cada cambio dice qué páginas tocó; revisar da sus capturas; scan, todo y el mosaico.
  const ch = await cliJson('replace', doc, 'Medir y ampliar', 'Medir y crecer', '--author', 'Claude')
  check(Array.isArray(ch.paginas) && ch.paginas.length >= 1 && ch.totalPaginas >= 3, `Un cambio dice qué páginas tocó (${ch.paginas?.join(', ')} de ${ch.totalPaginas})`)
  const rv = await cliJson('revisar', doc)
  check(rv.paginas.length >= 1 && rv.paginas.every((x) => x.captura && existsSync(x.captura)), `revisar: capturas de las páginas cambiadas (${rv.paginas.map((x) => x.n).join(', ')})`)
  const sc = await cliJson('scan', doc)
  check(sc.total >= 3 && sc.mosaicos.length === 1 && existsSync(sc.mosaicos[0].file), `scan: ${sc.total} páginas, ${sc.problemas} problema(s) y mosaico`)
  writeFileSync(join(out, 'mal.md'), ['---', 'tipo: documento', 'titulo: "Mal"', 'portada: false', '---', '', '## A', '', '![](no-existe.png)', '', '| a | b |', '|---|---|', '| ' + 'x'.repeat(400) + ' | y |', ''].join('\n'))
  const sm = await cliJson('scan', join(out, 'mal.md'), '--sin-mosaico')
  const tipos = sm.paginas.flatMap((x) => x.avisos.map((y) => y.tipo))
  check(tipos.includes('imagen-rota') && tipos.includes('se-sale-por-la-derecha'), `scan detecta imagen rota y tabla que se sale (${tipos.join(', ')})`)

  // Torneo (sin modelos): dos variantes de una sección como propuestas con captura; elegir una descarta la otra.
  const v1 = await call('POST', '/v1/variante', { path: doc, seccion: 'La respuesta corta', content: 'Versión uno de la respuesta corta.', grupo: 'te2e', variante: 1, author: 'Claude' })
  const v2 = await call('POST', '/v1/variante', { path: doc, seccion: 'La respuesta corta', content: 'Versión dos, más corta.', grupo: 'te2e', variante: 2, author: 'Claude' })
  check(v1.propuesta && v2.propuesta && v1.capturas.length && existsSync(v1.capturas[0]), 'torneo: cada variante es una propuesta con la captura de cómo quedaría')
  await cli('elegir', doc, v2.propuesta)
  check(text(doc).includes('Versión dos, más corta.') && (await cliJson('propuestas', doc)).length === 0, 'elegir aplica la variante y descarta las demás')

  // Formato técnico: fórmulas, código resaltado, Mermaid y SVG (sin scripts); en Word, como imagen.
  const ft = join(out, 'docs', 'formato.md')
  copyFileSync(join(root, 'examples', 'formato-tecnico.md'), ft)
  await cli('open', ft)
  check(await until(async () => (await frame.locator('.bx-mermaid svg').count()) === 2, 15000), 'Mermaid: los dos diagramas se dibujan')
  check((await frame.locator('.katex').count()) >= 2 && (await frame.locator('.math-block').count()) === 1, 'Fórmulas con KaTeX (en línea y en bloque)')
  check((await frame.locator('figure.code .hljs-keyword').count()) > 0, 'Código con resaltado de sintaxis')
  check((await frame.locator('.bx-svg svg').count()) === 1 && (await frame.locator('.bx-svg script').count()) === 0, 'SVG incrustado, sin scripts')
  const fw = await cliJson('export', ft, '--word', '--out', join(out, 'formato.docx'))
  check((readFileSync(fw.file).toString('latin1').match(/word\/media\/[\w.-]+?\.png/g) ?? []).length >= 4, 'Word lleva diagramas, SVG y fórmulas como imagen')

  // Aire IA: detección determinista.
  writeFileSync(join(out, 'aire.md'), ['---', 'tipo: documento', 'titulo: "A"', 'portada: false', '---', '', '## Intro', '', 'En el mundo actual, la IA no es solo una herramienta, sino un aliado estratégico. ¡Ya!', '', 'Formad a dos personas este mes.', ''].join('\n'))
  const es = await cliJson('estilo', join(out, 'aire.md'))
  const tiposAire = es.hallazgos.map((h) => h.tipo)
  check(['apertura-grandilocuente', 'no-es-solo', 'cliche-ia', 'exclamacion'].every((t) => tiposAire.includes(t)) && es.hallazgos.every((h) => h.linea === 9), `estilo detecta el aire IA (${es.marcas} marcas) y deja en paz el texto normal`)

  // Lo aprendido haciendo un lead magnet: diagrama demasiado ancho, variante mal escrita, id nuevo al editar.
  const ancho = ['---', 'tipo: documento', 'titulo: "D"', 'portada: false', '---', '', '## A', '', '::: caja nubecita', 'Hola.', ':::', '', 'Párrafo para editar.', '', '```mermaid', 'flowchart LR', '  A[Primera caja larga] --> B[Segunda caja larga] --> C[Tercera caja larga] --> D[Cuarta caja larga] --> E[Quinta caja larga] --> F[Sexta caja larga] --> G[Séptima]', '```', '']
  writeFileSync(join(out, 'ancho.md'), ancho.join('\n'))
  await cli('open', join(out, 'ancho.md'))
  const sa = await cliJson('scan', join(out, 'ancho.md'), '--sin-mosaico')
  check(sa.paginas.some((x) => x.avisos.some((y) => y.tipo === 'diagrama-ilegible')), 'scan avisa de un diagrama demasiado ancho para leerse')
  check((await cliJson('check', join(out, 'ancho.md'))).warnings.some((w) => /Variante «nubecita»/.test(w.message)), 'check avisa de una variante de bloque que no existe')
  const lp = await cliJson('leer', join(out, 'ancho.md'), '--ids')
  const idP = lp.text.match(/\[#(b[a-z0-9]+)\] Párrafo para editar/)?.[1]
  const ed = await cliJson('editar', join(out, 'ancho.md'), '#' + idP, '--text', 'Párrafo ya editado.')
  check(ed.id && ed.id !== idP && (await cliJson('leer', join(out, 'ancho.md'), '--ids')).text.includes('[#' + ed.id + '] Párrafo ya editado.'), 'editar devuelve el id nuevo del bloque')

  // Cada sección (##) empieza en página nueva; con «secciones: seguidas», no.
  const secs = ['---', 'tipo: documento', 'titulo: "S"', 'portada: false', '---', '', '## Uno', '', 'Texto corto.', '', '## Dos', '', 'Otro texto.', '']
  writeFileSync(join(out, 'secs.md'), secs.join(String.fromCharCode(10)))
  check((await cliJson('check', join(out, 'secs.md'))).pages === 2, 'Cada sección empieza en una página nueva')
  writeFileSync(join(out, 'secs2.md'), secs.join(String.fromCharCode(10)).replace('portada: false', 'portada: false' + String.fromCharCode(10) + 'secciones: seguidas'))
  check((await cliJson('check', join(out, 'secs2.md'))).pages === 1, 'Con «secciones: seguidas» van en la misma página')

  // Proveedores: claude siempre; cerebras, groq y openai según claves (nunca se devuelven).
  const pv = await cliJson('proveedores')
  check(pv.proveedores.some((x) => x.id === 'claude' && x.configurado) && !JSON.stringify(pv).match(/csk-|gsk_|sk-/), 'proveedores: lista sin enseñar claves')

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
