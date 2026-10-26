/**
 * «Aire IA»: frases y costumbres que delatan un texto escrito por una IA (aperturas grandilocuentes,
 * conectores de relleno, verbos de folleto, «no es solo X, sino Y», negritas por todas partes, listas
 * de «**Algo:** explicación», rayas, exclamaciones, emojis…). Es determinista: busca patrones y dice
 * dónde están y qué hacer; reescribir lo hace un agente (humanizar) o una persona.
 */
export interface Hallazgo {
  linea: number
  tipo: string
  texto: string
  mensaje: string
}

interface Regla {
  tipo: string
  re: RegExp
  mensaje: string
}

const P = (s: string): RegExp => new RegExp(s, 'giu')

/** Frases hechas (español). El mensaje dice qué hacer en vez de eso. */
const FRASES: Regla[] = [
  { tipo: 'apertura-grandilocuente', re: P(String.raw`\b(en el (mundo|panorama|entorno|contexto|escenario) (actual|de hoy|empresarial actual)|en la (era|época) (digital|de la (ia|inteligencia artificial))|hoy en día|en un mundo (cada vez más|en constante)|vivimos en (un|una) (mundo|época|era))\b`), mensaje: 'Apertura de relleno: empieza directamente por lo que importa' },
  { tipo: 'conector-relleno', re: P(String.raw`(^|[.!?]\s+)(además|asimismo|por otro lado|en este sentido|por su parte|de este modo|de esta manera|en esta línea),`), mensaje: 'Conector de relleno al inicio de frase: quítalo o une las frases' },
  { tipo: 'muletilla', re: P(String.raw`\b(cabe (destacar|mencionar|señalar|resaltar)|es (importante|fundamental|crucial|clave|esencial|vital) (destacar|señalar|mencionar|tener en cuenta|recordar|entender|subrayar)|vale la pena (destacar|mencionar)|no hay que olvidar|conviene (destacar|recordar)|es por ello que|es por esto que)\b`), mensaje: 'Muletilla: di la cosa sin anunciar que es importante' },
  { tipo: 'cierre-de-redaccion', re: P(String.raw`\b(en (resumen|conclusión|definitiva|pocas palabras|síntesis)|en última instancia|para concluir|a modo de conclusión)\b`), mensaje: 'Cierre de redacción escolar: si hace falta resumir, que lo diga el título' },
  { tipo: 'enfatico', re: P(String.raw`\b(sin lugar a dudas|sin duda alguna|sin ninguna duda|indudablemente|definitivamente|absolutamente)\b`), mensaje: 'Énfasis vacío: quítalo' },
  { tipo: 'verbo-folleto', re: P(String.raw`\b(revolucion(ar|a|ará|ando)|potenci(ar|a|ará|ando)|desbloque(ar|a|ará)|impuls(ar|a|ará) (tu|su|la|el|el crecimiento)|optimiz(ar|a) (al máximo|tus|sus)|transform(ar|a) (radicalmente|por completo|la forma)|llev(ar|a|ará|an|amos)( .{0,30})? al siguiente nivel|sumergir(te|se|nos)|navega(r)? (por|el|la|los|las) (mundo|complejidad|panorama|desafíos?)|aprovechar al máximo|maximizar el potencial)\b`), mensaje: 'Verbo de folleto: di qué cambia en concreto (horas, errores, euros)' },
  { tipo: 'palabra-comodin', re: P(String.raw`\b(sinergias?|holístic[oa]s?|disruptiv[oa]s?|de vanguardia|vanguardista|innovador(a|es|as)?|cambio de paradigma|un antes y un después|game ?changer|ecosistema|robust[oa]s?|soluciones? a medida|valor añadido)\b`), mensaje: 'Palabra comodín: sustitúyela por algo concreto o quítala' },
  { tipo: 'cliche-ia', re: P(String.raw`\b(juega un papel (clave|crucial|fundamental|esencial|importante)|pieza (clave|fundamental)|marca la diferencia|la clave está en|el verdadero (valor|potencial|reto)|(un|tu|su) (gran )?aliado (clave|estratégico|indispensable|perfecto)?|está aquí para quedarse|el futuro (ya )?es (ahora|hoy)|no es ciencia ficción)\b`), mensaje: 'Cliché típico de texto generado: dilo con tus palabras o quítalo' },
  { tipo: 'no-es-solo', re: P(String.raw`\bno (es|son|se trata de|solo es|consiste) (solo|solamente|únicamente|simplemente)\b[^.]{0,90}\b(sino|es|también)\b`), mensaje: '«No es solo X, sino Y»: estructura muy de IA. Afirma Y directamente' },
  { tipo: 'pregunta-retorica', re: P(String.raw`¿(el|la|los|las) (resultado|clave|respuesta|diferencia|secreto|truco|motivo)s?\?`), mensaje: '«¿El resultado? …»: pregunta retórica de anuncio. Dilo sin pregunta' },
  { tipo: 'imagina', re: P(String.raw`(^|[.!?]\s+)(imagina|imagínate|piensa en) (que|un|una|por un momento)`), mensaje: '«Imagina que…»: arranque de vendedor. Ve al caso real' },
  { tipo: 'calco-ingles', re: P(String.raw`\b(a nivel de|en términos de|de cara a|en base a|jugar un rol|hacer sentido|tiene sentido que|a día de hoy|al final del día)\b`), mensaje: 'Calco o muletilla: hay forma más directa de decirlo' }
]

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}]/u

