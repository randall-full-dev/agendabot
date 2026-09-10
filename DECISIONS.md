# DECISIONS · agendabot

> El **por qué**. Cada decisión de peso, con lo que se descartó y la razón.
> Aquí no se explica cómo está el código hoy (eso es `README.md`) ni qué falta
> (eso es `TODO.md`): se explica por qué se eligió lo que se eligió.

| Sí va aquí | No va aquí |
| --- | --- |
| Decisiones tomadas y su razón | El estado actual del código → `README.md` |
| Lo que se evaluó y **se descartó**, con el porqué | Lo que falta por hacer → `TODO.md` |
| El contexto que hoy no se ve en el código | Una lista de tareas terminadas (eso es `git log`) |

Es *append-only*: una decisión no se borra cuando cambia el mundo; se añade una
nueva entrada que la revisa. Orden cronológico, lo más viejo arriba.

---

## 2026-08-27 · Modelo de extracción: `claude-sonnet-5`

**Contexto.** El extractor convierte texto en un JSON de evento. El error
intolerable es una fecha equivocada sin aviso: una junta agendada el día que no es.

**Decisión.** `claude-sonnet-5` con `effort` medium, configurable por `.env`.

**Por qué.** Los tres candidatos, mismos 15 casos, una corrida cada uno:

| Modelo | Casos | Costo/mensaje |
| --- | --- | --- |
| `claude-haiku-4-5` (budget 8000) | 13/15 | 0.58¢ |
| `claude-sonnet-5` (effort medium) | 15/15 | 1.00¢ |
| `claude-opus-5` (effort medium) | 15/15 | 1.60¢ |

**Descartado.** Haiku falló "el miércoles que viene" (lo puso en jueves) — justo el
error intolerable. Opus resolvió ese caso con el prompt idéntico, o sea que era hueco
de capacidad, no de instrucciones. Opus iguala a Sonnet en el banco pero cuesta 60%
más; no se justifica mientras Sonnet acierte. **Plan B barato:** si en uso real
aparece una fecha equivocada, `ANTHROPIC_MODEL=claude-opus-5` y nada más.

**Cabo suelto:** el banco de 15 casos ya no distingue Sonnet de Opus. → `TODO.md`.

## 2026-08-27 · Calendario destino: iCloud (CalDAV), no Google

**Contexto.** El producto es para el jefe del usuario, cuyo ecosistema es 100% iOS.
La agenda ya vive en su iCloud.

**Decisión.** iCloud vía CalDAV, con `tsdav` del lado de Node. Apple ID + contraseña
específica de app.

**Por qué.** Apple expone Calendario por CalDAV (protocolo estándar) y lo deja fuera
de la Protección de Datos Avanzada a propósito, para que siga funcionando. La auth es
menos fricción de arranque que el OAuth de Google (proyecto en Cloud Console, pantalla
de consentimiento, refresh tokens).

**Descartado.** Google Calendar: no hay iPhone del jefe hacia dónde llevarlo, y OAuth
pesa más para un solo usuario. Queda en el backlog por si algún día hay multiusuario
(entonces OAuth deja de ser opcional: no puedes pedirle a 50 personas que generen
contraseñas de app). → `TODO.md`.

**Costo asumido.** No hay API oficial ni docs de Apple; los errores de CalDAV son
opacos. **La decisión es reversible barata:** el extractor no sabe a dónde va el
evento; cambiar a Google es reescribir `src/calendar.js` y nada más.

## 2026-09-08 · Credenciales de Apple: cuenta prestada + calendario dedicado

**Contexto.** El usuario no pudo crear un Apple ID propio para pruebas: Apple no le
enviaba el código de verificación por SMS tras días de intentos, varias redes y
dispositivos. Consiguió credenciales de un tercero (no el jefe).

**Decisión.** Usar esa cuenta **solo para pruebas**, y escribir los eventos a un
calendario dedicado `agendabot-pruebas`, no a los reales de esa persona.

**Por qué.** Una contraseña de app no está acotada al calendario: abre correo,
contactos, fotos. El calendario aparte es lo más cerca de un alcance limitado que
permite el sistema — disciplina nuestra, no barrera técnica. Y evita ensuciar la
agenda real de alguien con eventos de prueba.

**Detalle operativo.** El calendario hubo que crearlo desde `icloud.com/calendar` en
el navegador; creado desde el iPhone quedaba en un calendario local que no sincroniza
por CalDAV.

**Para producción.** El jefe generará su propia contraseña de app y pasará solo esos
16 caracteres — nunca su contraseña de Apple ID. Mismo patrón para WhatsApp. → `TODO.md`.

## 2026-09-10 · Horas en iCalendar: hora de pared con TZID, no UTC

**Contexto.** El primer evento de prueba se veía una hora corrido en icloud.com y en
el panel de edición.

**Decisión.** Escribir `DTSTART;TZID=America/Mexico_City:20260910T100000` (hora de
pared con su zona), no un instante UTC (`...Z`).

**Por qué.** La base de zonas horarias de iCloud está desactualizada: en 2026 todavía
le aplica horario de verano a Ciudad de México, abolido en 2022. Con un instante UTC,
iCloud lo desconvierte con esas reglas viejas y pinta el evento 1h corrido. Con hora
de pared, se convierte y desconvierte con las mismas reglas (buenas o malas) y el
error se cancela: "las 10:00" se ven a las 10:00 en la web, el iPhone y cualquier
cliente. Es además lo que la persona quiso decir. Verificado creando un evento a mano
en iCloud y leyendo que guarda exactamente ese formato.

**Descartado.** UTC (el intento inicial). No se manda bloque `VTIMEZONE`: iCloud
reconoce los nombres IANA y anexa su propia definición al guardar.

## 2026-09-10 · Entrada por WhatsApp: Meta Cloud API, no Baileys

**Contexto.** Hacía falta recibir los mensajes del usuario en el servidor.

**Decisión.** Meta Cloud API (la vía oficial).

**Por qué.** Cero riesgo de suspensión del número, estable, documentada; recibir y
responder dentro de 24h es gratis para este uso.

**Descartado.** Baileys (cliente no oficial que se vincula por QR): viola los términos
de WhatsApp y el número puede ser suspendido. Sobre el número personal del jefe, ese
riesgo es suyo, no nuestro para asumirlo. Se aceptó a cambio el trámite inicial en
developers.facebook.com y que el bot viva en un chat propio en vez de integrarse al
flujo de "notas a uno mismo".

## 2026-09-10 · `notas` no se escribe en el evento del calendario

**Contexto.** El JSON del evento trae un campo `notas` que explica qué fue ambiguo del
mensaje cuando la confianza no es alta.

**Decisión.** `notas` alimenta la pregunta de confirmación en WhatsApp, pero **no** se
escribe en el evento de iCloud.

**Por qué.** Al evento ya creado no le sirve a nadie saber que hubo una duda al
capturarlo. Es material para la conversación, no para el calendario.
