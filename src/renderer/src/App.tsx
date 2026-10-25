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
import { kindOf, splitFront, titleOf, wordCount } from '@shared/doc'
import { DEFAULT_SETTINGS, type AppInfo, type DocChange, type OpenDoc, type RecentDoc, type RenderResult, type Settings } from '@shared/types'
import Editor from './components/Editor'
import Preview from './components/Preview'
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
    void window.buho.getSettings().then(setSettings)
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
  const create = async (kind: 'documento' | 'presentacion'): Promise<void> => {
    const d = await window.buho.create(kind)
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
                <button className={view === 'editor' ? 'on' : ''} onClick={() => updateSettings({ view: 'editor' })} title="Solo editor">
                  <PanelLeft size={15} />
                </button>
                <button className={view === 'split' ? 'on' : ''} onClick={() => updateSettings({ view: 'split' })} title="Editor y vista previa">
                  <Columns2 size={15} />
                </button>
                <button className={view === 'preview' ? 'on' : ''} onClick={() => updateSettings({ view: 'preview' })} title="Solo vista previa">
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
                  onRendered={setRender}
                  onPick={(m) => {
                    if (view === 'preview') updateSettings({ view: 'split' })
                    setJump({ line: m.line, word: m.word, select: m.double, nonce: ++nonce })
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

function Home(p: { recent: RecentDoc[]; onCreate(k: 'documento' | 'presentacion'): void; onOpen(): void; onRecent(path: string): void }): React.JSX.Element {
  return (
    <div className="home">
      <div className="hero">
        <img src={logo} alt="" />
        <div>
          <h1>Búho Docs</h1>
          <p>Documentos A4 y presentaciones 16:9 con el estilo Búho, escritos en Markdown. Tú corriges, la IA escribe, y lo ves todo en directo.</p>
        </div>
      </div>
      <div className="cards">
        <button className="card" onClick={() => p.onCreate('documento')}>
          <FileText size={28} />
          <b>Nuevo documento</b>
          <span>A4 con portada · Ctrl+N</span>
        </button>
        <button className="card" onClick={() => p.onCreate('presentacion')}>
          <Presentation size={28} />
          <b>Nueva presentación</b>
          <span>Diapositivas 16:9 · Ctrl+Shift+N</span>
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
