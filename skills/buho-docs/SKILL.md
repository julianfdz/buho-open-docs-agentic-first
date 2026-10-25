---
name: buho-docs
description: Crear y editar documentos PDF (A4, con portada) y presentaciones en PDF (diapositivas 16:9 apaisadas) con el estilo Búho AI usando Búho Docs y su CLI `buho-docs`; se escriben en Markdown y el usuario ve cada cambio en directo con historial firmado. Úsala SIEMPRE que el usuario pida un documento, informe, propuesta, guía, dossier, one-pager, ficha, acta o presentación/deck/diapositivas/slides en PDF, o quiera cambiar, corregir, ampliar o exportar uno de esos .md, aunque no mencione Búho Docs. Vale para cualquier agente con terminal (Claude, Codex, Copilot, Gemini, scripts).
---

# Búho Docs · guía para agentes

Búho Docs (de Buho Corps Systems) hace **documentos A4** y **presentaciones 16:9** en PDF con el estilo Búho (navy `#0A1F3A`, turquesa `#00C1B8`, Georgia en títulos, Calibri en el texto, portada con el árbol y el búho). Cada documento es un **archivo Markdown** (`.md`) con una cabecera YAML. El usuario lo tiene abierto en la app: ve tus cambios **en directo y resaltados**, corrige erratas en el editor, y todo queda en el **historial** con tu nombre.

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

`buho-docs status` dice si responde. **Si la app está cerrada, el CLI la abre solo** (`--no-launch` para evitarlo). Esta guía la imprime `buho-docs skill`. Añade `--json` a cualquier comando para procesar la salida.

## 2. Flujo recomendado

**Crear:**
1. Escribe el Markdown completo en un archivo temporal (con tu herramienta de escribir archivos) siguiendo §4–§6.
2. `buho-docs new "C:\ruta\Mi documento.md" --file borrador.md --author Claude` (o `--kind presentacion --title "…"` para partir de la plantilla). Se abre en la app.
3. `buho-docs check "C:\ruta\Mi documento.md"`: páginas o diapositivas y avisos (diapositivas que no caben, iconos o imágenes que no existen). Corrige lo que salga.
4. `buho-docs export "C:\ruta\Mi documento.md"` → PDF junto al `.md`. Díselo al usuario con la ruta.

**Cambiar lo que ya existe:**
1. `buho-docs outline <doc>` (títulos y diapositivas con su línea) y `buho-docs read <doc> --lines` si necesitas el texto.
2. El cambio más pequeño que sirva (§3). Si el usuario acaba de escribir en la app, el CLI guarda antes lo suyo: no se pierde nada.
3. `check` y, si te lo piden, `export`.

**Editar el archivo con tus propias herramientas** (Edit/Write) también vale: la app lo detecta y lo enseña en directo. Firma antes para que el historial diga quién fue: `buho-docs tag <doc> --author Claude` (vale para el siguiente guardado).

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
buho-docs history <doc.md> | diff <doc.md> [id] | restore <doc.md> <id>
buho-docs show <doc.md> [--line N]              # llevar al usuario a esa parte
buho-docs tag <doc.md> --author Claude          # firmar tu próxima edición directa del archivo
buho-docs docs | templates | status | skill
```

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
::: cita                          # cita grande en Georgia
```

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
- Documentos de cara a cliente: sin precios internos ni enlaces privados salvo que el usuario lo pida.
- Tras un cambio grande, `buho-docs show <doc> --line N` lleva al usuario a lo que has hecho.
- Para volver atrás: `history` → `restore <id>` (la vuelta también queda en el historial).
