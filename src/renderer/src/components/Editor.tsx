import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { Annotation, EditorState, StateEffect, StateField, type Extension, Compartment } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * Editor del Markdown (CodeMirror 6): para corregir erratas y escribir. Los cambios que llegan de
 * fuera (la IA) se aplican sin perder el cursor ni el deshacer, y las líneas cambiadas se iluminan.
 */

/** Marca de los cambios que no ha tecleado el usuario (no se vuelven a guardar). */
export const remote = Annotation.define<boolean>()

const flashEffect = StateEffect.define<number[] | null>()
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(flashEffect)) continue
      if (!e.value) return Decoration.none
      const doc = tr.state.doc
      const marks = e.value
        .filter((l) => l >= 0 && l < doc.lines)
        .map((l) => Decoration.line({ class: 'cm-flash' }).range(doc.line(l + 1).from))
      deco = Decoration.set(marks, true)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

// Sintaxis propia de Búho Docs resaltada: bloques :::, separadores +++ y ---, directivas @…:
const buhoSyntax = new MatchDecorator({
  regexp: /^(:{3,}.*|\+{3,}\s*|@[\wñáéíóú-]+\s*:.*|\\pagebreak\s*)$/gm,
  decoration: (m) => Decoration.mark({ class: m[0].startsWith('@') ? 'cm-buho-dir' : m[0].startsWith('\\') ? 'cm-buho-dir' : 'cm-buho-block' })
})
const buhoHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buhoSyntax.createDeco(view)
    }
    update(u: ViewUpdate): void {
      this.decorations = buhoSyntax.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)
const attrDeco = new MatchDecorator({ regexp: /\{[^{}\n]*\}\s*$/gm, decoration: Decoration.mark({ class: 'cm-buho-attr' }) })
const attrHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = attrDeco.createDeco(view)
    }
    update(u: ViewUpdate): void {
      this.decorations = attrDeco.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

// Colores Búho y sin subrayados (el estilo por defecto subraya los títulos).
const buhoStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', color: 'var(--md-heading)', fontSize: '1.18em' },
  { tag: t.heading2, fontWeight: '700', color: 'var(--md-heading)', fontSize: '1.1em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--md-heading)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--md-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--md-link)' },
  { tag: t.url, color: 'var(--md-link)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--md-mark)' },
  { tag: t.monospace, color: 'var(--md-code)' },
  { tag: t.quote, color: 'var(--md-quote)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--md-mark)' },
  // Cabecera YAML
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--md-key)' },
  { tag: t.string, color: 'var(--md-value)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--md-value)' },
  { tag: t.comment, color: 'var(--md-mark)', fontStyle: 'italic' }
])

export interface EditorHandle {
  view: EditorView | null
}

interface Props {
  path: string
  content: string
  fontSize: number
  spellcheck: boolean
  /** Cambio llegado de fuera: líneas (0) a iluminar; nonce para repetir. */
  flash: { lines: number[]; nonce: number } | null
  jump: { line: number; word?: string; select?: boolean; nonce: number } | null
  onChange(content: string): void
  onSave(): void
  onCursorLine(line: number): void
  /** Línea donde está el cursor en la página: el editor la enseña sin quitarle el foco. */
  followLine?: number | null
}

const states = new Map<string, EditorState>()

/** Aplica el texto nuevo cambiando solo el trozo distinto (el cursor y el deshacer se conservan). */
function applyRemote(view: EditorView, text: string): void {
  const cur = view.state.doc.toString()
  if (cur === text) return
  let a = 0
  while (a < cur.length && a < text.length && cur[a] === text[a]) a++
  let b = 0
  while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++
  view.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) }, annotations: remote.of(true) })
}

