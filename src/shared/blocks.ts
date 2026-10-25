/**
 * Bloques prediseñados: piezas ya maquetadas que se insertan de un golpe (barra «Insertar» de la app y
 * `buho-docs insertar`). Ahorran escribir la sintaxis y, a una IA, tokens: solo cambia el texto.
 * Además de estos, cada usuario puede guardar los suyos como .md en <datos>/bloques.
 */
export interface Block {
  id: string
  label: string
  /** Icono de lucide para la barra. */
  icon: string
  md: string
}

export const BLOCKS: Block[] = [
  { id: 'titulo', label: 'Título de sección', icon: 'heading-2', md: '## Título de la sección' },
  { id: 'parrafo', label: 'Párrafo', icon: 'pilcrow', md: 'Escribe aquí el texto.' },
  { id: 'lista', label: 'Lista', icon: 'list', md: '- Primer punto\n- Segundo punto\n- Tercer punto' },
  { id: 'numerada', label: 'Lista numerada', icon: 'list-ordered', md: '1. Primer paso\n2. Segundo paso\n3. Tercer paso' },
  { id: 'tabla', label: 'Tabla', icon: 'table', md: '| Columna 1 | Columna 2 | Columna 3 |\n|---|---|---|\n| Dato | Dato | Dato |\n| Dato | Dato | Dato |' },
  { id: 'caja', label: 'Caja destacada', icon: 'lightbulb', md: '::: caja icon=bombilla\n**Idea clave.** Lo que no se puede perder.\n:::' },
  { id: 'caja-navy', label: 'Caja oscura', icon: 'square', md: '::: caja navy icon=escudo\n**En una frase:** el mensaje principal.\n:::' },
  { id: 'aviso', label: 'Aviso', icon: 'triangle-alert', md: '::: caja aviso icon=alerta\n**Ojo:** lo que hay que tener en cuenta.\n:::' },
  { id: 'tarjetas', label: 'Tarjetas con icono', icon: 'layout-grid', md: '::: tarjetas 3\n### Primera {icon=reloj}\nTexto corto.\n\n### Segunda {icon=check}\nTexto corto.\n\n### Tercera {icon=equipo}\nTexto corto.\n:::' },
  { id: 'cifras', label: 'Cifras grandes', icon: 'chart-column', md: '::: cifras 3\n- **3** primera cifra\n- **12** segunda cifra\n- **90** tercera cifra\n:::' },
  { id: 'pasos', label: 'Pasos numerados', icon: 'footprints', md: '::: pasos\n### Primer paso\nQué se hace.\n\n### Segundo paso\nQué se hace.\n\n### Tercer paso\nQué se hace.\n:::' },
  { id: 'columnas', label: 'Dos columnas', icon: 'columns-2', md: '::: columnas\nTexto de la columna izquierda.\n+++\nTexto de la columna derecha.\n:::' },
  { id: 'cita', label: 'Cita', icon: 'quote', md: '::: cita\n«Una frase que merece destacarse.»\n:::' },
  { id: 'nota', label: 'Nota pequeña', icon: 'sticky-note', md: '::: nota\nFuentes y aclaraciones.\n:::' },
  { id: 'imagen', label: 'Imagen', icon: 'image', md: '![Descripción](imagen.png){width=80%}' },
  { id: 'hueco', label: 'Hueco (se rellena luego)', icon: 'loader', md: '::: hueco id=pendiente texto="Contenido en preparación"\n:::' },
  { id: 'indice', label: 'Índice automático', icon: 'list-tree', md: '::: indice niveles=2\n:::' },
  { id: 'salto', label: 'Salto de página', icon: 'scissors-line-dashed', md: '\\pagebreak' }
]

export const blockById = (id: string): Block | undefined => BLOCKS.find((b) => b.id === id.toLowerCase())
