/** Lo que entiende la plantilla Búho (lo comparten la vista previa, la API y la guía para agentes). */

export const CONTAINERS = ['caja', 'tarjetas', 'cifras', 'columnas', 'pasos', 'panel', 'nota', 'cita', 'centro', 'indice', 'hueco'] as const
export const LAYOUTS = ['portada', 'normal', 'seccion', 'cita', 'cierre', 'dos-columnas', 'cifras', 'imagen'] as const
export const LAYOUT_ALIAS: Record<string, string> = {
  sección: 'seccion',
  section: 'seccion',
  cover: 'portada',
  title: 'portada',
  closing: 'cierre',
  fin: 'cierre',
  quote: 'cita',
  columnas: 'dos-columnas',
  'two-columns': 'dos-columnas',
  stats: 'cifras',
  image: 'imagen'
}
