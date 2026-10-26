---
name: buho-docs
description: Crear y editar documentos PDF (A4) y presentaciones en PDF (diapositivas 16:9 apaisadas) con Búho Docs y su CLI `buho-docs`, con el estilo Búho AI o en blanco (sin marca); se escriben en Markdown, el usuario los ve y retoca en directo como en Word, y se pueden generar en paralelo con varios modelos. Úsala SIEMPRE que el usuario pida un documento, informe, propuesta, guía, dossier, one-pager, ficha, acta o presentación/deck/diapositivas/slides en PDF, o quiera cambiar, corregir, ampliar o exportar uno de esos .md, aunque no mencione Búho Docs. Vale para cualquier agente con terminal (Claude, Codex, Copilot, Gemini, scripts).
---

# Búho Docs · guía para agentes

Búho Docs (de Buho Corps Systems) hace **documentos A4** y **presentaciones 16:9** en PDF, con el estilo Búho (navy `#0A1F3A`, turquesa `#00C1B8`, Georgia y Calibri, portada con el árbol y el búho) o **en blanco** (`estilo: blanco`: sin marca ni portada, como un documento nuevo de Word). Cada documento es un **archivo Markdown** (`.md`) con una cabecera YAML. El usuario lo tiene abierto en la app y **escribe directamente sobre la página** (negrita, títulos, listas…); ve tus cambios **en directo y resaltados**, y todo queda en el **historial** con tu nombre.

- **Agentic first**: todo se hace con el comando `buho-docs`. No hace falta MCP.
- **Cambia solo lo necesario**: usa `section`, `slide`, `replace`, `meta` en vez de reescribir el documento entero. Es más rápido y el usuario ve exactamente qué has tocado.
- **Firma siempre**: `--author TuNombre` (Claude, Codex, Copilot…).
- El PDF se exporta con `buho-docs export`: es lo que el usuario envía.

## 1. Cómo invocar el CLI

| Dónde | Comando |
|---|---|
| Cualquier terminal (tras instalar la app, está en el PATH del usuario) | `buho-docs …` |
| PowerShell / cmd, ruta completa | `& "$env:LOCALAPPDATA\Programs\BuhoDocs\cli\buho-docs.cmd" …` |
| Git Bash / WSL, ruta completa | `"$LOCALAPPDATA/Programs/BuhoDocs/cli/buho-docs" …` |
| Versión portable (carpeta descomprimida) | `<carpeta>\cli\buho-docs.cmd …` o `<carpeta>/cli/buho-docs …` |
| Repositorio del proyecto (desarrollo) | `node bin/buho-docs.mjs …` |

`buho-docs status` dice si responde. **Si la app está cerrada, el CLI la abre solo** (`--no-launch` para evitarlo). Con la app abierta, `buho-docs` (un ejecutable nativo) le pasa el comando y la app lo ejecuta por dentro: ~45 ms por comando, y puedes lanzar muchos a la vez. Esta guía la imprime `buho-docs skill`. Añade `--json` a cualquier comando para procesar la salida.

## 2. Flujo recomendado

**Crear de una frase (lo más rápido):** `buho-docs generar informe.md "de qué va, para quién" --paginas 10 [--tema corporativo]` (o `--kind presentacion`). Un modelo rápido hace el índice y luego cada sección la escribe otro modelo a la vez, en directo. ~10 páginas en ~40 s. Después repasa con `mapa`, `buscar` y `editar`/`batch`.

**Importar algo que ya existe (Word, PDF, HTML, texto):** `buho-docs importar archivo.docx [--salida doc.md] [--tema id]`. Word sale bien al momento (títulos, listas, tablas, negritas, imágenes). Los PDF se maquetan con IA en paralelo (sus tablas no se recuperan con reglas); `--rapido` solo convierte. Por defecto se guarda en Documentos\Buho Docs: el original no se toca.

**Exportar a Office y a Google:** `buho-docs export doc.md --word` (.docx con estilos de título reales, listas, tablas, cajas, tarjetas, cifras, índice, portada, cabecera y pie) y `buho-docs export deck.md --pptx` (PowerPoint con cada diapositiva en su diseño, formas, tablas, notas del orador). Los `::: grafico` van como gráficos nativos, editables. Lo que se envía tal cual sigue siendo el PDF.

