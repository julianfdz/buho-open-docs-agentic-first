import { useEffect, useRef, useState } from 'react'
import type { RenderResult } from '@shared/types'

/**
 * Vista previa: la página preview.html en un iframe (la misma que se imprime al exportar a PDF).
 * Se repinta al escribir (con una pequeña espera) y al momento cuando cambia la IA.
 */
interface Props {
  source: string
  baseDir: string
  /** Cambio de fuera: líneas (1) que resaltar y si hay que llevar la vista hasta ellas. */
  flash: { lines: number[]; reveal: boolean; nonce: number } | null
  /** Línea del cursor en el editor: la vista la sigue. */
  follow: number | null
  onRendered(r: RenderResult): void
  onPick(m: { line: number; word: string; double: boolean }): void
}

export default function Preview(p: Props): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const props = useRef(p)
  props.current = p
  const seq = useRef(0)
  const lastFlash = useRef<number | null>(null)

  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== frame.current?.contentWindow) return
      const m = e.data
      if (m?.type === 'ready') setReady(true)
      else if (m?.type === 'rendered' && m.id === seq.current) props.current.onRendered(m.result)
      else if (m?.type === 'click') props.current.onPick(m)
    }
    addEventListener('message', onMsg)
    return () => removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    if (!ready) return
    const flash = p.flash && p.flash.nonce !== lastFlash.current ? p.flash : null
    const send = (): void => {
      lastFlash.current = p.flash?.nonce ?? null
      frame.current?.contentWindow?.postMessage({ type: 'render', id: ++seq.current, source: p.source, baseDir: p.baseDir, flash: flash?.lines ?? [], reveal: flash?.reveal ?? false }, '*')
    }
    if (flash) {
      send()
      return
    }
    const t = setTimeout(send, 260)
    return () => clearTimeout(t)
  }, [ready, p.source, p.baseDir, p.flash?.nonce])

  useEffect(() => {
    if (ready && p.follow) frame.current?.contentWindow?.postMessage({ type: 'scrollTo', line: p.follow, quiet: true }, '*')
  }, [ready, p.follow])

  return <iframe ref={frame} className="preview" src="preview.html" title="Vista previa" />
}
