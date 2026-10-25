import { useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { Tema } from '@shared/temas'

/** Crear un tema: nombre, dos colores, logo y portada. Queda en <datos>/temas/<id> para siempre. */
interface Props {
  onClose(): void
  onCreated(t: Tema): void
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export default function TemaDialog(p: Props): React.JSX.Element {
  const [nombre, setNombre] = useState('')
  const [principal, setPrincipal] = useState('#1f3b63')
  const [acento, setAcento] = useState('#2f80ed')
  const [logo, setLogo] = useState<string | null>(null)
  const [marca, setMarca] = useState('')
  const [portada, setPortada] = useState<'simple' | 'ninguna'>('simple')
  const [error, setError] = useState('')

  const crear = async (): Promise<void> => {
    if (!nombre.trim()) return setError('Ponle un nombre')
    const r = await window.buho.crearTema({ id: slug(nombre), nombre: nombre.trim(), principal, acento, logo: logo ?? undefined, marca: marca.trim() || undefined, portada, base: 'blanco' })
    if (!r.ok || !r.tema) return setError(r.error ?? 'No se pudo crear')
    p.onCreated(r.tema)
  }

  return (
    <div className="modal-bg" onMouseDown={p.onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <b>Nuevo tema</b>
          <button className="icon" onClick={p.onClose}>
            <X size={16} />
          </button>
        </header>
        <label>
          Nombre
          <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cliente Acme" />
        </label>
        <div className="row2">
          <label>
            Color principal <span className="muted">(títulos, tablas)</span>
            <span className="color">
              <input type="color" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
              <code>{principal}</code>
            </span>
          </label>
          <label>
            Color de acento <span className="muted">(detalles, iconos)</span>
            <span className="color">
              <input type="color" value={acento} onChange={(e) => setAcento(e.target.value)} />
              <code>{acento}</code>
            </span>
          </label>
        </div>
        <label>
          Logo
          <button className="btn small" onClick={async () => setLogo(await window.buho.elegirLogo())}>
            <ImagePlus size={14} /> {logo ? logo.split(/[\\/]/).pop() : 'Elegir imagen…'}
          </button>
        </label>
        <div className="row2">
          <label>
            Marca en la cabecera <span className="muted">(opcional)</span>
            <input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="ACME" />
          </label>
          <label>
            Portada
            <select value={portada} onChange={(e) => setPortada(e.target.value as 'simple' | 'ninguna')}>
              <option value="simple">Con logo y banda de color</option>
              <option value="ninguna">Sin portada</option>
            </select>
          </label>
        </div>
        <div className="tema-muestra" style={{ borderTopColor: acento }}>
          <b style={{ color: principal }}>Título de ejemplo</b>
          <span style={{ background: principal }} />
          <i style={{ background: acento }} />
        </div>
        {error && <p className="err">{error}</p>}
        <footer>
          <button className="btn" onClick={p.onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => void crear()}>
            Crear y aplicar
          </button>
        </footer>
      </div>
    </div>
  )
}
