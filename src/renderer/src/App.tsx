import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Columns2,
  Copy,
  FileDown,
  FilePlus2,
  FileText,
  FolderOpen,
  History,
  Moon,
  PanelLeft,
  PanelRight,
  Presentation,
  Sun,
  X
} from 'lucide-react'
import { changedLines } from '@shared/diff'
import { kindOf, setIndex, splitFront, titleOf, wordCount } from '@shared/doc'
import { blockText, insertAfter, mergeWithPrevious, replaceBlock, setBlockStyle, splitBlock, type BlockRef, type BlockStyle } from '@shared/visual'
import { DEFAULT_SETTINGS, type AppInfo, type DocChange, type OpenDoc, type RecentDoc, type RenderResult, type Settings } from '@shared/types'
import Editor from './components/Editor'
import Preview, { type VisualMsg } from './components/Preview'
import FormatBar from './components/FormatBar'
import HistoryPanel from './components/HistoryPanel'
import logo from './brand/buho.png'

/** Búho Docs: pestañas de documentos, editor + vista previa, cambios de la IA en directo, historial. */

interface Tab {
  path: string
  name: string
  content: string
  /** Lo último guardado en disco (lo que ve la IA). */
  saved: string
}

type Panel = 'history' | 'warnings' | 'agents' | null