**Revisión (cuando el usuario quiere aprobar los cambios):** añade `--proponer` a cualquier cambio (section, replace, editar, batch…) y queda como propuesta que el usuario acepta o rechaza en el panel Revisión de la app, sin tocar el archivo. Con `buho-docs revision doc.md si` todo cambio de un agente llega así. El usuario también deja comentarios en la página («quita esto», «mete algo así»): léelos con `buho-docs comentarios doc.md --abiertos` (cada uno trae su bloque `#id` y su Markdown), haz el cambio (mejor con `--proponer --comentario <id>`) y `buho-docs responder doc.md <id> "Hecho: …" --resolver`. O todos de golpe: `buho-docs atender doc.md` lanza un agente por bloque comentado, a la vez, y deja propuestas (`--directo` para escribirlas).

**Borradores sin guardar:** `buho-docs nuevo [nombre] [--plantilla acta] [--tema id] [--file c.md]` crea un documento sin elegir dónde (imprime su ruta) y se abre en la app como «sin guardar»; se trabaja con él igual que con cualquier .md (append, section, export…) y cuando esté listo `buho-docs guardar <ruta-del-borrador> <destino.md>`. Si nadie lo guarda, sigue ahí al volver a abrir la app. Úsalo cuando el usuario no ha dicho dónde quiere el documento.

**Crear escribiéndolo tú:**
1. Escribe el Markdown completo en un archivo temporal (con tu herramienta de escribir archivos) siguiendo §4–§6.
2. `buho-docs new "C:\ruta\Mi documento.md" --file borrador.md --author Claude` (o `--kind presentacion --title "…"` para partir de la plantilla). Se abre en la app.
3. `buho-docs check "C:\ruta\Mi documento.md"`: páginas o diapositivas y avisos (diapositivas que no caben, iconos o imágenes que no existen). Corrige lo que salga.
4. `buho-docs export "C:\ruta\Mi documento.md"` → PDF junto al `.md`. Díselo al usuario con la ruta.

**Cambiar lo que ya existe (la forma rápida, con ids):**
1. `buho-docs mapa <doc>`: secciones con su id (`#b…`) y cuántos tokens ocupa cada una. **No leas el documento entero** si no hace falta.
2. `buho-docs buscar <doc> "de qué se habla"` (o `--carpeta` para varios documentos): los bloques que tratan eso, con su id y un fragmento. Es determinista (palabras, frase exacta y parecido para erratas), sin modelos, en milisegundos.
3. `buho-docs leer <doc> --seccion "Título" --ids [--max 2000]`: solo esa parte, en texto limpio y con el id de cada bloque.
4. `buho-docs editar <doc> #bxxxx --file nuevo.md` cambia ese bloque exacto (o `--mode before|after|delete`). Varios a la vez: `batch` con `{"op":"block","id":"bxxxx","content":"…"}`.
5. `check` y, si te lo piden, `export`.

Los ids salen del texto de cada bloque: no cambian al editar otras partes, pero sí el del bloque que cambias. Si un id ya no existe, vuelve a `mapa` o `buscar`. Si el usuario acaba de escribir en la app, el CLI guarda antes lo suyo: no se pierde nada.

**Editar el archivo con tus propias herramientas** (Edit/Write) también vale: la app lo detecta y lo enseña en directo. Firma antes para que el historial diga quién fue: `buho-docs tag <doc> --author Claude` (vale para el siguiente guardado).