/** Partes que no se revisan: cabecera, código, fórmulas, SVG, tablas de datos de gráficos. */
function lineasRevisables(src: string): { n: number; l: string }[] {
  const L = src.split(/\r?\n/)
  const out: { n: number; l: string }[] = []
  let i = 0
  if (L[0]?.trim() === '---') {
    i = 1
    while (i < L.length && L[i].trim() !== '---') i++
    i++
  }
  let fence = false
  let math = false
  for (; i < L.length; i++) {
    const l = L[i]
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence
      continue
    }
    if (/^\s*\$\$/.test(l) && !/\$\$\s*\S.*\$\$\s*$/.test(l)) {
      math = !math
      continue
    }
    if (fence || math || /^\s*@\w/.test(l) || /^\s*:::/.test(l) || /^\s*\|/.test(l)) continue
    out.push({ n: i + 1, l })
  }
  return out
}

export function aireIA(src: string): Hallazgo[] {
  const out: Hallazgo[] = []
  const lineas = lineasRevisables(src)
  for (const { n, l } of lineas) {
    const texto = l.replace(/\{[^}]*\}\s*$/, '')
    for (const r of FRASES) {
      r.re.lastIndex = 0
      for (const m of texto.matchAll(r.re)) out.push({ linea: n, tipo: r.tipo, texto: m[0].replace(/^[.!?]\s+/, '').trim(), mensaje: r.mensaje })
    }
    if (/\s—\s|—/.test(texto)) out.push({ linea: n, tipo: 'raya', texto: '—', mensaje: 'Raya (—) como pausa: en español queda forzado. Usa coma, punto o paréntesis' })
    if (/[!¡]/.test(texto.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))) out.push({ linea: n, tipo: 'exclamacion', texto: '¡…!', mensaje: 'Exclamación: tono de anuncio. Quítala' })
    if (EMOJI.test(texto)) out.push({ linea: n, tipo: 'emoji', texto: texto.match(EMOJI)![0], mensaje: 'Emoji en el texto: quítalo (los iconos van con {icon=…})' })
    if (/^#{1,4}\s+[^:]{2,40}:\s+\S/.test(texto)) out.push({ linea: n, tipo: 'titulo-con-dos-puntos', texto: texto.replace(/^#+\s*/, ''), mensaje: 'Título «Algo: la clave de algo»: muy de IA. Un título corto y llano' })
    // Negritas: más de una cada ~20 palabras en un párrafo.
    const negritas = (texto.match(/\*\*[^*]+\*\*/g) ?? []).length
    const palabras = texto.split(/\s+/).filter(Boolean).length
    if (!/^\s*[-*+]\s/.test(texto) && negritas >= 3 && negritas > palabras / 20) out.push({ linea: n, tipo: 'negritas', texto: `${negritas} negritas`, mensaje: 'Demasiadas negritas en un párrafo: deja una (lo más importante) o ninguna' })
    // Tríadas: «X, Y y Z» repetidas en la misma frase.
    if ((texto.match(/\b\w+, \w+ y \w+\b/g) ?? []).length >= 2) out.push({ linea: n, tipo: 'triadas', texto: 'X, Y y Z', mensaje: 'Enumeraciones de tres en serie: suena a plantilla. Deja la que importe' })
  }
  // Listas en las que cada viñeta empieza por «**Algo:**» o «**Algo**:».
  let seguidas: number[] = []
  const cerrar = (): void => {
    if (seguidas.length >= 3) out.push({ linea: seguidas[0], tipo: 'lista-negrita-dos-puntos', texto: `${seguidas.length} viñetas «**X:** …»`, mensaje: 'Todas las viñetas empiezan por «**Algo:**»: patrón típico de IA. Escribe frases normales o una tabla' })
    seguidas = []
  }
  for (const { n, l } of lineas) {
    if (/^\s*([-*+]|\d+\.)\s+\*\*[^*]{1,60}(:\*\*|\*\*\s*:)/.test(l)) seguidas.push(n)
    else if (!/^\s*$/.test(l)) cerrar()
  }
  cerrar()
  return out.sort((a, b) => a.linea - b.linea)
}

/** Guía para los agentes que escriben (se añade a sus instrucciones). */
export const GUIA_SIN_AIRE_IA = [
  'Escribe como una persona experta que va al grano, no como una IA:',
  '- Sin aperturas grandilocuentes («en el mundo actual», «hoy en día»), sin conectores de relleno al principio de frase («Además,», «Asimismo,», «En este sentido,») y sin cierres de redacción («En resumen», «En conclusión»).',
  '- Sin muletillas («cabe destacar», «es importante señalar»), sin verbos de folleto (revolucionar, potenciar, desbloquear, llevar al siguiente nivel) ni palabras comodín (sinergia, holístico, disruptivo, de vanguardia, ecosistema, robusto, innovador).',
  '- Nada de «no es solo X, sino Y», «¿El resultado? …», «Imagina que…», «juega un papel clave», «marca la diferencia», «más allá de».',
  '- Sin rayas (—) como pausa, sin exclamaciones, sin emojis. Como mucho una negrita por párrafo. No todas las viñetas con «**Algo:** explicación».',
  '- Datos concretos en vez de adjetivos (horas, euros, plazos, nombres de tareas). Frases cortas y variadas. Si algo no aporta, no lo pongas.'
].join('\n')
