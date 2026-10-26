import { useEffect, useRef, useState } from 'react'
import type { RenderResult } from '@shared/types'

/**
 * Vista previa: la página preview.html en un iframe (la misma que se imprime al exportar a PDF).
 * Se repinta al escribir (con una pequeña espera) y al momento cuando cambia la IA. Con `editable`, el
 * texto se escribe directamente sobre la página (como en Word) y las ediciones llegan por onVisual.
 */
export type VisualMsg =
  | { type: 'edit'; ref: import('@shared/visual').BlockRef; text: string; format?: boolean }
  | { type: 'split'; ref: import('@shared/visual').BlockRef; before: string; after: string }
  | { type: 'merge'; ref: import('@shared/visual').BlockRef; prev: import('@shared/visual').BlockRef; text: string; prevText: string }
  | { type: 'focus'; ref: import('@shared/visual').BlockRef }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'key'; key: string; shift: boolean }
  | { type: 'caret'; line: number }
  | { type: 'comentar'; line: number; cita: string; seleccion?: string }
  | { type: 'ctx'; line: number; cita: string; seleccion?: string }

interface Props {
  source: string
  baseDir: string
  /** Cambio de fuera: líneas (1) que resaltar y si hay que llevar la vista hasta ellas. */
  flash: { lines: number[]; reveal: boolean; nonce: number } | null
  /** Línea del cursor en el editor: la vista la sigue. */
  follow: number | null
  editable: boolean
  /** Dejar el cursor en esta línea tras el próximo pintado (al partir o unir párrafos). */
  focus: { line: number; offset: number; nonce: number } | null
  /** Orden de formato para la selección de la página (negrita, cursiva…). */
  cmd: { name: string; value?: string; nonce: number } | null
  /** Tema del documento, ya resuelto (los propios traen logo y CSS). */
  tema: import('@shared/temas').Tema | null
  /** Revisión: líneas con comentarios y con propuestas (se marcan en la página). */
  marcas: { comentarios: number[]; propuestas: number[] } | null
  /** Modo comentar: clic en la página = comentario. */
  comentando: boolean
  onRendered(r: RenderResult): void
  onPick(m: { line: number; word: string; double: boolean }): void
  onVisual(m: VisualMsg): void
}

export default function Preview(p: Props): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const props = useRef(p)
  props.current = p
  const seq = useRef(0)
  const lastFlash = useRef<number | null>(null)
  const lastFocus = useRef<number | null>(null)

  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow) return
      const m = e.data
      if (m?.type === 'ready') setReady(true)
      else if (m?.type === 'rendered' && m.id === seq.current) props.current.onRendered(m.result)
      else if (m?.type === 'click') props.current.onPick(m)
      else if (['edit', 'split', 'merge', 'focus', 'undo', 'redo', 'key', 'caret', 'comentar', 'ctx'].includes(m?.type)) props.current.onVisual(m)
    }
    addEventListener('message', onMsg)
    return () => removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    if (!ready) return
    const flash = p.flash && p.flash.nonce !== lastFlash.current ? p.flash : null
    const focus = p.focus && p.focus.nonce !== lastFocus.current ? p.focus : null
    const send = (): void => {
      lastFlash.current = p.flash?.nonce ?? null
      lastFocus.current = p.focus?.nonce ?? null
      frame.current?.contentWindow?.postMessage(
        { type: 'render', id: ++seq.current, source: p.source, baseDir: p.baseDir, flash: flash?.lines ?? [], reveal: flash?.reveal ?? false, editable: p.editable, focus: focus ? { line: focus.line, offset: focus.offset } : undefined, tema: p.tema ?? undefined, marcas: p.marcas ?? undefined },
        '*'
      )
    }
    if (flash || focus) {
      send()
      return
    }
    const t = setTimeout(send, 200)
    return () => clearTimeout(t)
  }, [ready, p.source, p.baseDir, p.flash?.nonce, p.focus?.nonce, p.editable, p.tema, JSON.stringify(p.marcas)])

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: 'comentar', on: p.comentando }, '*')
  }, [ready, p.comentando])

  useEffect(() => {
    if (ready && p.follow) frame.current?.contentWindow?.postMessage({ type: 'scrollTo', line: p.follow, quiet: true }, '*')
  }, [ready, p.follow])

  useEffect(() => {
    if (ready && p.cmd) frame.current?.contentWindow?.postMessage({ type: 'cmd', name: p.cmd.name, value: p.cmd.value }, '*')
  }, [ready, p.cmd?.nonce])

  return <iframe ref={frame} className="preview" src="preview.html" title="Vista previa" />
}
