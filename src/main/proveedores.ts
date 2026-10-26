import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Proveedores de modelos para los agentes de Búho Docs. Por defecto se usa `claude -p` (la sesión
 * de Claude Code del usuario). Para ir muy rápido, Cerebras o Groq (API compatible con OpenAI:
 * unos 400 palabras en ~1,5 s). OpenAI solo para generar imágenes, que cuesta dinero y va apagado.
 * Las claves se guardan en <datos>\proveedores.json (fuera de cualquier repositorio) o se leen de
 * variables de entorno; nunca se devuelven por la API.
 */
export type ProveedorId = 'claude' | 'cerebras' | 'groq' | 'openai'

interface Def {
  nombre: string
  base?: string
  env: string
  modelo: string
  uso: string
}
export const PROVEEDORES: Record<ProveedorId, Def> = {
  claude: { nombre: 'Claude (Claude Code)', env: '', modelo: 'sonnet', uso: 'Calidad: usa la sesión de claude del usuario' },
  cerebras: { nombre: 'Cerebras', base: 'https://api.cerebras.ai/v1', env: 'CEREBRAS_API_KEY', modelo: 'gpt-oss-120b', uso: 'Muy rápido (~1,5 s por sección)' },
  groq: { nombre: 'Groq', base: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY', modelo: 'openai/gpt-oss-120b', uso: 'Muy rápido (~2 s por sección)' },
  openai: { nombre: 'OpenAI', base: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY', modelo: 'gpt-image-2', uso: 'Imágenes generadas (de pago, apagado por defecto)' }
}

interface Config {
  claves: Partial<Record<ProveedorId, string>>
  /** Proveedor de texto por defecto para generar, torneo, atender y humanizar. */
  porDefecto?: ProveedorId
  /** Permitir generar imágenes con OpenAI (cuesta dinero). */
  imagenesIA?: boolean
}

const file = (): string => join(app.getPath('userData'), 'proveedores.json')
function leer(): Config {
  try {
    return { claves: {}, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Config>) }
  } catch {
    return { claves: {} }
  }
}
function escribir(c: Config): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify(c, null, 2))
}

export function clave(p: ProveedorId): string | undefined {
  return leer().claves[p] ?? (PROVEEDORES[p].env ? process.env[PROVEEDORES[p].env] : undefined) ?? undefined
}

/** Lo que se puede enseñar: qué hay configurado (sin las claves). */
export function estado(): { porDefecto: ProveedorId; imagenesIA: boolean; proveedores: { id: ProveedorId; nombre: string; configurado: boolean; modelo: string; uso: string }[] } {
  const c = leer()
  return {
    porDefecto: c.porDefecto ?? 'claude',
    imagenesIA: !!c.imagenesIA,
    proveedores: (Object.keys(PROVEEDORES) as ProveedorId[]).map((id) => ({ id, nombre: PROVEEDORES[id].nombre, configurado: id === 'claude' || !!clave(id), modelo: PROVEEDORES[id].modelo, uso: PROVEEDORES[id].uso }))
  }
}

