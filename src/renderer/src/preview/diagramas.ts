import type { RenderWarning } from '@shared/types'
import type { Tema } from '@shared/temas'

/**
 * Diagramas Mermaid (```mermaid): se dibujan en SVG antes de paginar, con los colores y letras del
 * tema. Mermaid es grande: se carga solo la primera vez que aparece un diagrama. Cada diagrama se
 * guarda ya dibujado (por código y tema) para no repetirlo a cada tecla.
 */
type Mermaid = typeof import('mermaid').default
let mermaid: Promise<Mermaid> | null = null
let temaActual = ''
const hechos = new Map<string, string>()
let n = 0

function cargar(tema: Tema): Promise<Mermaid> {
  mermaid ??= import('mermaid').then((m) => m.default)
  return mermaid.then((m) => {
    const clave = JSON.stringify([tema.colores, tema.fuentes])
    if (clave !== temaActual) {
      temaActual = clave
      const sans = tema.fuentes?.texto ?? 'Calibri, Carlito, sans-serif'
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: sans,
        themeVariables: {
          fontFamily: sans,
          fontSize: '15px',
          primaryColor: tema.colores.suave ?? '#e8f8f7',
          primaryBorderColor: tema.colores.acento,
          primaryTextColor: tema.colores.texto ?? '#1c2a3b',
          secondaryColor: '#eef1f6',
          tertiaryColor: '#ffffff',
          lineColor: tema.colores.principal,
          textColor: tema.colores.texto ?? '#1c2a3b',
          mainBkg: tema.colores.suave ?? '#e8f8f7',
          clusterBkg: '#f6f8fb',
          clusterBorder: '#d5dde6',
          noteBkgColor: '#fff6e6',
          noteBorderColor: '#f0a020',
          actorBkg: tema.colores.suave ?? '#e8f8f7',
          actorBorder: tema.colores.acento,
          pie1: '#00A39B',
          pie2: '#2F6BD8',
          pie3: '#D9822B',
          pie4: '#C9455A',
          pie5: '#9B59C9',
          pie6: '#5E9C3A'
        },
        flowchart: { htmlLabels: false, curve: 'basis', padding: 14 },
        sequence: { useMaxWidth: true }
      })
      hechos.clear()
    }
    return m
  })
}

/** Sustituye cada `.bx-mermaid` por su diagrama. Los errores se avisan y el código queda a la vista. */
export async function dibujarDiagramas(raiz: DocumentFragment | HTMLElement, tema: Tema, warnings: RenderWarning[]): Promise<void> {
  const figs = [...raiz.querySelectorAll<HTMLElement>('.bx-mermaid')]
  if (!figs.length) return
  const m = await cargar(tema)
  for (const fig of figs) {
    const code = fig.querySelector('.mermaid-src')?.textContent ?? ''
    let svg = hechos.get(code)
    if (svg === undefined) {
      try {
        svg = (await m.render(`mmd-${++n}`, code)).svg
        hechos.set(code, svg)
      } catch (e) {
        warnings.push({ line: Number(fig.dataset.line) || undefined, level: 'aviso', message: `Diagrama con error: ${String((e as Error).message ?? e).split('\n')[0].slice(0, 160)}` })
        document.getElementById(`dmmd-${n}`)?.remove()
        fig.classList.add('con-error')
        continue
      }
    }
    fig.innerHTML = svg
  }
}
