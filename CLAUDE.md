# CLAUDE.md · cómo se trabaja en agendabot

Reglas de trabajo de este repo. No describe qué es el proyecto (eso es `README.md`)
ni por qué se decidió algo (`DECISIONS.md`) ni qué falta (`TODO.md`): describe cómo
trabajar aquí. Es corto a propósito.

## Antes de tocar nada

Lee `README.md` (presente), `TODO.md` (futuro) y `DECISIONS.md` (porqués). Ahí está el
contexto que el código no muestra —por ejemplo, por qué las horas van como hora de
pared y no en UTC—; deshacer eso sin leer el porqué rompe cosas que ya costó arreglar.

## Los cuatro archivos de documentación, y su disciplina

- `README.md` = **presente**: cómo es hoy. Cita archivos (no líneas: sin un test que
  las vigile, las líneas se desfasan y mienten).
- `TODO.md` = **futuro**: lo pendiente. **Lo terminado se borra de aquí** — su rastro
  queda en `git log`.
- `DECISIONS.md` = **porqué**: decisiones y lo descartado. Es *append-only*: una
  decisión que cambia se revisa con una entrada nueva, no se borra la vieja. No es una
  lista de tareas hechas.
- `CLAUDE.md` = este archivo: cómo se trabaja.

Cuando termines algo, muévelo al archivo que le toca: el qué al README si cambió el
presente, el porqué a DECISIONS si hubo una decisión, y bórralo del TODO.

Mantenlo a escala ligera: sin IDs con sufijo, sin Jira, sin tests de citas. Eso se
gana si el proyecto crece o entra más gente; hoy sería ceremonia.

## Secretos

- Nunca imprimir el **valor** de una variable del `.env`. Para verificar, comprobar
  formato o longitud sin ecoar el contenido (ej. `grep -c "^ANTHROPIC_API_KEY=sk-ant"`).
- El `.env` está en `.gitignore` y no se sube. Antes de un commit que toque archivos
  versionados, confirmar que no se coló ningún token, llave o ID real.
- El token de WhatsApp del panel de pruebas caduca cada pocas horas: un 401 casi
  siempre es eso, no un bug. Regenerarlo en el `.env`, no perseguir el código.

## Al tocar el extractor

Correr `npm test` después de cambiar el prompt o el esquema de `src/extractor.js`. Los
16 casos son la red que evita romper una fecha o una hora sin darse cuenta. El prompt
es sensible: un cambio de redacción puede mover un caso.

## Idioma

Código, comentarios, mensajes de commit y nombres de variables en **español**, como
está el resto del repo. Los comentarios explican el porqué o una trampa, no lo que la
línea siguiente hace a simple vista.