**Para ir rápido (lo que más tiempo cuesta son tus turnos, no la app):**
- **Varios cambios = un solo `batch`.** Cinco erratas o retoques van en una lista JSON y en una llamada (y en una sola entrada del historial). Si uno falla, no se aplica ninguno.
- **Documentos largos, por bloques**: crea el documento con las primeras secciones y añade el resto con `batch` (2-4 secciones por llamada). El usuario lo ve crecer en vez de esperar al final.
- **Comprueba en texto, no con imágenes**: `check` dice páginas y avisos. No conviertas el PDF a imágenes. Si de verdad necesitas mirar algo visual, `snapshot --page N` da el PNG de esa página solo.
- **El PDF ya está hecho**: tras cada cambio la app lo prepara en segundo plano; `export` solo lo escribe (~0,1 s).
- **Lo lento es escribir el texto, no la app.** Para documentos largos o presentaciones, `generar` con un plan: cada sección (o diapositiva) la escribe un modelo distinto **a la vez**, en directo, en su sitio. 12 secciones (~14 páginas) en ~25 s; 8 diapositivas en ~13 s. Tú haces el plan (índice + qué contar en cada parte) y luego repasas con `batch`.
- **Reutiliza en vez de generar**: `bloques` + `insertar` mete piezas ya maquetadas (cajas, tarjetas, tablas, pasos…); texto que ya existe se pega con `write`/`append` sin volver a generarlo.
- **No te bloquees esperando**: si una imagen, un gráfico o un texto lo prepara otro agente o una API, pon un `hueco` con id (se ve como «generándose») y sigue; cuando esté, `rellenar <doc> <id> --imagen archivo.png`.

## 3. Comandos

```bash
buho-docs new <doc.md> [--kind documento|presentacion] [--title "…"] [--subtitle "…"] [--file contenido.md]
buho-docs open <doc.md>                         # abrirlo y enseñarlo
buho-docs read <doc.md> [--lines]               # contenido (con números de línea)
buho-docs outline <doc.md>                      # títulos (#N) y diapositivas con su línea
buho-docs section <doc.md> "Título" --file parte.md [--mode body|replace|append|before|after|delete]
buho-docs slide <doc.md> <n> --file diapo.md [--mode replace|insert|delete|move] [--to N]
buho-docs replace <doc.md> "texto exacto" "texto nuevo" [--all]
buho-docs append <doc.md> --file mas.md
buho-docs meta <doc.md> <campo> ["valor"]       # cabecera (sin valor la quita)
buho-docs write <doc.md> --file entero.md       # reescribir todo (solo si cambia casi todo)
buho-docs check <doc.md>                        # páginas/diapositivas y avisos
buho-docs export <doc.md> [--out archivo.pdf]   # PDF (por defecto junto al .md)
buho-docs export <doc.md> --word [--out x.docx]  # Word editable (.docx)
buho-docs export <deck.md> --pptx               # PowerPoint editable (.pptx)
buho-docs <cambio> … --proponer                 # propuesta en vez de escribir (el usuario acepta o rechaza)
buho-docs revision <doc.md> [si|no]             # modo revisión: todo cambio de la IA llega como propuesta
buho-docs propuestas <doc.md> · aceptar|rechazar <doc.md> <id|todas>
buho-docs comentarios <doc.md> [--abiertos]     # comentarios del usuario, con su bloque #id
buho-docs comentar <doc.md> "texto" --cita "…"  # (o --bloque #b… / --linea N)
buho-docs responder <doc.md> <id> "…" [--resolver]
buho-docs atender <doc.md> [--directo]          # un agente por bloque comentado, en paralelo
buho-docs nuevo [nombre] [--plantilla id] [--tema id] [--file c.md]  # borrador sin guardar → imprime su ruta
buho-docs guardar <borrador.md> <destino.md>    # guardar un borrador
buho-docs history <doc.md> | diff <doc.md> [id] | restore <doc.md> <id>
buho-docs show <doc.md> [--line N]              # llevar al usuario a esa parte
buho-docs tag <doc.md> --author Claude          # firmar tu próxima edición directa del archivo
buho-docs batch <doc.md> --file cambios.json    # varios cambios de una vez (crea el .md si no existe)
buho-docs stream <doc.md> [--section "T"] [--mode body|append|after|write] [--claude] < texto
buho-docs snapshot <doc.md> [--pages 1-3,8|todas] [--width 900] [--out p.png | --dir carpeta]   # PNG de páginas (de una vez)
buho-docs generar <doc.md> --plan plan.json [--modelo haiku] [--paralelo 8]   # secciones/diapositivas en paralelo
buho-docs bloques | insertar <doc.md> <bloque> [--despues "Título"]           # bloques ya maquetados
buho-docs huecos <doc.md> | rellenar <doc.md> <id> (--imagen f.png [--ancho 80%] | --file c.md | --text "…")
buho-docs indice <doc.md> [--niveles 2|3] [--quitar]                         # índice con números de página
buho-docs mapa <doc.md> [--bloques]                    # secciones (y bloques) con id y tokens
buho-docs paginas <doc.md>                             # cuántas páginas y qué trae cada una (tokens, títulos)
buho-docs pagina <doc.md> <n> [--captura]              # el texto de esa página tal como sale (y su PNG)
buho-docs importar <archivo.docx|.pdf|.html|.txt> [--salida doc.md] [--tema id] [--rapido]
buho-docs generar <doc.md> "de qué va" [--paginas 10] [--kind presentacion] [--tema id]
buho-docs buscar <doc.md> "consulta" | buho-docs buscar "consulta" --carpeta <carpeta>
buho-docs leer <doc.md> [--seccion "T" | --bloque #id | --desde #id] [--max 2000] [--ids]   # texto limpio
buho-docs bloque <doc.md> #id                          # un bloque (texto y Markdown)
buho-docs editar <doc.md> #id --file nuevo.md [--mode replace|before|after|delete]
buho-docs plantillas | new <doc.md> --plantilla factura [--tema corporativo]
buho-docs temas | tema <doc.md> <id> | tema crear <id> --principal "#rrggbb" --acento "#rrggbb" [--logo logo.png] [--marca "…"] [--portada simple|ninguna]
buho-docs docs | templates | status | skill
```

