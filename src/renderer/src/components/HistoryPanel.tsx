import { useEffect, useState } from 'react'
import { Bot, FileClock, History, RotateCcw, User, X } from 'lucide-react'
import { diffLines, hunks, type Hunk } from '@shared/diff'
import type { HistoryItem } from '@shared/types'

/** Historial del documento: quién cambió qué (tú, la IA u otro programa) y vuelta atrás. */
interface Props {
  path: string
  refresh: number
  onClose(): void
  onJump(line: number): void
  toast(msg: string): void
}

const when = (t: number): string => {
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function HistoryPanel(p: Props): React.JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [diff, setDiff] = useState<Hunk[] | null>(null)

  useEffect(() => {
    void window.buho.history(p.path).then(setItems)
  }, [p.path, p.refresh])

  useEffect(() => {
    setDiff(null)
    if (!sel) return
    void (async () => {
      const [e, before] = await Promise.all([window.buho.historyEntry(p.path, sel), window.buho.historyBefore(p.path, sel)])
      if (e) setDiff(hunks(diffLines(before ?? '', e.content), 2))
    })()
  }, [sel, p.path, p.refresh])

  const restore = async (id: string): Promise<void> => {
    const r = await window.buho.restore(p.path, id)
    p.toast(r.ok ? 'Versión recuperada (queda en el historial: puedes deshacerlo)' : `No se pudo: ${r.error}`)
  }

  return (
    <aside className="side">
      <header>
        <History size={16} /> <b>Historial</b>
        <span className="muted">{items.length} cambios</span>
        <button className="icon" onClick={p.onClose} title="Cerrar">
          <X size={16} />
        </button>
      </header>
      <div className="hist">
        {items.map((h, i) => (
          <div key={h.id} className={`hitem k-${h.kind} ${sel === h.id ? 'sel' : ''}`} onClick={() => setSel(sel === h.id ? null : h.id)}>
            <div className="hrow">
              <span className="who">
                {h.kind === 'user' ? <User size={13} /> : h.kind === 'ai' ? <Bot size={13} /> : <FileClock size={13} />}
                {h.kind === 'ai' ? h.author : h.kind === 'user' ? 'Tú' : h.author}
              </span>
              <span className="muted">{when(h.at)}</span>
            </div>
            <div className="hsum">{h.summary}</div>
            <div className="hstat">
              {h.added ? <span className="plus">+{h.added}</span> : null}
              {h.removed ? <span className="minus">−{h.removed}</span> : null}
              {i === 0 ? <span className="tag">actual</span> : null}
            </div>
            {sel === h.id && (
              <div className="hdetail" onClick={(e) => e.stopPropagation()}>
                {diff === null ? (
                  <div className="muted">Cargando…</div>
                ) : diff.length === 0 ? (
                  <div className="muted">Versión de partida</div>
                ) : (
                  diff.slice(0, 30).map((hk, k) => (
                    <div key={k} className="hunk" onClick={() => p.onJump(hk.bLine)}>
                      {hk.ops.map((o, j) => (
                        <div key={j} className={`dl d-${o.t === '+' ? 'add' : o.t === '-' ? 'del' : 'eq'}`}>
                          {o.text || ' '}
                        </div>
                      ))}
                    </div>
                  ))
                )}
                {i > 0 && (
                  <button className="btn small" onClick={() => void restore(h.id)}>
                    <RotateCcw size={13} /> Volver a esta versión
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
