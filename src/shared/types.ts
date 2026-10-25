/** Tipos compartidos entre el proceso principal, el preload, la app y la vista previa. */

export type DocKind = 'documento' | 'presentacion'

/** Quién hizo un cambio: tú en la app, una IA (por la API/CLI o firmado con `tag`) u otro programa. */
export type ChangeKind = 'user' | 'ai' | 'external'

export interface HistoryEntry {
  id: string
  at: number
  kind: ChangeKind
  author: string
  /** Qué se hizo, en una línea («Sección "Ventas" reescrita», «Errata corregida»…). */
  summary: string
  added: number
  removed: number
  /** Contenido completo después del cambio (los documentos son texto: caben enteros). */
  content: string
}

/** Resumen de una entrada de historial sin el contenido (para listas y para el CLI). */
export type HistoryItem = Omit<HistoryEntry, 'content'>

export interface OpenDoc {
  path: string
  name: string
  kind: DocKind
  title: string
  content: string
}

export interface RecentDoc {
  path: string
  name: string
  kind: DocKind
  title: string
  at: number
  exists: boolean
}

/** Un cambio que llega a la app: de la IA, de otro programa o una versión restaurada. */
export interface DocChange {
  path: string
  content: string
  kind: ChangeKind
  author: string
  summary: string
  /** El cambio lo ha pedido un agente: la app lo enseña aunque no sea el documento activo. */
  focus: boolean
  /** Trozo de una escritura en directo (aún no está en disco ni en el historial). */
  streaming?: boolean
}

export interface Settings {
  theme: 'light' | 'dark'
  /** Guardar solo al dejar de escribir (como Google Docs). */
  autosave: boolean
  /** editor | split | preview */
  view: 'editor' | 'split' | 'preview'
  /** Tamaño de letra del editor. */
  fontSize: number
  spellcheck: boolean
  /** Ya se ha pasado a la vista de página (0.4): solo una vez, luego manda lo que elija la persona. */
  vistaPagina?: boolean
}

export const DEFAULT_SETTINGS: Settings = { theme: 'light', autosave: true, view: 'preview', fontSize: 14, spellcheck: true, vistaPagina: true }

/** Lo que devuelve la vista previa al terminar de pintar. */
export interface RenderResult {
  kind: DocKind
  /** Páginas A4 o diapositivas. */
  pages: number
  warnings: RenderWarning[]
  ms: number
  /** Desglose del tiempo de pintado (ms). */
  timings?: Record<string, number>
}

export interface RenderWarning {
  /** Línea del Markdown (1 = primera) donde está el problema, si se sabe. */
  line?: number
  /** Diapositiva (1 = primera), en presentaciones. */
  slide?: number
  level: 'aviso' | 'error'
  message: string
}

export interface AppInfo {
  version: string
  packaged: boolean
  portable: boolean
  cli: string
  agentSkills: { agent: string; path: string; status: string }[]
}

export interface BuhoDocsApi {
  appInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<Settings>
  setOverlay(color: string, symbolColor: string): Promise<void>
  recent(): Promise<RecentDoc[]>
  openDialog(): Promise<OpenDoc | null>
  open(path: string): Promise<OpenDoc>
  /** Documento nuevo: estilo buho (marca Búho AI) o blanco (sin marca). */
  create(kind: DocKind, estilo?: string): Promise<OpenDoc | null>
  bloques(): Promise<{ carpeta: string; bloques: { id: string; label: string; md: string; propio?: boolean }[] }>
  tema(id: string): Promise<import('./temas').Tema>
  temas(): Promise<import('./temas').Tema[]>
  crearTema(n: { id: string; nombre?: string; principal: string; acento: string; logo?: string; marca?: string; portada?: 'simple' | 'ninguna'; base?: 'buho' | 'blanco' }): Promise<{ ok: boolean; tema?: import('./temas').Tema; error?: string }>
  elegirLogo(): Promise<string | null>
  plantillas(): Promise<{ carpeta: string; plantillas: { id: string; nombre: string; tipo: string; descripcion: string; propia?: boolean }[] }>
  crearDesdePlantilla(id: string, tema: string): Promise<OpenDoc | null>
  close(path: string): Promise<void>
  /** Guarda lo escrito en la app (queda en el historial como tuyo). */
  save(path: string, content: string): Promise<{ ok: boolean; error?: string }>
  exportPdf(path: string, choose: boolean): Promise<{ ok: boolean; file?: string; pages?: number; error?: string }>
  history(path: string): Promise<HistoryItem[]>
  historyEntry(path: string, id: string): Promise<HistoryEntry | null>
  /** Contenido justo antes de una entrada (para enseñar qué cambió). */
  historyBefore(path: string, id: string): Promise<string | null>
  restore(path: string, id: string): Promise<{ ok: boolean; error?: string }>
  showInFolder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  /** Copia el texto al portapapeles. */
  copy(text: string): Promise<void>
  /** Responde a una petición de guardar lo pendiente antes de que escriba la IA. */
  flushed(id: string): void
  onDocChange(cb: (c: DocChange) => void): () => void
  onOpen(cb: (d: OpenDoc) => void): () => void
  onShow(cb: (m: { path: string; line?: number }) => void): () => void
  onFlush(cb: (m: { id: string; path: string }) => void): () => void
}
