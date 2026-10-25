import type { DocKind } from '@shared/types'

/** Plantillas de partida: enseñan la sintaxis con un ejemplo de cada bloque. */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const fechaHoy = (): string => {
  const d = new Date()
  const m = MESES[d.getMonth()]
  return `${m[0].toUpperCase()}${m.slice(1)} de ${d.getFullYear()}`
}

const q = (s: string): string => JSON.stringify(s)

export function template(kind: DocKind, title = '', subtitle = ''): string {
  const fecha = fechaHoy()
  if (kind === 'presentacion') {
    const t = title || 'Título de la presentación'
    return `---
tipo: presentacion
titulo: ${q(t)}
fecha: ${q(fecha)}
---

@diseño: portada
@etiqueta: ETIQUETA DE LA PRESENTACIÓN

# ${t}

${subtitle || '**Una frase** que resume de qué va y **por qué importa**.'}

---

@etiqueta: PRIMER BLOQUE

## Título de la diapositiva

::: tarjetas 2
### Primera idea {icon=reloj}
Explicación corta en una o dos líneas.

### Segunda idea {icon=equipo}
Explicación corta en una o dos líneas.
:::

---

@diseño: cierre

## ¿Hablamos?

**Búho AI** · buhoai.es
`
  }
  const t = title || 'Título del documento'
  return `---
tipo: documento
titulo: ${q(t)}
subtitulo: ${q(subtitle || 'Una frase que resume el documento.')}
etiqueta: "TEMA · SUBTEMA"
destinatario: "DOCUMENTO DE APOYO PARA EMPRESAS"
fecha: ${q(fecha)}
autor: "Búho AI"
---

## Primera sección

Texto normal en **Markdown**. Las listas, tablas, *cursivas* y [enlaces](https://buhoai.es) funcionan como siempre.

::: caja icon=bombilla
**Idea clave.** Una caja destacada para lo que no se puede perder.
:::

## Segunda sección

::: tarjetas 3
### Ahorro {icon=reloj}
Horas que se recuperan cada semana.

### Calidad {icon=check}
Menos errores en tareas repetitivas.

### Equipo {icon=equipo}
Personas centradas en lo que aporta.
:::
`
}