`batch`: un array JSON (o un objeto por línea). Cada cambio es como el comando del mismo nombre; el texto va en `content` o, mejor, en `file` (ruta a un .md, sin escapar saltos de línea):

```json
[
  {"op": "replace", "find": "efiencia", "replace": "eficiencia"},
  {"op": "replace", "find": "12,5 %", "replace": "18 %", "all": true},
  {"op": "section", "heading": "Ventas", "file": "ventas.md", "mode": "body"},
  {"op": "slide", "n": 3, "file": "diapo3.md", "mode": "replace"},
  {"op": "meta", "key": "titulo", "value": "Nuevo título"},
  {"op": "append", "file": "anexo.md"},
  {"op": "write", "file": "entero.md"}
]
```

`generar`: plan en JSON. Documento: `secciones`; presentación: `diapositivas` (con `diseno` y `etiqueta` opcionales). Crea el documento si no existe (o añade al final), pone un hueco por parte y lanza un `claude -p` por cada una, `--paralelo` a la vez:

```json
{
  "tipo": "documento", "estilo": "buho", "titulo": "Guía de IA para el equipo", "subtitulo": "…", "etiqueta": "…",
  "contexto": "para quién es, tono, datos del cliente…", "palabras": 500,
  "secciones": [
    {"titulo": "1. Qué es la IA generativa", "pide": "explicación sencilla, qué hace bien y qué no"},
    {"titulo": "2. Herramientas", "pide": "…", "palabras": 700}
  ]
}
```

`stream`: escribe en directo lo que llega por la entrada estándar (al final del documento, en el cuerpo de una sección con `--section`, o el documento entero con `--mode write`). Sirve para encadenar un generador de texto: `claude -p "…" --output-format stream-json --include-partial-messages --verbose | buho-docs stream informe.md --section "Ventas" --claude --author Claude`.

- El texto nuevo va con `--file <ruta>` (recomendado: sin problemas de comillas ni saltos de línea), `--text "…"` (una línea) o `-` (entrada estándar).
- `section`: busca el título sin importar mayúsculas ni tildes; también `#3` = tercer título de `outline`. `--mode body` (por defecto) mantiene el título y cambia lo de debajo; `replace` cambia también el título; `append` añade al final de la sección; `before`/`after` insertan un bloque nuevo; `delete` la quita. La sección llega hasta el siguiente título de su nivel o superior.
- `slide`: `replace` (por defecto) sustituye la diapositiva n entera, directivas incluidas; `insert` la mete en la posición n (0 = al final); `delete`; `move --to N`. El archivo de `--file` es una diapositiva sin el `---`.
- `replace`: texto **exacto**. Si aparece varias veces falla y no toca nada: añade contexto o usa `--all`. Ideal para erratas y cifras.
- Rutas con espacios, entre comillas. Todo devuelve error claro si algo no cuadra; nada se escribe a medias.

