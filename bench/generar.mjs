/**
 * Genera el documento de prueba del banco de velocidad: un Markdown de Búho Docs de unas 20 páginas A4
 * con texto «aleatorio» pero siempre el mismo (semilla fija), títulos, listas, tablas, cajas y tarjetas.
 * Lleva a propósito una errata («efiencia») y una cifra única («12,5 %») para los arreglos medidos.
 *
 *   node bench/generar.mjs [salida.md] [secciones]
 */
import { writeFileSync } from 'node:fs'

let seed = 20261025
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (a) => a[Math.floor(rnd() * a.length)]

const SUJ = ['El equipo comercial', 'La dirección', 'El área de administración', 'Atención al cliente', 'El departamento de operaciones', 'Recursos humanos', 'Cada responsable de área', 'La plantilla', 'El equipo de marketing', 'Logística']
const VERB = ['dedica cada semana varias horas a', 'pierde tiempo en', 'podría automatizar', 'revisa a mano', 'necesita mejorar', 'quiere ordenar', 'repite cada mes', 'documenta con dificultad', 'centraliza con esfuerzo', 'prepara de forma manual']
const OBJ = ['los informes de seguimiento', 'las propuestas a clientes', 'la conciliación de facturas', 'las respuestas a preguntas frecuentes', 'la planificación de turnos', 'el control del inventario', 'los correos de seguimiento', 'las actas de reunión', 'la previsión de tesorería', 'el registro de incidencias']
const CIERRE = ['con resultados desiguales.', 'sin un criterio común.', 'lo que retrasa la toma de decisiones.', 'y es aquí donde la IA aporta más.', 'con un coste oculto importante.', 'aunque hay margen de mejora claro.', 'y la información queda dispersa.', 'sin medir el impacto real.']
const sentence = () => `${pick(SUJ)} ${pick(VERB)} ${pick(OBJ)} ${pick(CIERRE)}`
const paragraph = (n = 4) => Array.from({ length: n }, sentence).join(' ')
const AREAS = ['Ventas', 'Marketing', 'Atención al cliente', 'Administración', 'Finanzas', 'Recursos humanos', 'Operaciones', 'Logística', 'Compras', 'Calidad', 'Informática', 'Dirección', 'Producción', 'Legal']
const ICONOS = ['reloj', 'check', 'equipo', 'ventas', 'datos', 'escudo', 'objetivo', 'cerebro']

export function generar(secciones = 26) {
  seed = 20261025
  const out = [
    '---',
    'tipo: documento',
    'titulo: "Informe de oportunidades de IA por áreas"',
    'subtitulo: "Banco de pruebas de velocidad de Búho Docs: documento largo generado con texto de relleno."',
    'etiqueta: "BANCO DE PRUEBAS · DOCUMENTO DE 20 PÁGINAS"',
    'destinatario: "DOCUMENTO DE PRUEBA"',
    'fecha: "Octubre de 2026"',
    'autor: "Búho AI"',
    '---',
    ''
  ]
  for (let s = 1; s <= secciones; s++) {
    const area = AREAS[(s - 1) % AREAS.length]
    out.push(`## ${s}. ${area}`, '', paragraph(5), '', paragraph(4), '')
    if (s === 3) out.push('La efiencia del proceso actual es baja: hay pasos duplicados y datos que se copian a mano entre programas.', '')
    out.push(...Array.from({ length: 4 }, () => `- ${sentence()}`), '')
    if (s % 2 === 0) {
      out.push('| Proceso | Horas/mes | Ahorro estimado | Prioridad |', '|---|---|---|---|')
      for (let r = 0; r < 5; r++) {
        const pct = s === 4 && r === 2 ? '12,5 %' : `${10 + Math.floor(rnd() * 50)} %`
        out.push(`| ${pick(OBJ)} | ${4 + Math.floor(rnd() * 40)} | ${pct} | ${pick(['Alta', 'Media', 'Baja'])} |`)
      }
      out.push('')
    }
    if (s % 3 === 0) out.push('::: caja icon=bombilla', `**Idea clave.** ${paragraph(2)}`, ':::', '')
    if (s % 4 === 1) {
      out.push('::: tarjetas 3')
      for (let c = 0; c < 3; c++) out.push(`### ${pick(['Ahorro', 'Calidad', 'Servicio', 'Control', 'Datos', 'Equipo'])} {icon=${pick(ICONOS)}}`, sentence(), '')
      out.push(':::', '')
    }
    out.push(paragraph(4), '')
  }
  return out.join('\n')
}

if (process.argv[1]?.endsWith('generar.mjs')) {
  const file = process.argv[2] ?? 'bench-documento.md'
  writeFileSync(file, generar(Number(process.argv[3]) || 26))
  console.log(`Generado ${file}`)
}