const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
let nonce = 0

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentDoc[]>([])
  const [render, setRender] = useState<RenderResult | null>(null)
  const [edFlash, setEdFlash] = useState<{ lines: number[]; nonce: number } | null>(null)
  const [pvFlash, setPvFlash] = useState<{ lines: number[]; reveal: boolean; nonce: number } | null>(null)
  const [jump, setJump] = useState<{ line: number; word?: string; select?: boolean; nonce: number } | null>(null)
  const [follow, setFollow] = useState<number | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [histRefresh, setHistRefresh] = useState(0)
  const [toast, setToast] = useState<{ msg: string; ai?: boolean; action?: { label: string; run: () => void } } | null>(null)
  const [conflict, setConflict] = useState<DocChange | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [lastAi, setLastAi] = useState<{ author: string; at: number; writing?: boolean } | null>(null)
  // Edición visual (sobre la página): bloque con el cursor, cursor tras partir/unir, órdenes de formato.
  const [block, setBlock] = useState<BlockRef | null>(null)
  const [pvFocus, setPvFocus] = useState<{ line: number; offset: number; nonce: number } | null>(null)
  const [pvCmd, setPvCmd] = useState<{ name: string; value?: string; nonce: number } | null>(null)
  const [, setUndoTick] = useState(0)
  const undo = useRef(new Map<string, { u: string[]; r: string[]; key: string; at: number }>())

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(active)
  activeRef.current = active
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tab = tabs.find((t) => t.path === active) ?? null

  const say = useCallback((msg: string, opts: { ai?: boolean; action?: { label: string; run: () => void }; ms?: number } = {}) => {
    setToast({ msg, ai: opts.ai, action: opts.action })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), opts.ms ?? 4200)
  }, [])

  const patchTab = (path: string, patch: Partial<Tab>): void => setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, ...patch } : t)))

  const addTab = useCallback((d: OpenDoc, focus = true): void => {
    setTabs((ts) => (ts.some((t) => t.path.toLowerCase() === d.path.toLowerCase()) ? ts : [...ts, { path: d.path, name: d.name, content: d.content, saved: d.content }]))
    if (focus) setActive(d.path)
  }, [])

  // ─── Guardar ──────────────────────────────────────────────────────────────────────────────

  const saveNow = useCallback(async (path: string): Promise<void> => {
    const t = timers.current.get(path)
    if (t) clearTimeout(t)
    timers.current.delete(path)
    const tb = tabsRef.current.find((x) => x.path === path)
    if (!tb || tb.content === tb.saved) return
    const content = tb.content
    setSaving(true)
    const r = await window.buho.save(path, content)
    setSaving(false)
    if (!r.ok) {
      say(`No se pudo guardar: ${r.error}`)
      return
    }
    // tabsRef puede estar desfasado: se marca guardado solo lo que se ha escrito de verdad.
    setTabs((ts) => ts.map((x) => (x.path === path ? { ...x, saved: content } : x)))
    tabsRef.current = tabsRef.current.map((x) => (x.path === path ? { ...x, saved: content } : x))
    setHistRefresh((n) => n + 1)
  }, [say])

  const onChange = useCallback(
    (content: string): void => {
      const path = activeRef.current
      if (!path) return
      tabsRef.current = tabsRef.current.map((x) => (x.path === path ? { ...x, content } : x))
      patchTab(path, { content })
      const old = timers.current.get(path)
      if (old) clearTimeout(old)
      if (settingsRef.current.autosave) timers.current.set(path, setTimeout(() => void saveNow(path), 700))
    },
    [saveNow]
  )

  // ─── Edición visual (como en Word) ───────────────────────────────────────────────────────

  /** Aplica un cambio hecho sobre la página; las rachas de escritura en un mismo bloque son un solo «deshacer». */
  const commitVisual = useCallback(
    (next: string, key: string): void => {
      const path = activeRef.current
      const tb = tabsRef.current.find((x) => x.path === path)
      if (!path || !tb || next === tb.content) return
      const h = undo.current.get(path) ?? { u: [], r: [], key: '', at: 0 }
      const now = Date.now()
      if (!(key && key === h.key && now - h.at < 1500)) h.u.push(tb.content)
      if (h.u.length > 300) h.u.shift()
      h.r = []
      h.key = key
      h.at = now
      undo.current.set(path, h)
      onChange(next)
      setUndoTick((x) => x + 1)
    },
    [onChange]
  )

  const undoRedo = useCallback(
    (dir: 'u' | 'r'): void => {
      const path = activeRef.current
      const tb = tabsRef.current.find((x) => x.path === path)
      const h = path ? undo.current.get(path) : undefined
      if (!tb || !h) return
      const from = dir === 'u' ? h.u : h.r
      const to = dir === 'u' ? h.r : h.u
      const prev = from.pop()
      if (prev === undefined) return
      to.push(tb.content)
      h.key = ''
      onChange(prev)
      setUndoTick((x) => x + 1)
    },
    [onChange]
  )

  const onVisual = useCallback(
    (m: VisualMsg): void => {
      const tb = tabsRef.current.find((x) => x.path === activeRef.current)
      if (!tb) return
      switch (m.type) {
        case 'edit':
          // Un cambio de formato es un paso propio de «deshacer»; lo que se teclea seguido, uno solo.
          commitVisual(replaceBlock(tb.content, m.ref, m.text), m.format ? '' : `e${m.ref.meta ?? m.ref.line}:${m.ref.cell ?? ''}`)
          break
        case 'split': {
          const r = splitBlock(tb.content, m.ref, m.before, m.after)
          commitVisual(r.src, '')
          setPvFocus({ line: r.focusLine, offset: 0, nonce: ++nonce })
          break
        }
        case 'merge': {
          const r = mergeWithPrevious(tb.content, m.ref, m.prev, m.text, m.prevText)
          commitVisual(r.src, '')
          setPvFocus({ line: r.focusLine, offset: r.offset, nonce: ++nonce })
          break
        }
        case 'focus':
          setBlock(m.ref)
          break
        case 'undo':
        case 'redo':
          undoRedo(m.type === 'undo' ? 'u' : 'r')
          break
        case 'key':
          if (m.key === 's') void saveNow(tb.path)
          else if (m.key === 'p') void doExportRef.current()
          break
        case 'caret':
          setFollowEditor(m.line + Math.random() / 1000)
          break
      }
    },
    [commitVisual, undoRedo, saveNow]
  )

  const [followEditor, setFollowEditor] = useState<number | null>(null)
  const doExportRef = useRef<() => Promise<void>>(async () => {})

  const applyStyle = (style: BlockStyle): void => {
    if (!tab || !block) return
    commitVisual(setBlockStyle(tab.content, block, style, blockText(tab.content, block)), '')
    setPvFocus({ line: block.line + (block.tag === 'li' && style !== 'ul' && style !== 'ol' ? 1 : 0), offset: 0, nonce: ++nonce })
  }
  const insertBlock = (md: string): void => {
    if (!tab) return
    const after = block && !block.meta ? block.end : tab.content.split(/\r?\n/).length
    const r = insertAfter(tab.content, after, md)
    commitVisual(r.src, '')
    setPvFocus({ line: r.line, offset: 0, nonce: ++nonce })
  }

  // ─── Cambios que llegan de fuera (IA, otros programas, versiones recuperadas) ───────────

  const applyChange = useCallback((c: DocChange, force = false): void => {
    const tb = tabsRef.current.find((t) => t.path.toLowerCase() === c.path.toLowerCase())
    if (!tb) {
      setTabs((ts) => [...ts, { path: c.path, name: c.path.split(/[\\/]/).pop()!, content: c.content, saved: c.content }])
      if (c.focus) setActive(c.path)
      setHistRefresh((n) => n + 1)
      return
    }
    if (!force && tb.content !== tb.saved && tb.content !== c.content) {
      setConflict(c)
      return
    }
    const lines = changedLines(tb.content, c.content)
    tabsRef.current = tabsRef.current.map((x) => (x.path === tb.path ? { ...x, content: c.content, saved: c.content } : x))
    patchTab(tb.path, { content: c.content, saved: c.content })
    if (c.focus && activeRef.current !== tb.path) setActive(tb.path)
    if (c.focus || activeRef.current === tb.path) {
      const n = ++nonce
      setEdFlash({ lines, nonce: n })
      setPvFlash({ lines: lines.map((l) => l + 1), reveal: c.kind !== 'user', nonce: n })
    }
    if (c.streaming) {
      // Escritura en directo: el texto va apareciendo; el aviso y el historial llegan al terminar.
      setLastAi({ author: c.author, at: Date.now(), writing: true })
      return
    }
    if (c.kind !== 'user') {
      say(`${c.author}: ${c.summary}`, { ai: c.kind === 'ai' })
      if (c.kind === 'ai') setLastAi({ author: c.author, at: Date.now() })
    }
    setHistRefresh((n) => n + 1)
  }, [say])

  // ─── Arranque y eventos del proceso principal ──────────────────────────────────────────

  useEffect(() => {
    void window.buho.getSettings().then((st) => {
      // Desde la 0.4 se escribe sobre la página (como en Word): se cambia una vez la vista guardada.
      if (!st.vistaPagina) {
        st = { ...st, view: 'preview', vistaPagina: true }
        void window.buho.saveSettings(st)
      }
      setSettings(st)
    })
    void window.buho.recent().then(setRecent)
    void window.buho.appInfo().then(setInfo)
    const offs = [
      window.buho.onOpen((d) => addTab(d)),
      window.buho.onDocChange((c) => applyChange(c)),
      window.buho.onShow((m) => {
        setActive(m.path)
        if (m.line) setJump({ line: m.line, nonce: ++nonce })
      }),
      window.buho.onFlush(async ({ id, path }) => {
        await saveNow(path)
        window.buho.flushed(id)
      })
    ]
    return () => offs.forEach((o) => o())
  }, [addTab, applyChange, saveNow])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    const dark = settings.theme === 'dark'
    void window.buho.setOverlay(dark ? '#0d1626' : '#ffffff', dark ? '#d6e2f0' : '#0a1f3a')
  }, [settings.theme])

  useEffect(() => {
    setRender(null)
    setConflict(null)
  }, [active])

  const updateSettings = (patch: Partial<Settings>): void => {
    const s = { ...settings, ...patch }
    setSettings(s)
    void window.buho.saveSettings(s)
  }

  // ─── Acciones ────────────────────────────────────────────────────────────────────────────

  const openDialog = async (): Promise<void> => {
    const d = await window.buho.openDialog()
    if (d) addTab(d)
  }
  const create = async (kind: 'documento' | 'presentacion', estilo = 'blanco'): Promise<void> => {
    const d = await window.buho.create(kind, estilo)
    if (d) addTab(d)
  }
  const openRecent = async (path: string): Promise<void> => {
    try {
      addTab(await window.buho.open(path))
    } catch (e) {
      say((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const closeTab = async (path: string): Promise<void> => {
    await saveNow(path)
    await window.buho.close(path)
    const rest = tabsRef.current.filter((t) => t.path !== path)
    setTabs(rest)
    if (active === path) setActive(rest[rest.length - 1]?.path ?? null)
    if (!rest.length) void window.buho.recent().then(setRecent)
  }
  doExportRef.current = () => doExport()
  const doExport = async (choose = false): Promise<void> => {
    if (!tab) return
    await saveNow(tab.path)
    setExporting(true)
    const r = await window.buho.exportPdf(tab.path, choose)
    setExporting(false)
    if (r.ok && r.file) {
      const file = r.file
      say(`PDF listo: ${r.pages} ${kindOf(splitFront(tab.content).meta) === 'presentacion' ? 'diapositivas' : 'páginas'} · ${file.split(/[\\/]/).pop()}`, { action: { label: 'Abrir', run: () => void window.buho.openExternal(file) }, ms: 8000 })
    } else if (r.error) say(`No se pudo exportar: ${r.error}`, { ms: 8000 })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'o') {
        e.preventDefault()
        void openDialog()
      } else if (k === 'n') {
        e.preventDefault()
        void create(e.shiftKey ? 'presentacion' : 'documento')
      } else if (k === 'p' || (k === 'e' && e.shiftKey)) {
        e.preventDefault()
        void doExport()
      } else if (k === 'h' && e.shiftKey) {
        e.preventDefault()
        setPanel((x) => (x === 'history' ? null : 'history'))
      } else if (k === 'w' && activeRef.current) {
        e.preventDefault()
        void closeTab(activeRef.current)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  // ─── Pintar ──────────────────────────────────────────────────────────────────────────────

  const kind = tab ? kindOf(splitFront(tab.content).meta) : 'documento'
  const view = settings.view
  const dirty = tab ? tab.content !== tab.saved : false
  const errors = render?.warnings.filter((w) => w.level === 'error').length ?? 0

  return (
    <div className="app">
      <header className="titlebar">
        <img src={logo} className="logo" alt="" />
        <span className="appname">Búho Docs</span>
        <nav className="tabs">
          {tabs.map((t) => {
            const k = kindOf(splitFront(t.content).meta)
            return (
              <div key={t.path} className={`tab ${t.path === active ? 'on' : ''}`} onClick={() => setActive(t.path)} title={t.path} onAuxClick={(e) => e.button === 1 && void closeTab(t.path)}>
                {k === 'presentacion' ? <Presentation size={14} /> : <FileText size={14} />}
                <span>{titleOf(t.content, t.name)}</span>
                {t.content !== t.saved && <i className="dot" />}
                <button
                  className="x"
                  onClick={(e) => {
                    e.stopPropagation()
                    void closeTab(t.path)
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
          <button className="icon newtab" title="Abrir (Ctrl+O)" onClick={() => void openDialog()}>
            <FolderOpen size={15} />
          </button>
        </nav>
        <div className="tools">
          {tab && (
            <>
              <div className="seg" title="Vista">
                <button className={view === 'editor' ? 'on' : ''} onClick={() => updateSettings({ view: 'editor' })} title="Solo Markdown">
                  <PanelLeft size={15} />
                </button>
                <button className={view === 'split' ? 'on' : ''} onClick={() => updateSettings({ view: 'split' })} title="Página y Markdown">
                  <Columns2 size={15} />
                </button>
                <button className={view === 'preview' ? 'on' : ''} onClick={() => updateSettings({ view: 'preview' })} title="Solo la página (escribir como en Word)">
                  <PanelRight size={15} />
                </button>
              </div>
              <button className={`icon ${panel === 'history' ? 'on' : ''}`} title="Historial (Ctrl+Shift+H)" onClick={() => setPanel(panel === 'history' ? null : 'history')}>
                <History size={16} />
              </button>
              <button className="btn primary" onClick={() => void doExport()} disabled={exporting} title="Exportar a PDF junto al documento (Ctrl+P). Clic derecho: elegir dónde" onContextMenu={() => void doExport(true)}>
                <FileDown size={15} /> {exporting ? 'Exportando…' : 'PDF'}
              </button>
            </>
          )}
          <button className={`icon ${panel === 'agents' ? 'on' : ''}`} title="Agentes de IA: CLI y skill" onClick={() => setPanel(panel === 'agents' ? null : 'agents')}>
            <Bot size={16} />
          </button>
          <button className="icon" title="Tema claro / oscuro" onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>
            {settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {tab && view !== 'editor' && (
        <FormatBar
          block={block}
          kind={kind}
          canUndo={!!undo.current.get(tab.path)?.u.length}
          canRedo={!!undo.current.get(tab.path)?.r.length}
          hasIndex={/^:{3,}\s*indice\b/m.test(tab.content)}
          onInline={(name, value) => setPvCmd({ name, value, nonce: ++nonce })}
          onStyle={applyStyle}
          onInsert={(md) => insertBlock(md)}
          onIndex={() => commitVisual(setIndex(tab.content, !/^:{3,}\s*indice\b/m.test(tab.content)), '')}
          onUndo={() => undoRedo('u')}
          onRedo={() => undoRedo('r')}
        />
      )}
      <main className={`work v-${tab ? view : 'home'}`}>
        {!tab ? (
          <Home recent={recent} onCreate={create} onOpen={openDialog} onRecent={openRecent} />
        ) : (
          <>
            {view !== 'preview' && (
              <section className="pane edit">
                {conflict && conflict.path === tab.path && (
                  <div className="conflict">
                    <AlertTriangle size={15} /> <b>{conflict.author}</b> ha cambiado el archivo mientras escribías.
                    <button
                      className="btn small"
                      onClick={() => {
                        applyChange(conflict, true)
                        setConflict(null)
                      }}
                    >
                      Ver su versión
                    </button>
                    <button
                      className="btn small"
                      onClick={() => {
                        setConflict(null)
                        void saveNow(tab.path)
                      }}
                    >
                      Mantener la mía
                    </button>
                  </div>
                )}
                <Editor
                  path={tab.path}
                  content={tab.content}
                  fontSize={settings.fontSize}
                  spellcheck={settings.spellcheck}
                  flash={edFlash}
                  jump={jump}
                  onChange={onChange}
                  onSave={() => void saveNow(tab.path)}
                  onCursorLine={(l) => setFollow(l)}
                  followLine={followEditor}
                />
              </section>
            )}
            {view !== 'editor' && (
              <section className="pane view">
                <Preview
                  source={tab.content}
                  baseDir={dirOf(tab.path)}
                  flash={pvFlash}
                  follow={view === 'split' ? follow : null}
                  editable
                  focus={pvFocus}
                  cmd={pvCmd}
                  onVisual={onVisual}
                  onRendered={setRender}
                  onPick={(m) => {
                    // En la vista de solo página no hay Markdown al que saltar.
                    if (view !== 'preview') setJump({ line: m.line, word: m.word, select: m.double, nonce: ++nonce })
                  }}
                />
              </section>
            )}
          </>
        )}
        {panel === 'history' && tab && <HistoryPanel path={tab.path} refresh={histRefresh} onClose={() => setPanel(null)} onJump={(line) => setJump({ line, nonce: ++nonce })} toast={say} />}
        {panel === 'warnings' && render && (
          <aside className="side">
            <header>
              <AlertTriangle size={16} /> <b>Avisos</b>
              <button className="icon" onClick={() => setPanel(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="warns">
              {render.warnings.length === 0 && <p className="muted">Todo en orden.</p>}
              {render.warnings.map((w, i) => (
                <div key={i} className={`warn w-${w.level}`} onClick={() => w.line && setJump({ line: w.line, nonce: ++nonce })}>
                  {w.slide ? <b>Diap. {w.slide}</b> : w.line ? <b>Línea {w.line}</b> : null} {w.message}
                </div>
              ))}
            </div>
          </aside>
        )}
        {panel === 'agents' && <AgentsPanel info={info} path={tab?.path} onClose={() => setPanel(null)} say={say} />}
      </main>

      <footer className="status">
        {tab ? (
          <>
            <span className="pill">{kind === 'presentacion' ? 'Presentación 16:9' : 'Documento A4'}</span>
            {render && <span>{render.pages} {kind === 'presentacion' ? (render.pages === 1 ? 'diapositiva' : 'diapositivas') : render.pages === 1 ? 'página' : 'páginas'}</span>}
            <span>{wordCount(tab.content).toLocaleString('es-ES')} palabras</span>
            {render && render.warnings.length > 0 && (
              <button className={`stat-warn ${errors ? 'err' : ''}`} onClick={() => setPanel(panel === 'warnings' ? null : 'warnings')}>
                <AlertTriangle size={13} /> {render.warnings.length} {render.warnings.length === 1 ? 'aviso' : 'avisos'}
              </button>
            )}
            <span className="grow" />
            {lastAi && Date.now() - lastAi.at < 10 * 60 * 1000 && (
              <span className="ai-badge">
                <Bot size={13} /> {lastAi.writing ? `${lastAi.author} está escribiendo…` : `${lastAi.author} ha editado a las ${new Date(lastAi.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`}
              </span>
            )}
            <span className="muted">{saving ? 'Guardando…' : dirty ? (settings.autosave ? 'Escribiendo…' : 'Sin guardar (Ctrl+S)') : 'Guardado'}</span>
            <span className="muted path" title={tab.path} onClick={() => void window.buho.showInFolder(tab.path)}>
              {tab.path}
            </span>
          </>
        ) : (
          <span className="muted">Búho Docs {info?.version} · Buho Corps Systems</span>
        )}
      </footer>

      {toast && (
        <div className={`toast ${toast.ai ? 'ai' : ''}`}>
          {toast.ai && <Bot size={15} />}
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              className="btn small"
              onClick={() => {
                toast.action!.run()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Home(p: { recent: RecentDoc[]; onCreate(k: 'documento' | 'presentacion', estilo: string): void; onOpen(): void; onRecent(path: string): void }): React.JSX.Element {
  return (
    <div className="home">
      <div className="hero">
        <img src={logo} alt="" />
        <div>
          <h1>Búho Docs</h1>
          <p>Documentos A4 y presentaciones 16:9. Escribe directamente sobre la página como en Word; la IA escribe por comandos y lo ves todo en directo.</p>
        </div>
      </div>
      <div className="cards">
        <button className="card" onClick={() => p.onCreate('documento', 'blanco')}>
          <FileText size={28} />
          <b>Documento en blanco</b>
          <span>A4 sin marca, como Word · Ctrl+N</span>
        </button>
        <button className="card card-buho" onClick={() => p.onCreate('documento', 'buho')}>
          <FileText size={28} />
          <b>Documento Búho</b>
          <span>A4 con portada y estilo Búho</span>
        </button>
        <button className="card" onClick={() => p.onCreate('presentacion', 'blanco')}>
          <Presentation size={28} />
          <b>Presentación en blanco</b>
          <span>Diapositivas 16:9 sin marca · Ctrl+Shift+N</span>
        </button>
        <button className="card card-buho" onClick={() => p.onCreate('presentacion', 'buho')}>
          <Presentation size={28} />
          <b>Presentación Búho</b>
          <span>Diapositivas 16:9 con estilo Búho</span>
        </button>
        <button className="card" onClick={p.onOpen}>
          <FolderOpen size={28} />
          <b>Abrir</b>
          <span>Un .md del disco · Ctrl+O</span>
        </button>
      </div>
      {p.recent.length > 0 && (
        <div className="recent">
          <h2>Recientes</h2>
          {p.recent.map((r) => (
            <button key={r.path} className={`ritem ${r.exists ? '' : 'gone'}`} onClick={() => r.exists && p.onRecent(r.path)} title={r.path}>
              {r.kind === 'presentacion' ? <Presentation size={16} /> : <FileText size={16} />}
              <b>{r.title}</b>
              <span className="muted">{r.path}</span>
            </button>
          ))}
        </div>
      )}
      <div className="agent-hint">
        <Bot size={16} /> Pídeselo a tu IA: «créame con Búho Docs un documento sobre…». Tiene el comando <code>buho-docs</code> y su guía (<code>buho-docs skill</code>).
      </div>
    </div>
  )
}

function AgentsPanel(p: { info: AppInfo | null; path?: string; onClose(): void; say(m: string): void }): React.JSX.Element {
  const doc = p.path ? `"${p.path}"` : 'documento.md'
  const cmds = [
    `buho-docs outline ${doc}`,
    `buho-docs section ${doc} "Ventas" --file nuevo.md --author Claude`,
    `buho-docs replace ${doc} "erata" "errata" --author Claude`,
    `buho-docs export ${doc}`,
    'buho-docs skill'
  ]
  return (
    <aside className="side">
      <header>
        <Bot size={16} /> <b>Agentes de IA</b>
        <button className="icon" onClick={p.onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="agents">
        <p>Cualquier agente con terminal (Claude, Codex, Copilot, Gemini…) maneja Búho Docs con el comando <code>buho-docs</code>. Sus cambios se ven aquí en directo y quedan firmados en el historial.</p>
        {cmds.map((c) => (
          <div key={c} className="cmd" onClick={() => void window.buho.copy(c).then(() => p.say('Copiado'))}>
            <code>{c}</code>
            <Copy size={13} />
          </div>
        ))}
        {p.info && (
          <>
            <h3>CLI</h3>
            <p className="muted small">{p.info.cli}</p>
            <h3>Skill instalada en</h3>
            {p.info.agentSkills.length ? (
              p.info.agentSkills.map((s) => (
                <p key={s.path} className="small">
                  <b>{s.agent}</b> · {s.status}
                  <br />
                  <span className="muted">{s.path}</span>
                </p>
              ))
            ) : (
              <p className="muted small">{p.info.packaged ? 'Ningún agente detectado (Claude Code, Codex, Copilot).' : 'En desarrollo no se instala.'}</p>
            )}
          </>
        )}
        <p className="small">
          <FilePlus2 size={13} /> Si el agente edita el archivo con sus propias herramientas, que firme antes: <code>buho-docs tag {doc} --author Claude</code>
        </p>
      </div>
    </aside>
  )
}