## 4. Documento A4

```markdown
---
tipo: documento
titulo: "Beneficios de la IA por departamento en una pyme"
subtitulo: "Dónde ahorra horas y por dónde empezar."
etiqueta: "INTELIGENCIA ARTIFICIAL · GUÍA PARA PYMES"   # línea turquesa sobre el título
destinatario: "DOCUMENTO DE APOYO PARA EMPRESAS"
fecha: "Octubre de 2026"
autor: "Búho AI"
lugar: "Murcia"
cabecera: "Tema  |  Subtema  |  Octubre 2026"          # derecha de la cabecera de cada página
pie: "Búho AI · Tu equipo técnico de IA · buhoai.es"   # izquierda del pie (este es el de serie)
pie-derecha: "Formación en IA bonificable por FUNDAE"  # antes del número de página
nota-pie: "Documento informativo. No constituye asesoramiento jurídico."  # centrada, abajo
portada: true                                          # false = sin portada
---

## La respuesta corta
Texto…
```

- Portada automática con logo, etiqueta, título, subtítulo, destinatario, fecha · autor · lugar y el árbol.
- Usa `##` para las secciones (Georgia navy), `###` para apartados. `\pagebreak` fuerza un salto de página.
- Las tablas Markdown salen con cabecera navy. Las imágenes: `![](imagen.png)` (ruta relativa al `.md`) y `{width=60%}` al final del párrafo para el ancho.
- Comillas: escribe «» o "" (las rectas se convierten en «»).

**Tema** (`tema:` en la cabecera; `estilo:` también vale): `buho` (por defecto), `blanco` (sin marca), `corporativo`, `calido`, `moderno` o uno propio del usuario (`buho-docs temas`). Un tema es un paquete: colores, letras, logo, marca de la cabecera y tipo de portada (`arbol`, `simple` o `ninguna`); `portada: false` la quita en un documento concreto. `css: mi-estilo.css` añade una hoja de estilo propia.

**Plantillas** para arrancar rápido (se crean con el tema que se diga): acta, factura, presupuesto, propuesta, informe, carta, guía, one-pager, plan de proyecto, currículum; presentaciones: pitch, formación, resultados. `buho-docs new informe.md --plantilla informe --tema buho`; luego rellena los [corchetes] con `batch` o `editar`.

**Índice**: `buho-docs indice <doc>` mete al principio un índice automático con los títulos y su número de página (se actualiza solo).

## 5. Bloques (documentos y diapositivas)

```markdown
::: caja icon=bombilla            # caja turquesa clara; variantes: navy, gris, aviso, blanca
**Idea clave.** Texto.
:::

::: tarjetas 2                    # tarjetas con icono (2, 3 o 4 por fila); cada ### abre una
### Ventas {icon=ventas}
Texto corto.
### Marketing {icon=megafono}
Texto corto.
:::

::: cifras 3                      # cifras grandes: la negrita del principio es el número
- **8** departamentos con usos claros
- **90** días para medir
:::

::: pasos                         # pasos numerados (cada ### es un paso); `pasos horizontal` en fila
### Formar al equipo
Texto.
:::

::: columnas                      # columnas: +++ separa
Izquierda
+++
Derecha
:::

::: panel                         # panel navy con apartados (cada ###)
TRES ITINERARIOS
### Empleados
Introducción a la IA
:::

::: nota                          # texto pequeño gris (fuentes, aclaraciones)
::: hueco id=grafico texto="Gráfico de ventas"   # se rellena después con rellenar (no bloquea)
:::
::: indice niveles=2              # índice automático con números de página
:::
::: cita                          # cita grande en Georgia

::: grafico barras titulo="Horas ahorradas al mes"   # columnas (por defecto), barras, lineas, area, tarta, donut
| Área | Horas |                    # 1.ª columna = categorías; las demás = series (números: 20 %, 1.234,5 €…)
|---|---|
| Ventas | 85 |
:::
```