export default function Editor(p: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const props = useRef(p)
  props.current = p
  const pathRef = useRef(p.path)
  const look = useRef(new Compartment())

  const lookExt = (fontSize: number, spell: boolean): Extension => [
    EditorView.theme({ '&': { fontSize: `${fontSize}px` } }),
    EditorView.contentAttributes.of({ spellcheck: spell ? 'true' : 'false', lang: 'es', autocorrect: 'off' })
  ]

  const makeState = (content: string): EditorState =>
    EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        yamlFrontmatter({ content: markdown() }),
        syntaxHighlighting(buhoStyle),
        EditorView.lineWrapping,
        flashField,
        buhoHighlight,
        attrHighlight,
        look.current.of(lookExt(props.current.fontSize, props.current.spellcheck)),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              props.current.onSave()
              return true
            }
          }
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(remote))) props.current.onChange(u.state.doc.toString())
          if (u.selectionSet || u.docChanged) props.current.onCursorLine(u.state.doc.lineAt(u.state.selection.main.head).number)
        })
      ]
    })

  useEffect(() => {
    view.current = new EditorView({ state: makeState(p.content), parent: host.current! })
    return () => {
      states.set(pathRef.current, view.current!.state)
      view.current?.destroy()
      view.current = null
    }
  }, [])

  // Cambio de documento: cada uno conserva su estado (cursor, deshacer).
  useEffect(() => {
    const v = view.current
    if (!v || pathRef.current === p.path) return
    states.set(pathRef.current, v.state)
    pathRef.current = p.path
    const saved = states.get(p.path)
    v.setState(saved ?? makeState(p.content))
    if (saved) applyRemote(v, p.content)
    v.dispatch({ effects: look.current.reconfigure(lookExt(p.fontSize, p.spellcheck)) })
  }, [p.path])

  // Contenido que llega de fuera.
  useEffect(() => {
    if (view.current && pathRef.current === p.path) applyRemote(view.current, p.content)
  }, [p.content])

  useEffect(() => {
    view.current?.dispatch({ effects: look.current.reconfigure(lookExt(p.fontSize, p.spellcheck)) })
  }, [p.fontSize, p.spellcheck])

  useEffect(() => {
    const v = view.current
    if (!v || !p.flash) return
    v.dispatch({ effects: flashEffect.of(p.flash.lines) })
    const first = p.flash.lines[0]
    if (first !== undefined && first < v.state.doc.lines) {
      const pos = v.state.doc.line(first + 1).from
      const rect = v.coordsAtPos(pos)
      const box = v.scrollDOM.getBoundingClientRect()
      if (!rect || rect.top < box.top || rect.bottom > box.bottom) v.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    }
    const t = setTimeout(() => view.current?.dispatch({ effects: flashEffect.of(null) }), 2600)
    return () => clearTimeout(t)
  }, [p.flash?.nonce])

  // Ir a una línea (clic en la vista previa); si se sabe la palabra, se selecciona.
  useEffect(() => {
    const v = view.current
    if (!v || !p.jump) return
    const n = Math.min(Math.max(1, p.jump.line), v.state.doc.lines)
    const line = v.state.doc.line(n)
    let from = line.from
    let to = line.from
    const w = p.jump.word
    if (w) {
      // La palabra puede estar unas líneas más abajo (párrafos largos, tablas, listas).
      for (let k = n; k <= Math.min(v.state.doc.lines, n + 40); k++) {
        const l = v.state.doc.line(k)
        const i = l.text.indexOf(w)
        if (i >= 0) {
          from = l.from + i
          to = p.jump.select ? from + w.length : from
          break
        }
      }
    }
    v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    v.focus()
  }, [p.jump?.nonce])

  useEffect(() => {
    const v = view.current
    if (!v || !p.followLine || v.hasFocus || p.followLine > v.state.doc.lines) return
    // El cursor del Markdown se coloca en esa línea (sin quitarle el foco a la página).
    const at = v.state.doc.line(Math.floor(p.followLine)).from
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }), annotations: remote.of(true) })
  }, [p.followLine])

  return <div className="editor" ref={host} />
}
