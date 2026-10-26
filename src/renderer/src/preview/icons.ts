import { icons } from 'lucide'

/**
 * Iconos (Lucide, MIT) en SVG: `{icon=cohete}` o `{icon=rocket}` en títulos y cajas.
 * Admite el nombre de Lucide (https://lucide.dev/icons) y unos alias en español.
 */
const ALIAS: Record<string, string> = {
  cohete: 'rocket',
  escudo: 'shield',
  reloj: 'clock',
  tiempo: 'clock',
  bombilla: 'lightbulb',
  idea: 'lightbulb',
  bulb: 'lightbulb',
  lupa: 'search',
  buscar: 'search',
  grafico: 'chart-column',
  gráfico: 'chart-column',
  chart: 'chart-column',
  crecimiento: 'trending-up',
  ventas: 'trending-up',
  usuarios: 'users',
  equipo: 'users',
  personas: 'users',
  rrhh: 'users',
  persona: 'user',
  documento: 'file-text',
  doc: 'file-text',
  ley: 'scale',
  legal: 'scale',
  law: 'scale',
  objetivo: 'target',
  diana: 'target',
  engranaje: 'settings',
  engranajes: 'cog',
  gears: 'cog',
  ajustes: 'sliders-horizontal',
  sliders: 'sliders-horizontal',
  mensaje: 'message-circle',
  chat: 'message-circle',
  cerebro: 'brain',
  red: 'network',
  megafono: 'megaphone',
  megáfono: 'megaphone',
  marketing: 'megaphone',
  calendario: 'calendar',
  carrito: 'shopping-cart',
  compras: 'shopping-cart',
  dinero: 'coins',
  monedas: 'coins',
  finanzas: 'landmark',
  banco: 'landmark',
  camion: 'truck',
  camión: 'truck',
  logistica: 'truck',
  logística: 'truck',
  fabrica: 'factory',
  fábrica: 'factory',
  produccion: 'factory',
  producción: 'factory',
  soporte: 'headset',
  atencion: 'headset',
  atención: 'headset',
  cliente: 'headset',
  informatica: 'monitor',
  informática: 'monitor',
  it: 'monitor',
  ordenador: 'monitor',
  ia: 'sparkles',
  magia: 'sparkles',
  rayo: 'zap',
  rapido: 'zap',
  rápido: 'zap',
  alerta: 'triangle-alert',
  aviso: 'triangle-alert',
  warning: 'triangle-alert',
  ojo: 'eye',
  bandera: 'flag',
  libro: 'book-open',
  book: 'book-open',
  formacion: 'graduation-cap',
  formación: 'graduation-cap',
  apreton: 'handshake',
  apretón: 'handshake',
  acuerdo: 'handshake',
  correo: 'mail',
  email: 'mail',
  telefono: 'phone',
  teléfono: 'phone',
  web: 'globe',
  ubicacion: 'map-pin',
  ubicación: 'map-pin',
  pin: 'map-pin',
  candado: 'lock',
  seguridad: 'shield-check',
  datos: 'database',
  base: 'database',
  nube: 'cloud',
  automatizar: 'workflow',
  flujo: 'workflow',
  robot: 'bot',
  agente: 'bot',
  check: 'circle-check',
  ok: 'circle-check',
  pregunta: 'circle-help',
  question: 'circle-help',
  euro: 'euro',
  portapapeles: 'clipboard-list',
  clipboard: 'clipboard-list',
  brujula: 'compass',
  brújula: 'compass',
  escalera: 'trending-up',
  stairs: 'trending-up',
  salvavidas: 'life-buoy',
  lifebuoy: 'life-buoy',
  presente: 'presentation',
  present: 'presentation',
  cuadricula: 'layout-grid',
  grid: 'layout-grid',
  edificio: 'building-2',
  empresa: 'building-2',
  tienda: 'store',
  factura: 'receipt',
  contrato: 'file-signature',
  firma: 'pen-line',
  estrella: 'star',
  corazon: 'heart',
  corazón: 'heart'
}

const pascal = (s: string): string =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('')

const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

export function iconSvg(name: string): string | null {
  // Sin tildes: «relój», «gráfico» o «Teléfono» valen igual que «reloj», «grafico», «telefono».
  const key = name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const node = (icons as Record<string, [string, Record<string, string | number>][]>)[pascal(ALIAS[key] ?? key)]
  if (!node) return null
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(String(v))}"`).join(' ')}/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
}

export const iconAliases = (): string[] => Object.keys(ALIAS)