**Gráficos:** con una tabla dentro de `::: grafico` se dibuja solo (colores accesibles, valores en las barras); `unidad=%` o `unidad=€` si no se deduce. En Word y PowerPoint sale como gráfico nativo con sus datos. Dentro de `::: columnas` se dibuja estrecho. Datos reales del usuario o con fuente, nunca inventados.

**Iconos** `{icon=…}` en títulos y `icon=…` en cajas: cualquier nombre de [lucide.dev/icons](https://lucide.dev/icons) (`rocket`, `shield-check`…) o alias en español: cohete, escudo, reloj, bombilla, lupa, grafico, ventas, equipo, documento, ley, objetivo, engranaje, ajustes, chat, cerebro, red, megafono, calendario, carrito, dinero, finanzas, logistica, produccion, soporte, informatica, ia, rayo, alerta, ojo, bandera, libro, formacion, acuerdo, correo, telefono, web, seguridad, datos, nube, automatizar, robot, check, pregunta, euro, empresa, tienda, factura, contrato. `buho-docs check` avisa si uno no existe.

## 6. Presentación 16:9

```markdown
---
tipo: presentacion
titulo: "IA por departamento en pymes"     # sale en el pie de cada diapositiva
---

@diseño: portada
@etiqueta: INTELIGENCIA ARTIFICIAL PARA PYMES

# La IA, departamento a departamento

**Dónde ahorra horas** y por dónde empezar.

---

@etiqueta: QUÉ GANA CADA ÁREA

## De la dirección a la atención al cliente

::: tarjetas 2
### Dirección {icon=objetivo}
Informes en minutos.
:::
```

- Las diapositivas se separan con una línea `---` **con una línea en blanco antes**.
- Directivas al principio de cada diapositiva: `@diseño:` y `@etiqueta:` (texto turquesa en mayúsculas sobre el título); también `@fondo: turquesa|gris|navy`, `@alinear: arriba`, `@imagen: foto.png`, `@notas: …` (no salen en el PDF).
- Diseños (`@diseño:`): `portada` (por defecto la primera: logo, árbol, título grande), `normal` (por defecto el resto: título + contenido centrado en el alto), `seccion` (fondo navy, título grande: separa bloques), `cita`, `cierre` (fondo navy, para el final y el contacto), `dos-columnas`, `cifras`, `imagen`. En cualquier diapositiva, `+++` en una línea parte el contenido en columnas.
- Un título `##` por diapositiva (`#` en la portada). Título corto (una línea), **pocas palabras**: de 2 a 4 tarjetas, de 3 a 5 viñetas.
- Si algo no cabe, la vista lo marca en rojo y `check` lo dice: recorta o parte en dos diapositivas. **No entregues una presentación con avisos.**

## 7. Errores frecuentes

| Mensaje | Qué hacer |
|---|---|
| `No encuentro la sección «…»` | `buho-docs outline` y usa el título exacto o `#N`. |
| `Hay N secciones que encajan` | Título más completo o `#N`. |
| `«…» aparece N veces` | Más contexto en el texto a buscar, o `--all`. |
| `No existe la diapositiva N` | `outline` para ver cuántas hay. |
| `La diapositiva N no cabe` | Menos texto o pártela (`slide … --mode insert`). |
| `No puedo escribir …pdf: está abierto` | El PDF está abierto en un visor: ciérralo o `--out` con otro nombre. |
| `Búho Docs no está abierto` | La app no está instalada o se usó `--no-launch`. |
| `buho-docs` no se reconoce | Terminal nueva o ruta completa (§1). |

## 8. Buenas prácticas

- Escribe en español de España, claro y directo, como Búho: frases cortas, negritas para lo importante, nada de relleno.
- No inventes cifras ni estudios: si pones datos, que sean del usuario o con fuente en un `::: nota`.
- Tras un cambio grande, `buho-docs show <doc> --line N` lleva al usuario a lo que has hecho.
- Para volver atrás: `history` → `restore <id>` (la vuelta también queda en el historial).
