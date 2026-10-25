# Banco de velocidad · Búho Docs frente a script reportlab

25/10/2026, 20:45:07 · documento de 20 páginas (Búho) / 19 (script) · mediana de 3 rondas · CLI: BuhoDocs.exe en modo Node (como un agente con la app instalada)

## De cero a PDF

| Paso | Búho Docs | Script reportlab |
|---|---|---|
| Crear y verlo en pantalla | 0.12 s | — |
| Primer PDF | 0.51 s | 0.38 s |
| **Total** | **0.63 s** | **0.38 s** |

## Los 5 arreglos

| Arreglo | Búho: cambio en vivo | Búho: maquetar 20 págs | Búho: PDF justo después | Script: regenerar PDF |
|---|---|---|---|---|
| Errata | 0.10 s | 0.04 s | 0.41 s | 0.38 s |
| Cifra en una tabla | 0.10 s | 0.04 s | 0.42 s | 0.37 s |
| Reescribir una sección | 0.10 s | 0.03 s | 0.41 s | 0.36 s |
| Cambiar el título | 0.11 s | 0.03 s | 0.42 s | 0.38 s |
| Añadir sección final | 0.10 s | 0.03 s | 0.42 s | 0.37 s |
| **Total** | **0.52 s** | | **2.08 s** | **1.86 s** |

- Búho, 5 arreglos en vivo y un PDF al final: **0.94 s**. Script, regenerando tras cada arreglo: **1.86 s**.
- Caso normal con un agente (el modelo tarda un momento en escribir el siguiente comando): cambio 0.11 s y PDF **0.10 s** (ya estaba hecho en segundo plano: solo se escribe).
- Coste fijo de una llamada al CLI sin trabajo (`status`): 0.09 s.
- No cuenta lo que tarda el modelo en escribir: eso es igual o menor en Búho (un arreglo es un comando corto; con el script hay que editar el script y relanzarlo).
- Tampoco cuenta la verificación: con el script, para ver el resultado hay que convertir el PDF a imágenes y mirarlas; en Búho lo ves en directo y `check` avisa en texto.