/** Guarda una clave: escrita, o leída de un archivo .env (sin enseñarla nunca). */
export function guardarClave(p: ProveedorId, o: { clave?: string; envFile?: string; variable?: string }): void {
  if (!(p in PROVEEDORES) || p === 'claude') throw new Error('Proveedor: cerebras, groq u openai')
  let k = o.clave
  if (!k && o.envFile) {
    if (!existsSync(o.envFile)) throw new Error(`No existe ${o.envFile}`)
    const v = o.variable ?? PROVEEDORES[p].env
    const linea = readFileSync(o.envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith(v + '='))
    if (!linea) throw new Error(`${o.envFile} no tiene ${v}`)
    k = linea.slice(v.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  if (!k) throw new Error('Falta la clave (--clave o --env archivo.env)')
  const c = leer()
  c.claves[p] = k
  escribir(c)
}

export function configurar(o: { porDefecto?: ProveedorId; imagenesIA?: boolean }): void {
  const c = leer()
  if (o.porDefecto) {
    if (!(o.porDefecto in PROVEEDORES) || o.porDefecto === 'openai') throw new Error('Proveedor de texto: claude, cerebras o groq')
    c.porDefecto = o.porDefecto
  }
  if (o.imagenesIA !== undefined) c.imagenesIA = o.imagenesIA
  escribir(c)
}

export const porDefecto = (): ProveedorId => leer().porDefecto ?? 'claude'
export const imagenesIA = (): boolean => !!leer().imagenesIA

/** Texto con Cerebras o Groq (Claude va por `claude -p` en el CLI). */
export async function completar(p: ProveedorId, prompt: string, modelo?: string, max = 8000): Promise<{ texto: string; ms: number; modelo: string; proveedor: ProveedorId }> {
  // gpt-oss a veces se gasta todo pensando y devuelve vacío: un reintento, con el otro proveedor rápido si lo hay.
  const r = await completarUna(p, prompt, modelo, max)
  if (r.texto) return { ...r, proveedor: p }
  const otro: ProveedorId | undefined = (['cerebras', 'groq'] as ProveedorId[]).find((x) => x !== p && clave(x))
  const r2 = await completarUna(otro ?? p, prompt, otro ? undefined : modelo, max)
  if (!r2.texto) throw new Error('el modelo no ha devuelto texto (dos intentos)')
  return { ...r2, ms: r.ms + r2.ms, proveedor: otro ?? p }
}

async function completarUna(p: ProveedorId, prompt: string, modelo: string | undefined, max: number): Promise<{ texto: string; ms: number; modelo: string }> {
  const d = PROVEEDORES[p]
  if (!d?.base || p === 'openai') throw new Error(`«${p}» no sirve para texto aquí (usa claude, cerebras o groq)`)
  const k = clave(p)
  if (!k) throw new Error(`Falta la clave de ${d.nombre}: buho-docs proveedor ${p} --env archivo.env (o la variable ${d.env})`)
  const t = Date.now()
  const m = modelo ?? d.modelo
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120_000)
  try {
    const r = await fetch(d.base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { authorization: 'Bearer ' + k, 'content-type': 'application/json' },
      // gpt-oss: razonar poco (escribe en lugar de pensar) y más rápido.
      body: JSON.stringify({ model: m, messages: [{ role: 'user', content: prompt }], max_completion_tokens: max, ...(/gpt-oss/.test(m) ? { reasoning_effort: 'low' } : {}) })
    })
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string }
    if (!r.ok || j.error) throw new Error(`${d.nombre}: ${typeof j.error === 'string' ? j.error : j.error?.message ?? r.statusText}`)
    return { texto: (j.choices?.[0]?.message?.content ?? '').trim(), ms: Date.now() - t, modelo: m }
  } finally {
    clearTimeout(timer)
  }
}

/** Imagen generada con OpenAI (de pago): PNG. */
export async function generarImagen(prompt: string, tamaño = '1536x1024', calidad = 'medium'): Promise<{ png: Buffer; modelo: string }> {
  if (!imagenesIA()) throw new Error('Generar imágenes con IA está apagado (cuesta dinero). Actívalo con: buho-docs proveedor openai --imagenes si')
  const k = clave('openai')
  if (!k) throw new Error('Falta la clave de OpenAI: buho-docs proveedor openai --env archivo.env --variable NOMBRE')
  let ultimo = ''
  for (const modelo of ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1']) {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + k, 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelo, prompt, size: tamaño, quality: calidad, n: 1 })
    })
    const j = (await r.json()) as { data?: { b64_json?: string }[]; error?: { message?: string } }
    if (r.ok && j.data?.[0]?.b64_json) return { png: Buffer.from(j.data[0].b64_json, 'base64'), modelo }
    ultimo = j.error?.message ?? r.statusText
    if (!/model/i.test(ultimo)) break
  }
  throw new Error(`OpenAI: ${ultimo}`)
}
