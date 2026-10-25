import { useEffect, useRef, useState } from 'react'
import {
  Bold,
  ChevronDown,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2
} from 'lucide-react'
import type { BlockRef, BlockStyle } from '@shared/visual'

/**
 * Barra de formato como la de Word: estilo del párrafo, negrita, cursiva, listas, enlace, insertar
 * bloques (cajas, tarjetas, tablas, índice, hueco…) y deshacer. Actúa sobre el bloque donde está el
 * cursor en la página.
 */
interface Props {
  block: BlockRef | null
  kind: 'documento' | 'presentacion'
  canUndo: boolean
  canRedo: boolean
  hasIndex: boolean
  onInline(name: 'bold' | 'italic' | 'strikeThrough' | 'link', value?: string): void
  onStyle(style: BlockStyle): void
  onInsert(md: string, label: string): void
  onIndex(): void
  onUndo(): void
  onRedo(): void
}

const STYLES: { id: BlockStyle; label: string }[] = [
  { id: 'p', label: 'Párrafo' },
  { id: 'h1', label: 'Título 1' },
  { id: 'h2', label: 'Título 2' },
  { id: 'h3', label: 'Título 3' },
  { id: 'quote', label: 'Cita' }
]

const styleOf = (b: BlockRef | null): string => {
  if (!b) return ''
  if (b.tag === 'li') return 'p'
  if (b.tag === 'blockquote') return 'quote'
  return /^h[1-3]$/.test(b.tag) ? b.tag : 'p'
}

export default function FormatBar(p: Props): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const [blocks, setBlocks] = useState<{ id: string; label: string; md: string; propio?: boolean }[]>([])
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.buho.bloques().then((r) => setBlocks(r.bloques))
  }, [])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setMenu(false)
    }
    addEventListener('mousedown', close)
    return () => removeEventListener('mousedown', close)
  }, [menu])

  const off = !p.block
  const cellOrMeta = !!p.block && (p.block.tag === 'td' || p.block.tag === 'th' || !!p.block.meta)
  // Los botones no roban el foco de la página (así la selección sigue donde estaba).
  const keep = (e: React.MouseEvent): void => e.preventDefault()

  return (
    <div className="formatbar" onMouseDown={keep}>
      <button className="fb" title="Deshacer (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
        <Undo2 size={15} />
      </button>
      <button className="fb" title="Rehacer (Ctrl+Y)" disabled={!p.canRedo} onClick={p.onRedo}>
        <Redo2 size={15} />
      </button>
      <span className="fb-sep" />
      <select className="fb-style" value={styleOf(p.block)} disabled={off || cellOrMeta} onChange={(e) => p.onStyle(e.target.value as BlockStyle)} title="Estilo del párrafo">
        {!p.block && <option value="">Estilo</option>}
        {STYLES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <span className="fb-sep" />
      <button className="fb" title="Negrita (Ctrl+B)" disabled={off} onClick={() => p.onInline('bold')}>
        <Bold size={15} />
      </button>
      <button className="fb" title="Cursiva (Ctrl+I)" disabled={off} onClick={() => p.onInline('italic')}>
        <Italic size={15} />
      </button>
      <button className="fb" title="Tachado" disabled={off} onClick={() => p.onInline('strikeThrough')}>
        <Strikethrough size={15} />
      </button>
      <button
        className="fb"
        title="Enlace"
        disabled={off}
        onClick={() => {
          const url = prompt('Dirección del enlace (vacío para quitarlo)', 'https://')
          if (url !== null) p.onInline('link', url === 'https://' ? '' : url)
        }}
      >
        <Link size={15} />
      </button>
      <span className="fb-sep" />
      <button className="fb" title="Lista con viñetas" disabled={off || cellOrMeta} onClick={() => p.onStyle('ul')}>
        <List size={15} />
      </button>
      <button className="fb" title="Lista numerada" disabled={off || cellOrMeta} onClick={() => p.onStyle('ol')}>
        <ListOrdered size={15} />
      </button>
      <button className="fb" title="Cita" disabled={off || cellOrMeta} onClick={() => p.onStyle('quote')}>
        <Quote size={15} />
      </button>
      <span className="fb-sep" />
      {p.kind === 'documento' && (
        <button className={`fb fb-text ${p.hasIndex ? 'on' : ''}`} title="Índice automático con números de página" onClick={p.onIndex}>
          <ListTree size={15} /> Índice
        </button>
      )}
      <div className="fb-menu" ref={box}>
        <button className="fb fb-text" title="Insertar un bloque ya maquetado debajo del cursor" onClick={() => setMenu(!menu)}>
          <Plus size={15} /> Insertar <ChevronDown size={13} />
        </button>
        {menu && (
          <div className="fb-drop">
            {blocks.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setMenu(false)
                  p.onInsert(b.md, b.label)
                }}
              >
                {b.label}
                {b.propio && <span className="muted"> · propio</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
