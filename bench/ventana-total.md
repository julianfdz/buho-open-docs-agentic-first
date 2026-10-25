# Ventana total: de pedirlo a tener el PDF corregido

`velocidad.mjs` mide solo el tiempo de máquina (pintar e imprimir), y ahí los dos caminos salen parecidos: menos de medio segundo. Lo que de verdad tarda es el **agente**: escribir el texto, hacer las llamadas a herramientas y comprobar el resultado. Esta es la cuenta completa para un documento de 20 páginas y 5 arreglos.

## Supuestos

- El modelo escribe unos **50 tokens/s**. En español, 1 token son unos 3,5 caracteres.
- Cada turno del agente (llamada a una herramienta y vuelta) cuesta unos **3 s**, aparte de lo que escribe.
- Documento de 20 páginas: `bench/generar.mjs`, 55 KB de Markdown, unos **16.000 tokens**. El contenido es el mismo en los dos caminos.
- Script de siempre: el contenido va metido en el código Python más estilos, portada, cabecera y pie. Es la referencia de los scripts reales de Búho: el de *Alfabetización en IA* ocupa 11,7 KB para dos páginas, unas 4 veces su texto. Para 20 páginas cuento **+8.000 tokens** sobre el contenido.
- Para comprobar el script hay que convertir las páginas a imagen y mirarlas: unos 1.300 tokens de entrada por página. Con Búho, `check` responde en texto y el usuario lo ve en directo.

## De cero a PDF

| | Búho Docs | Script de siempre |
|---|---|---|
| Escribir | 16.000 tokens · 320 s | 24.000 tokens · 480 s |
| Turnos | 3 (escribir .md, `new`, `check`) · 9 s | 8 (escribir, ejecutar, convertir a imágenes, mirar 20 páginas) · 24 s |
| Máquina | 0,6 s | 0,4 s |
| Comprobar | texto | ~26.000 tokens de imágenes |
| **Total** | **~5,5 min** | **~8,4 min** |
| Primer contenido a la vista | ~1 min, escribiendo por bloques con `batch` | al final, ~8 min |

## Los 5 arreglos

| | Búho Docs | Script de siempre |
|---|---|---|
| Cómo | 1 `batch` con los 5 cambios y luego `export` | 5 × (editar, ejecutar, convertir y mirar la página) |
| Turnos | 2 · 6 s | 20 · 60 s |
| Escribir | ~300 tokens · 6 s | ~500 tokens · 10 s |
| Máquina | 0,15 s + 0,1 s | 5 × 0,4 s |
| **Total** | **~12 s** | **~70 s** (y más si el cambio mueve el texto de varias páginas) |

## En resumen

- **Crear: un 35 % menos de tiempo** (unos 3 minutos menos). Lo que no se puede recortar es que el modelo escriba el contenido, y es igual en los dos caminos.
- **Corregir: unas 6 veces más rápido** (12 s frente a 70 s) y sin gastar tokens en imágenes.
- **Ver avanzar**: con Búho se ve el documento crecer desde el primer minuto. Con un generador enchufado (`buho-docs stream --claude`), las palabras aparecen mientras el modelo las escribe.
- No cuento las vueltas típicas del script cuando falla la maquetación (texto que se sale, tablas cortadas), que en la práctica añaden varios turnos. Búho las evita porque la plantilla ya está hecha y probada.
