import { useEffect, useRef, useState } from 'react'
import { Bot, Check, CheckCheck, MessageSquarePlus, MessagesSquare, Send, Trash2, User, X } from 'lucide-react'
import type { Comentario, Propuesta, Trozo } from '@shared/propuestas'

/**
 * Revisión: lo que le pides a la IA y lo que te propone.
 *  1. Clic en la página (con «Comentar» activado) → escribes «quita esto», «mete algo así»…
 *  2. «Enviar a la IA»: un agente por bloque comentado, todos a la vez.
 *  3. Cada cambio llega como propuesta: aceptar o rechazar (uno a uno o todos).
 */
export interface RevComentario extends Comentario {
  ahora: number | null
  bloque: { id: string; line: number; seccion: string } | null
}
export interface RevPropuesta extends Propuesta {
  trozos: (Trozo & { ahora: number | null })[]
}
export interface RevEstado {
  modo: boolean
  propuestas: RevPropuesta[]
  comentarios: RevComentario[]
}

interface Props {
  path: string
  estado: RevEstado | null
  /** Clic en la página con «Comentar»: el borrador del comentario. */
  draft: { line: number; cita: string; seleccion?: string; nonce: number } | null
  comentando: boolean
  enviando: boolean
  onComentando(on: boolean): void
  onEnviar(): void
  onClose(): void
  onJump(line: number): void
  toast(msg: string): void
}

