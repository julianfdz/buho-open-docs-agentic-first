/**
 * Plantillas genéricas para arrancar rápido: no dependen de ningún estilo (se crean con el tema que se
 * elija) y llevan el contenido típico de cada tipo de documento listo para rellenar. Los textos entre
 * [corchetes] son lo que hay que cambiar. Cada usuario puede añadir las suyas como .md en
 * <datos>/plantillas.
 */
export interface Plantilla {
  id: string
  nombre: string
  tipo: 'documento' | 'presentacion'
  descripcion: string
  /** Cuerpo (sin cabecera YAML); la cabecera la pone la app con el título, el tema y la fecha. */
  cuerpo: string
  /** Campos extra de la cabecera. */
  meta?: Record<string, string>
}

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'acta',
    nombre: 'Acta de reunión',
    tipo: 'documento',
    descripcion: 'Asistentes, orden del día, acuerdos y tareas con responsable y fecha.',
    meta: { portada: 'false' },
    cuerpo: `# Acta de reunión: [tema]

| | |
|---|---|
| **Fecha** | [dd/mm/aaaa], de [hh:mm] a [hh:mm] |
| **Lugar** | [presencial / videollamada] |
| **Asistentes** | [Nombre (empresa)], [Nombre (empresa)] |
| **Redacta** | [Nombre] |

## Orden del día

1. [Primer punto]
2. [Segundo punto]
3. [Ruegos y preguntas]

## Desarrollo

### 1. [Primer punto]
[Resumen de lo que se habló.]

### 2. [Segundo punto]
[Resumen de lo que se habló.]

## Acuerdos

::: caja icon=check
- [Acuerdo 1]
- [Acuerdo 2]
:::

## Tareas

| Tarea | Responsable | Fecha límite |
|---|---|---|
| [Tarea] | [Nombre] | [dd/mm/aaaa] |
| [Tarea] | [Nombre] | [dd/mm/aaaa] |

## Próxima reunión

[Fecha, hora y lugar.]
`
  },
  {
    id: 'factura',
    nombre: 'Factura',
    tipo: 'documento',
    descripcion: 'Emisor, cliente, conceptos, base, IVA, IRPF y total; forma de pago.',
    meta: { portada: 'false' },
    cuerpo: `# Factura [nº 2026-001]

::: columnas
**Emisor**  
[Nombre o razón social]  
NIF: [00000000X]  
[Dirección] · [CP Ciudad]  
[correo@empresa.es]
+++
**Cliente**  
[Nombre o razón social]  
NIF/CIF: [B00000000]  
[Dirección] · [CP Ciudad]
:::

| | |
|---|---|
| **Fecha de factura** | [dd/mm/aaaa] |
| **Fecha de vencimiento** | [dd/mm/aaaa] |

## Conceptos

| Concepto | Cantidad | Precio | Importe |
|---|---|---|---|
| [Descripción del servicio] | [1] | [0,00 €] | [0,00 €] |
| [Descripción del servicio] | [1] | [0,00 €] | [0,00 €] |

| | |
|---|---|
| **Base imponible** | [0,00 €] |
| **IVA ([21] %)** | [0,00 €] |
| **Retención IRPF ([15] %)** | [−0,00 €] |
| **Total** | **[0,00 €]** |

## Forma de pago

Transferencia a la cuenta [ES00 0000 0000 0000 0000 0000] antes del [dd/mm/aaaa], indicando el número de factura.

::: nota
[Si aplica: operación exenta de IVA según el art. [20.Uno.9.º] de la Ley 37/1992.]
:::
`
  },
  {
    id: 'presupuesto',
    nombre: 'Presupuesto',
    tipo: 'documento',
    descripcion: 'Alcance, partidas, total, plazos, condiciones y validez.',
    meta: { portada: 'false' },
    cuerpo: `# Presupuesto: [proyecto]

**Para:** [Cliente] · **Fecha:** [dd/mm/aaaa] · **Válido hasta:** [dd/mm/aaaa]

## Qué incluye

[Una o dos frases con el objetivo y el alcance.]

- [Entregable 1]
- [Entregable 2]
- [Entregable 3]

## Partidas

| Partida | Detalle | Importe |
|---|---|---|
| [Fase 1] | [Qué se hace] | [0,00 €] |
| [Fase 2] | [Qué se hace] | [0,00 €] |
| **Total (sin IVA)** | | **[0,00 €]** |

## Plazos

::: pasos horizontal
### [Semana 1-2]
[Hito]

### [Semana 3-4]
[Hito]

### [Entrega]
[Hito]
:::

## Condiciones

- Forma de pago: [50 % al inicio y 50 % a la entrega].
- No incluye: [lo que queda fuera].
- Impuestos: [IVA no incluido].
`
  },
  {
    id: 'propuesta',
    nombre: 'Propuesta comercial',
    tipo: 'documento',
    descripcion: 'Situación, solución, cómo lo hacemos, inversión y siguiente paso.',
    cuerpo: `## Lo que nos contáis

[El problema o la oportunidad del cliente, con sus palabras.]

## Qué proponemos

::: tarjetas 3
### [Pieza 1] {icon=objetivo}
[Qué es y qué le aporta.]

### [Pieza 2] {icon=engranaje}
[Qué es y qué le aporta.]

### [Pieza 3] {icon=equipo}
[Qué es y qué le aporta.]
:::

## Cómo lo hacemos

::: pasos
### [Paso 1]
[Qué pasa y cuánto dura.]

### [Paso 2]
[Qué pasa y cuánto dura.]

### [Paso 3]
[Qué pasa y cuánto dura.]
:::

## Inversión

| Concepto | Importe |
|---|---|
| [Concepto] | [0,00 €] |
| **Total (sin IVA)** | **[0,00 €]** |

## Siguiente paso

::: caja icon=cohete
**[Qué decidimos hoy]** y fecha de inicio prevista: [dd/mm/aaaa].
:::
`
  },
  {
    id: 'informe',
    nombre: 'Informe',
    tipo: 'documento',
    descripcion: 'Resumen ejecutivo, contexto, hallazgos, recomendaciones y anexos.',
    cuerpo: `::: indice niveles=2
:::

\\pagebreak

## Resumen ejecutivo

[Tres o cuatro frases con la conclusión principal.]

::: cifras 3
- **[0]** [primera cifra clave]
- **[0]** [segunda cifra clave]
- **[0]** [tercera cifra clave]
:::

## Contexto

[Qué se ha analizado, cómo y con qué datos.]

## Hallazgos

### [Hallazgo 1]
[Explicación.]

### [Hallazgo 2]
[Explicación.]

## Recomendaciones

| Recomendación | Impacto | Esfuerzo | Prioridad |
|---|---|---|---|
| [Recomendación] | [Alto] | [Bajo] | [1] |
| [Recomendación] | [Medio] | [Medio] | [2] |

## Anexos

::: nota
[Fuentes y metodología.]
:::
`
  },
  {
    id: 'carta',
    nombre: 'Carta',
    tipo: 'documento',
    descripcion: 'Carta formal con remitente, destinatario, asunto y firma.',
    meta: { portada: 'false' },
    cuerpo: `[Nombre del remitente]  
[Dirección] · [CP Ciudad]

[Nombre del destinatario]  
[Empresa]  
[Dirección] · [CP Ciudad]

[Ciudad], a [dd] de [mes] de [aaaa]

**Asunto:** [asunto]

[Estimado/a señor/a [Apellido]]:

[Primer párrafo: el motivo de la carta.]

[Segundo párrafo: el detalle.]

[Tercer párrafo: lo que se pide o el siguiente paso.]

Atentamente,

[Nombre]  
[Cargo]
`
  },
  {
    id: 'guia',
    nombre: 'Guía o manual',
    tipo: 'documento',
    descripcion: 'Índice, para quién es, pasos, preguntas frecuentes y contacto.',
    cuerpo: `::: indice niveles=2
:::

\\pagebreak

## Para quién es esta guía

[Quién la va a usar y para qué.]

## Antes de empezar

- [Requisito 1]
- [Requisito 2]

## Paso a paso

::: pasos
### [Primer paso]
[Qué hacer.]

### [Segundo paso]
[Qué hacer.]

### [Tercer paso]
[Qué hacer.]
:::

::: caja aviso icon=alerta
**Ojo:** [el error más habitual y cómo evitarlo].
:::

## Preguntas frecuentes

### [¿Pregunta?]
[Respuesta.]

### [¿Pregunta?]
[Respuesta.]

## Contacto

[A quién preguntar.]
`
  },
  {
    id: 'one-pager',
    nombre: 'One-pager',
    tipo: 'documento',
    descripcion: 'Una página: problema, solución, beneficios, cifras y contacto.',
    meta: { portada: 'false' },
    cuerpo: `# [Producto o servicio]

**[Una frase que diga qué es y para quién.]**

::: columnas
## El problema
[Qué duele hoy.]
+++
## La solución
[Qué hacemos y cómo.]
:::

::: tarjetas 3
### [Beneficio 1] {icon=reloj}
[Una línea.]

### [Beneficio 2] {icon=check}
[Una línea.]

### [Beneficio 3] {icon=ventas}
[Una línea.]
:::

::: cifras 3
- **[0]** [cifra]
- **[0]** [cifra]
- **[0]** [cifra]
:::

::: caja navy icon=correo
**¿Hablamos?** [correo] · [teléfono] · [web]
:::
`
  },
  {
    id: 'plan',
    nombre: 'Plan de proyecto',
    tipo: 'documento',
    descripcion: 'Objetivo, alcance, fases, calendario, riesgos y responsables.',
    cuerpo: `## Objetivo

[Qué se quiere conseguir y cómo se medirá.]

## Alcance

::: columnas
**Incluye**
- [Punto]
- [Punto]
+++
**No incluye**
- [Punto]
- [Punto]
:::

## Fases y calendario

| Fase | Qué se hace | Inicio | Fin | Responsable |
|---|---|---|---|---|
| [1] | [Tareas] | [dd/mm] | [dd/mm] | [Nombre] |
| [2] | [Tareas] | [dd/mm] | [dd/mm] | [Nombre] |

## Riesgos

| Riesgo | Probabilidad | Impacto | Cómo lo mitigamos |
|---|---|---|---|
| [Riesgo] | [Media] | [Alto] | [Medida] |

## Equipo

- **[Rol]:** [Nombre]
- **[Rol]:** [Nombre]
`
  },
  {
    id: 'cv',
    nombre: 'Currículum',
    tipo: 'documento',
    descripcion: 'Perfil, experiencia, formación, habilidades y contacto.',
    meta: { portada: 'false' },
    cuerpo: `# [Nombre Apellidos]

**[Puesto o perfil]** · [Ciudad] · [correo] · [teléfono] · [LinkedIn]

## Perfil

[Tres líneas sobre quién eres y qué aportas.]

## Experiencia

### [Puesto] · [Empresa]
*[mes aaaa] – [mes aaaa]*
- [Logro con cifra]
- [Logro con cifra]

### [Puesto] · [Empresa]
*[mes aaaa] – [mes aaaa]*
- [Logro]

## Formación

- **[Título]** · [Centro] · [aaaa]

## Habilidades

[Habilidad] · [Habilidad] · [Habilidad] · [Idiomas]
`
  },
  {
    id: 'pitch',
    nombre: 'Pitch',
    tipo: 'presentacion',
    descripcion: 'Problema, solución, cómo funciona, cifras, equipo y petición.',
    cuerpo: `@diseño: portada
@etiqueta: [ETIQUETA]

# [Nombre del proyecto]

**[Una frase con lo que hacemos.]**

---

@etiqueta: EL PROBLEMA

## [El problema en una frase]

- [Dato o síntoma 1]
- [Dato o síntoma 2]
- [Dato o síntoma 3]

---

@etiqueta: LA SOLUCIÓN

## [La solución en una frase]

::: tarjetas 3
### [Pieza 1] {icon=objetivo}
[Una línea.]

### [Pieza 2] {icon=rayo}
[Una línea.]

### [Pieza 3] {icon=check}
[Una línea.]
:::

---

@etiqueta: CIFRAS

## [Lo que hemos conseguido]

::: cifras 3
- **[0]** [cifra]
- **[0]** [cifra]
- **[0]** [cifra]
:::

---

@diseño: cierre
@etiqueta: SIGUIENTE PASO

## [Lo que pedimos]

[Contacto]
`
  },
  {
    id: 'formacion',
    nombre: 'Sesión de formación',
    tipo: 'presentacion',
    descripcion: 'Objetivos, agenda, contenido, práctica y resumen.',
    cuerpo: `@diseño: portada
@etiqueta: FORMACIÓN

# [Título de la sesión]

[Fecha · formador/a]

---

@etiqueta: HOY

## Qué vamos a conseguir

- [Objetivo 1]
- [Objetivo 2]
- [Objetivo 3]

---

@etiqueta: AGENDA

## Cómo nos organizamos

::: pasos horizontal
### [Bloque 1]
[Duración]

### [Bloque 2]
[Duración]

### [Práctica]
[Duración]
:::

---

@diseño: seccion
@etiqueta: BLOQUE 1

## [Título del bloque]

---

@etiqueta: PRÁCTICA

## [Ejercicio]

1. [Paso]
2. [Paso]
3. [Paso]

---

@diseño: cierre
@etiqueta: RESUMEN

## [La idea con la que os vais]

[Dudas y contacto]
`
  },
  {
    id: 'resultados',
    nombre: 'Informe de resultados',
    tipo: 'presentacion',
    descripcion: 'Cifras clave, qué ha ido bien, qué no y próximos pasos.',
    cuerpo: `@diseño: portada
@etiqueta: RESULTADOS [PERIODO]

# [Proyecto o área]

[Fecha]

---

@etiqueta: EN CIFRAS

## [El periodo en una frase]

::: cifras 3
- **[0]** [cifra]
- **[0]** [cifra]
- **[0]** [cifra]
:::

---

@etiqueta: BALANCE

## Qué ha ido bien y qué no

+++

::: caja icon=check
**Bien:** [punto] · [punto]
:::
+++
::: caja aviso icon=alerta
**A mejorar:** [punto] · [punto]
:::

---

@diseño: cierre
@etiqueta: PRÓXIMOS PASOS

## [Lo siguiente]

- [Paso]
- [Paso]
`
  }
]

export const plantillaById = (id: string): Plantilla | undefined => PLANTILLAS.find((p) => p.id === id.toLowerCase())

/** Documento listo para escribir a partir de una plantilla (cabecera con título, tema y fecha). */
export function desdePlantilla(p: Pick<Plantilla, 'tipo' | 'cuerpo' | 'meta' | 'nombre'>, titulo: string, tema: string, fecha: string): string {
  const q = (s: string): string => JSON.stringify(s)
  const meta = Object.entries(p.meta ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return `---\ntipo: ${p.tipo}\ntema: ${tema}\ntitulo: ${q(titulo || p.nombre)}\nfecha: ${q(fecha)}${meta ? '\n' + meta : ''}\n---\n\n${p.cuerpo}`
}
