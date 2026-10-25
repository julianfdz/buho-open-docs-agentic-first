import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * API local para agentes y para el CLI `buho-docs`. Solo escucha en 127.0.0.1 y exige un token
 * aleatorio que se escribe en <userData>/api.json (una web abierta en el navegador no puede usarla).
 *
 *   GET  /v1/status                                  → app viva, versión, documentos abiertos
 *   GET  /v1/docs                                    → abiertos y recientes
 *   GET  /v1/templates                               → diseños, bloques e iconos disponibles
 *   POST /v1/new      {"path","kind","title","subtitle","content","author"}
 *   POST /v1/open     {"path"}                       → lo abre y lo enseña
 *   GET  /v1/read?path=                              → contenido actual
 *   GET  /v1/outline?path=                           → títulos (y diapositivas) con su línea
 *   POST /v1/write    {"path","content","author","summary"}       → reescribe el documento entero
 *   POST /v1/replace  {"path","find","replace","all","author"}    → cambia un texto exacto (erratas)
 *   POST /v1/section  {"path","heading","content","mode","author"} → cambia una sección
 *   POST /v1/slide    {"path","n","content","mode","to","author"}  → cambia diapositivas
 *   POST /v1/append   {"path","content","author"}
 *   POST /v1/meta     {"path","key","value","author"}  → campo de la cabecera
 *   POST /v1/export   {"path","out"}                 → PDF
 *   GET  /v1/check?path=                             → páginas y avisos (diapositivas que no caben…)
 *   GET  /v1/history?path=&limit=                    → historial (quién cambió qué)
 *   GET  /v1/diff?path=&id=                          → qué cambió en una entrada del historial
 *   POST /v1/restore  {"path","id","author"}         → vuelve a una versión
 *   POST /v1/show     {"path","line"}                → lo enseña en la app (en esa línea)
 *   POST /v1/tag      {"path","author","seconds"}    → firma el próximo cambio en disco
 */
export type ApiCall = (method: string, params: Record<string, unknown>) => Promise<unknown>

const ROUTES: Record<string, string> = {
  'GET /v1/status': 'status',
  'GET /v1/docs': 'docs',
  'GET /v1/templates': 'templates',
  'POST /v1/new': 'new',
  'POST /v1/open': 'open',
  'GET /v1/read': 'read',
  'GET /v1/outline': 'outline',
  'POST /v1/write': 'write',
  'POST /v1/replace': 'replace',
  'POST /v1/section': 'section',
  'POST /v1/slide': 'slide',
  'POST /v1/append': 'append',
  'POST /v1/meta': 'meta',
  'POST /v1/export': 'export',
  'GET /v1/check': 'check',
  'GET /v1/history': 'history',
  'GET /v1/diff': 'diff',
  'POST /v1/restore': 'restore',
  'POST /v1/show': 'show',
  'POST /v1/tag': 'tag'
}

export const DEFAULT_PORT = 47341
let server: Server | null = null
const infoFile = (): string => join(app.getPath('userData'), 'api.json')

export function startApi(call: ApiCall): void {
  const token = randomBytes(24).toString('hex')
  server = createServer(async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Token no válido. Léelo de api.json.' })
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let body: Record<string, unknown> = {}
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      } catch {
        return send(400, { error: 'JSON no válido' })
      }
    }
    const method = ROUTES[`${req.method} ${url.pathname}`]
    if (!method) return send(404, { error: `Ruta desconocida: ${req.method} ${url.pathname}` })
    try {
      send(200, await call(method, { ...Object.fromEntries(url.searchParams), ...body }))
    } catch (e) {
      send(400, { error: e instanceof Error ? e.message : String(e) })
    }
  })
  // Exportar un documento largo puede tardar: sin límite de tiempo por petición.
  server.requestTimeout = 0
  server.headersTimeout = 0
  const listen = (port: number): void => {
    server!.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE' && port !== 0) listen(0)
    })
    server!.listen(port, '127.0.0.1', () => {
      const addr = server!.address()
      const real = typeof addr === 'object' && addr ? addr.port : port
      writeFileSync(infoFile(), JSON.stringify({ url: `http://127.0.0.1:${real}`, token, pid: process.pid }, null, 2))
    })
  }
  listen(Number(process.env.BUHO_API_PORT) || DEFAULT_PORT)
}

export function stopApi(): void {
  server?.close()
  try {
    rmSync(infoFile(), { force: true })
  } catch {
    /* nada */
  }
}