/** Texto para enseñar: sin la sintaxis de Markdown ni los {atributos}. */
const limpio = (s: string): string => s.replace(/\s*\{[^}]*\}\s*$/gm, '').replace(/^\s*(#{1,6}|>|[-*+]|\d+\.|:::.*)\s*/gm, '').replace(/[*_`~]/g, '').trim()
const corto = (s: string, n = 90): string => {
  const t = limpio(s)
  return t.length > n ? t.slice(0, n) + '…' : t
}

export default function RevisionPanel(p: Props): React.JSX.Element {
  const [texto, setTexto] = useState('')
  const [draft, setDraft] = useState<Props['draft']>(null)
  const [verResueltos, setVerResueltos] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const e = p.estado
  const abiertos = e?.comentarios.filter((c) => c.estado === 'abierto') ?? []
  const resueltos = e?.comentarios.filter((c) => c.estado === 'resuelto') ?? []
  const conPropuesta = new Set(e?.propuestas.flatMap((x) => (x.comentario ?? '').split(',')) ?? [])
  const sinEnviar = abiertos.filter((c) => !conPropuesta.has(c.id) && !c.respuestas.length)

  useEffect(() => {
    if (!p.draft) return
    setDraft(p.draft)
    setTexto('')
    setTimeout(() => area.current?.focus(), 30)
  }, [p.draft?.nonce])

  const call = (m: string, params: Record<string, unknown> = {}): Promise<{ ok?: boolean; error?: string; message?: string; fallidos?: number }> => window.buho.revision(m, { path: p.path, ...params })

  const guardar = async (): Promise<void> => {
    if (!draft || !texto.trim()) return
    const r = await call('comentar', { texto: texto.trim(), cita: draft.cita, seleccion: draft.seleccion, linea: draft.line, author: 'Tú' })
    if (r.error) return p.toast(`No se pudo comentar: ${r.error}`)
    setDraft(null)
    setTexto('')
  }
  const aceptar = async (id: string): Promise<void> => {
    const r = await call('aceptar', id === 'todas' ? { todas: true } : { id })
    if (r.error) p.toast(`No se pudo aceptar: ${r.error}`)
    else if (r.fallidos) p.toast(r.message ?? 'Algún cambio ya no encajaba')
  }
  const rechazar = async (id: string): Promise<void> => {
    const r = await call('rechazar', id === 'todas' ? { todas: true } : { id })
    if (r.error) p.toast(`No se pudo rechazar: ${r.error}`)
  }

  return (
    <aside className="side rev">
      <header>
        <MessagesSquare size={16} /> <b>Revisión</b>
        <span className="muted">
          {abiertos.length} comentario{abiertos.length === 1 ? '' : 's'} · {e?.propuestas.length ?? 0} propuesta{e?.propuestas.length === 1 ? '' : 's'}
        </span>
        <button className="icon" onClick={p.onClose} title="Cerrar">
          <X size={16} />
        </button>
      </header>

      <div className="rev-body">
        <div className="rev-actions">
          <button className={`btn small ${p.comentando ? 'primary' : ''}`} onClick={() => p.onComentando(!p.comentando)} title="Haz clic en cualquier parte de la página (o selecciona un trozo) para comentarlo">
            <MessageSquarePlus size={14} /> {p.comentando ? 'Comentando: clic en la página' : 'Comentar'}
          </button>
          <label className="rev-modo" title="Con el modo revisión, cualquier cambio que haga un agente llega aquí como propuesta en vez de escribirse">
            <input type="checkbox" checked={!!e?.modo} onChange={(ev) => void call('revision', { modo: ev.target.checked ? 'si' : 'no' })} /> Modo revisión
          </label>
        </div>

        {draft && (
          <div className="rev-draft">
            <div className="rev-cita">«{corto(draft.seleccion || draft.cita, 160)}»</div>
            <textarea
              ref={area}
              value={texto}
              placeholder="¿Qué cambiarías aquí? (quita esto, añade…, más corto…)  ·  Enter para añadir"
              onChange={(ev) => setTexto(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                  ev.preventDefault()
                  void guardar()
                } else if (ev.key === 'Escape') setDraft(null)
              }}
            />
            <div className="rev-row">
              <button className="btn small primary" onClick={() => void guardar()} disabled={!texto.trim()}>
                Añadir
              </button>
              <button className="btn small" onClick={() => setDraft(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {abiertos.length > 0 && (
          <section>
            <h4>Lo que pides</h4>
            {abiertos.map((c) => (
              <div key={c.id} className={`rev-com ${conPropuesta.has(c.id) ? 'con-prop' : ''}`} onClick={() => c.ahora && p.onJump(c.ahora)}>
                <div className="rev-cita">«{corto(c.seleccion || c.cita)}»</div>
                <div className="rev-texto">
                  <User size={12} /> {c.texto}
                </div>
                {c.respuestas.map((r, i) => (
                  <div key={i} className="rev-resp">
                    <Bot size={12} /> {r.texto}
                  </div>
                ))}
                {c.ahora === null && <div className="rev-warn">Ya no encuentro ese texto</div>}
                <div className="rev-row" onClick={(ev) => ev.stopPropagation()}>
                  <button className="link" onClick={() => void call('resolver', { id: c.id })} title="Marcar como hecho">
                    <Check size={12} /> Hecho
                  </button>
                  <button className="link" onClick={() => void call('resolver', { id: c.id, borrar: true })} title="Borrar el comentario">
                    <Trash2 size={12} /> Borrar
                  </button>
                </div>
              </div>
            ))}
            <button className="btn primary rev-enviar" disabled={p.enviando || !sinEnviar.length} onClick={p.onEnviar} title="Un agente por cada parte comentada, todos a la vez; los cambios llegan como propuestas">
              <Send size={14} /> {p.enviando ? 'La IA está trabajando…' : sinEnviar.length ? `Enviar ${sinEnviar.length} a la IA` : 'Todo enviado'}
            </button>
          </section>
        )}

        {!!e?.propuestas.length && (
          <section>
            <h4>
              Propuestas
              <span className="rev-all">
                <button className="link" onClick={() => void aceptar('todas')}>
                  <CheckCheck size={12} /> Aceptar todas
                </button>
                <button className="link" onClick={() => void rechazar('todas')}>
                  <X size={12} /> Rechazar todas
                </button>
              </span>
            </h4>
            {e.propuestas.map((pr) => (
              <div key={pr.id} className="rev-prop">
                <div className="who">
                  <Bot size={13} /> {pr.autor}
                </div>
                <div className="muted rev-sum">{pr.resumen}</div>
                {pr.trozos.map((t, k) => (
                  <div key={k} className={`hunk ${t.ahora === null ? 'stale' : ''}`} onClick={() => t.ahora && p.onJump(t.ahora)}>
                    {t.antes.map((l, j) => (
                      <div key={'a' + j} className="dl d-del">
                        {l || ' '}
                      </div>
                    ))}
                    {t.despues.map((l, j) => (
                      <div key={'d' + j} className="dl d-add">
                        {l || ' '}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="rev-row">
                  <button className="btn small primary" onClick={() => void aceptar(pr.id)}>
                    <Check size={13} /> Aceptar
                  </button>
                  <button className="btn small" onClick={() => void rechazar(pr.id)}>
                    <X size={13} /> Rechazar
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {!abiertos.length && !e?.propuestas.length && !draft && (
          <div className="rev-vacio">
            <p>
              <b>Revisa como con un compañero:</b> activa <i>Comentar</i>, haz clic en cualquier parte de la página (o selecciona un trozo) y escribe qué cambiarías.
            </p>
            <p>Cuando tengas todo, «Enviar a la IA»: un agente por cada parte, a la vez, y aquí te llegan los cambios para aceptarlos o no.</p>
          </div>
        )}

        {resueltos.length > 0 && (
          <section>
            <button className="link" onClick={() => setVerResueltos(!verResueltos)}>
              {verResueltos ? 'Ocultar' : 'Ver'} {resueltos.length} resuelto{resueltos.length === 1 ? '' : 's'}
            </button>
            {verResueltos &&
              resueltos.map((c) => (
                <div key={c.id} className="rev-com hecho">
                  <div className="rev-cita">«{corto(c.seleccion || c.cita, 60)}»</div>
                  <div className="rev-texto">{c.texto}</div>
                </div>
              ))}
          </section>
        )}
      </div>
    </aside>
  )
}
