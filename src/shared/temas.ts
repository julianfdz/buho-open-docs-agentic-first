/**
 * Temas: el aspecto de un documento como paquete (colores, letras, logo, portada y CSS propio). Hay
 * unos de serie y cada usuario crea los suyos en <datos>/temas/<id>/tema.json (+ logo y estilo.css).
 * El documento elige con `tema: <id>` en la cabecera.
 */
export interface Tema {
  id: string
  nombre: string
  /** Estructura de partida: buho (portada con imagen, cabecera con marca) o blanco (limpio). */
  base: 'buho' | 'blanco'
  colores: {
    /** Títulos, tablas, fondos oscuros. */
    principal: string
    /** Detalles: barra superior, iconos, viñetas, etiquetas. */
    acento: string
    texto?: string
    /** Fondo de cajas y tarjetas. */
    suave?: string
  }
  fuentes?: { titulos?: string; texto?: string }
  /** URL del logo (buho://file/… o recurso de la app). */
  logo?: string
  /** Texto de marca en la cabecera de cada página («BÚHO AI»). */
  marca?: string
  /** Pie de página por defecto. */
  pie?: string
  /** arbol (la del estilo Búho), simple (logo, título y una banda de color) o ninguna. */
  portada?: 'arbol' | 'simple' | 'ninguna'
  /** CSS extra del tema. */
  css?: string
  /** De serie o creado por el usuario. */
  propio?: boolean
}

export const TEMAS_BASE: Tema[] = [
  { id: 'buho', nombre: 'Búho AI', base: 'buho', colores: { principal: '#0a1f3a', acento: '#00c1b8', suave: '#e4f7f6' }, portada: 'arbol', marca: 'BÚHO AI' },
  { id: 'blanco', nombre: 'En blanco', base: 'blanco', colores: { principal: '#111111', acento: '#444444', suave: '#f3f3f3' }, portada: 'ninguna', marca: '' },
  { id: 'corporativo', nombre: 'Corporativo azul', base: 'blanco', colores: { principal: '#1f3b63', acento: '#2f80ed', suave: '#eaf2fd' }, fuentes: { titulos: 'Segoe UI Semibold, Segoe UI, Arial, sans-serif', texto: 'Segoe UI, Arial, sans-serif' }, portada: 'simple' },
  { id: 'calido', nombre: 'Cálido', base: 'blanco', colores: { principal: '#6b2d24', acento: '#d9822b', suave: '#fbf1e6' }, fuentes: { titulos: 'Georgia, serif', texto: 'Calibri, Carlito, sans-serif' }, portada: 'simple' },
  { id: 'moderno', nombre: 'Moderno', base: 'blanco', colores: { principal: '#0f172a', acento: '#16a34a', suave: '#ecfdf3' }, fuentes: { titulos: 'Segoe UI Black, Arial Black, sans-serif', texto: 'Segoe UI, Arial, sans-serif' }, portada: 'simple' }
]

/** Nombre del tema que pide el documento (`tema:`; `estilo:` por compatibilidad). */
export function temaDe(meta: Record<string, unknown>): string {
  const v = String(meta.tema ?? meta.estilo ?? meta.theme ?? 'buho').trim().toLowerCase()
  return /^(plain|blank|word|limpio|ninguno)$/.test(v) ? 'blanco' : v || 'buho'
}

/** Variables CSS del tema (las usa toda la hoja de estilos). */
export function varsDe(t: Tema): Record<string, string> {
  const v: Record<string, string> = {
    '--navy': t.colores.principal,
    '--turq': t.colores.acento,
    '--turq-d': t.colores.acento,
    '--turq-l': t.colores.suave ?? '#f3f5f8'
  }
  if (t.colores.texto) v['--texto'] = t.colores.texto
  if (t.fuentes?.titulos) v['--serif'] = t.fuentes.titulos
  if (t.fuentes?.texto) v['--sans'] = t.fuentes.texto
  return v
}

const HEX = /^#[0-9a-f]{6}$/i
/** Comprueba un tema creado por el usuario (para dar un error claro). */
export function validarTema(t: Partial<Tema>): string[] {
  const e: string[] = []
  if (!t.id || !/^[a-z0-9-]+$/.test(t.id)) e.push('id: solo minúsculas, números y guiones')
  if (!t.colores?.principal || !HEX.test(t.colores.principal)) e.push('colores.principal: un color #rrggbb')
  if (!t.colores?.acento || !HEX.test(t.colores.acento)) e.push('colores.acento: un color #rrggbb')
  if (t.colores?.suave && !HEX.test(t.colores.suave)) e.push('colores.suave: un color #rrggbb')
  return e
}
