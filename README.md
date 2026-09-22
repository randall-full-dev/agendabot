# agendabot

Bot que convierte mensajes de WhatsApp en texto libre en eventos de calendario
(iCloud, vía CalDAV). Escribes "junta con el ingeniero el viernes a las 4 en la obra"
y aparece el evento en el calendario, con confirmación por el mismo chat.

> El **presente**: cómo es el sistema hoy. El porqué de cada decisión vive en
> `DECISIONS.md`; lo que falta, en `TODO.md`.

## Estado actual

Las tres fases del pipeline funcionan y están probadas de punta a punta: un WhatsApp
real crea el evento en iCloud y el bot responde por el chat.

**Corre como piloto autoalojado.** La máquina local hace de servidor: token de
WhatsApp permanente (usuario del sistema de Meta), URL pública fija
(`https://rm-lap-03.tail65c817.ts.net/webhook`, Tailscale Funnel) y arranque
automático del servidor al iniciar sesión (tarea programada `agendabot-servidor`,
ver `scripts/`). Vive mientras la computadora esté encendida; el hosting de pago
es la Fase 4b → `TODO.md`.

## El flujo

```
Mensaje de WhatsApp
      │  Meta Cloud API (webhook)
      ▼
src/index.js         orquesta todo
      │
      ▼
src/extractor.js     texto → JSON { titulo, fecha, hora, lugar, ... }  (Claude)
      │
      ▼
src/calendar.js      JSON → evento en iCloud (CalDAV)
      │
      ▼
src/whatsapp.js      responde por el mismo chat, confirmando
```

## El evento extraído

`src/extractor.js` define este esquema como JSON Schema y se lo pasa a la API como
salida estructurada: la respuesta se valida contra él antes de llegar al código, así
que nunca hay que parsear texto libre ni reintentar por JSON mal formado.

```json
{
  "titulo": "Junta de obra - Hospital X",
  "fecha": "2026-09-05",
  "hora_inicio": "16:00",
  "hora_fin": null,
  "lugar": null,
  "descripcion": "Llevar el reporte X para la siguiente sesión",
  "confianza": "alta",
  "notas": null
}
```

- `hora_fin`: si no se especifica, el evento dura 1 hora.
- `lugar`: solo si el mensaje lo menciona.
- `confianza`: `alta` | `media` | `baja`. Si no es `alta`, el bot pregunta antes de crear.
  Un caso que vale la pena conocer: **"el próximo/siguiente <día>" cuando ese día cae
  mañana o pasado** no es `alta` por mucho que parezca clara. Se resuelve al más cercano,
  pero el bot pregunta nombrando las dos fechas — ver `DECISIONS.md` (2026-09-22).
- `notas`: cuando la confianza no es `alta`, **la pregunta que hay que hacerle a quien
  escribió**, redactada para que él la lea tal cual en el chat ("¿Es a las 4 de la tarde
  o de la mañana?"). El bot la reenvía sin tocarla. **No se escribe en el evento.**
- `fecha` y `hora_inicio` pueden venir `null`. Un campo vacío es correcto; uno
  inventado rompe la agenda.

## Módulos

| Archivo | Qué hace |
| --- | --- |
| `src/extractor.js` | Texto → JSON validado, con Claude (`claude-sonnet-5`). No sabe de WhatsApp ni de calendarios. |
| `src/calendar.js` | JSON → evento CalDAV en `caldav.icloud.com`. No sabe de dónde salió el JSON. |
| `src/agendar.js` | Conecta extractor + calendar por CLI: texto → evento, en un comando. |
| `src/whatsapp.js` | El idioma de Meta: verificación del webhook, firma HMAC, extracción de mensajes, envío de respuestas. |
| `src/index.js` | El servidor: webhook → extractor → calendar → respuesta. Dedup de reintentos, lista de números permitidos, regla de confianza, y cómo le habla el bot al usuario. |
| `test/casos.js` · `test/probar.js` | 16 mensajes de ejemplo con su resultado esperado, y el banco que los corre. |

**Detalle de `calendar.js`:** las horas se escriben como hora de pared con zona
(`DTSTART;TZID=America/Mexico_City:...`), no como UTC. El porqué (un bug de la base de
zonas de iCloud) está en `DECISIONS.md` — no deshacer sin leerlo.

**Contestar al bot.** Cuando el bot pregunta y la persona responde, esa respuesta no
se procesa sola: `index.js` guarda el mensaje original junto al evento pendiente y le
manda ambos al extractor. Sin eso, un "el 30" a secas no tiene título, ni hora, ni
lugar, y producía un "Evento por confirmar" de día completo. El modelo decide si la
respuesta corrige la cita anterior o si describe una distinta. El contexto viaja en el
mensaje de usuario, no en el prompt del sistema, para que el banco de pruebas reciba
exactamente lo mismo que antes.

**Cómo habla el bot.** Las frases que lee el usuario viven en `index.js` y van con sus
acentos: no pasan por la API, así que escribirlas bien no cuesta nada. La confirmación
dice la fecha en palabras ("el jueves 24 de septiembre, a las 4:00 p.m.", y "hoy" o
"mañana" cuando toca) y enumera los avisos que de verdad quedaron puestos, no una frase
genérica. Cuando falta un dato, la pregunta la escribe el extractor en `notas` dirigida
al usuario, y el bot la reenvía tal cual.

Los saludos y agradecimientos exactos ("hola", "gracias", "¿qué tal?") se contestan en
local, sin llamar al modelo: son gratis e instantáneos. La lista es de coincidencia
exacta a propósito — cualquier atajo más listo se comería un "nos vemos mañana en la
obra", que sí es una cita.

**Recordatorios:** todos los eventos se crean con aviso; no hay forma de pedir uno sin
él. Una cita con hora avisa **1 día, 1 hora y 15 minutos antes**; una de día completo,
a las **9:00 del día anterior y a las 9:00 del mismo día** (a la medianoche, que es
cuando empieza, nadie mira el teléfono). Las anticipaciones son constantes al principio
de `calendar.js`.

De esa escalera se descartan los avisos que ya pasaron y los que caerían a menos de
cinco minutos de haber agendado: no avisan de nada —el chat con el bot sigue abierto— y
le quitan el lugar al que sí serviría. Si así se cae la escalera entera, que es el caso
de "nos vemos en media hora", entra un **aviso de rescate**: uno solo, a la mitad del
tiempo que falta, con tope de quince minutos. Una cita dentro de 11 minutos avisa a los
5; dentro de 30, a los 15. Por debajo de dos minutos ya no se pone nada, porque no
llegaría a tiempo.

Un evento de día completo agendado después de sus propias 9:00 recibe su rescate dos
minutos más tarde, para que aparezca hoy en la pantalla y no solo en el calendario.

Lo que se dispara es una **alerta de calendario**, no una alarma de reloj: en iPhone se
ve como una notificación normal y respeta el silencio y los modos de concentración.
Comprobado en el dispositivo, no solo en el estándar.

**El iPhone muestra solo dos de las tres alarmas, y eso es normal.** La app Calendario
de Apple tiene dos ranuras ("Alerta" y "Segunda alerta") y dibuja las dos más cercanas;
la de un día antes no aparece por ningún lado. Pero suena: está comprobado (ver
`DECISIONS.md`, 2026-09-22). Es un límite de presentación, no de los datos — no hay nada
que arreglar aquí.

## Cómo correrlo

```bash
npm install
cp .env.example .env        # y llenar las variables (ver .env.example)
```

```bash
# Extracción (Fase 1)
npm test                                     # los 16 casos
npm test -- --caso 3                         # solo el caso 3
npm test -- --ver                            # imprime el JSON de cada caso
npm run extraer -- "mañana a las 4 junta con el ingeniero"

# Calendario (Fase 2)
npm run calendario                           # lista los calendarios de la cuenta
npm run calendario -- --probar               # crea un evento de prueba
npm run agendar -- "junta el viernes a las 4" # pipeline texto → evento (con --si fuerza)

# Servidor de WhatsApp (Fase 3)
npm start                                    # http://localhost:3100/webhook
```

En el día a día no hace falta `npm start`: la tarea programada `agendabot-servidor`
lo arranca al iniciar sesión (vía `scripts/iniciar-servidor-oculto.vbs`) y escribe su
salida en `logs/servidor.log`. `npm start` queda para desarrollo, con la tarea
detenida antes para no chocar en el puerto.

El servidor escucha en el **3100** (`PORT` en el `.env`), no en el 3000: los repos
de `control-de-obra` usan el 3000 y se pisaban — quien arrancara segundo perdía, y
si alguien mataba a agendabot para liberar el puerto, se quedaba caído sin dejar
rastro en el log hasta el siguiente inicio de sesión. El Funnel apunta al 3100 y la
URL pública no cambió, así que en Meta no hay nada que tocar.

## Cuando el bot deja de contestar

Es el único síntoma que da: nada se rompe a la vista, simplemente deja de responder en
WhatsApp. Conviene mirar en este orden, que va de lo más barato a lo más caro.

**1. El log, que dice si el mensaje llegó siquiera.** `logs/servidor.log`. Si aparece
un `[mensaje]` reciente, el problema está de la puerta para adentro. Si no aparece
nada, nunca llegó y hay que mirar la cadena de afuera. Ojo: las líneas de mensaje no
llevan hora, así que para saber si son de ahora hay que ver la fecha de modificación
del archivo, no las últimas líneas.

**2. El servidor.** Que haya algo escuchando en el 3100 (`netstat -ano | grep 3100`).
Si murió, se relanza con `scripts/iniciar-servidor-oculto.vbs`. La tarea programada
**no** sirve para saberlo: reporta éxito aunque el servidor lleve horas muerto, porque
vigila al `.vbs`, que salió bien en el primer segundo.

**3. El túnel, que es el que más ha fallado.** El remedio conocido es apagarlo y
encenderlo:

```bash
tailscale funnel --https=443 off
tailscale funnel --bg 3100
```

Dos trampas aquí, las dos comprobadas a base de perder tiempo en ellas:

- **`tailscale funnel status` dice "Funnel on" aunque no esté entregando nada.** No
  sirve para descartar. Reencenderlo sin apagarlo antes tampoco arregla: hay que hacer
  el ciclo completo.
- **Que el DNS público devuelva una dirección `100.x` es normal, no es el fallo.**
  Parece un cabo suelto evidente —es una dirección no enrutable desde internet— y no
  lo es: el bot funciona con ese registro puesto. No gastes la tarde ahí.

Para comprobar desde fuera de verdad hay que salir de la red local: abrir la URL
pública en el celular **con el WiFi apagado**. Un `curl` desde la misma máquina no vale,
porque resuelve por la tailnet y nunca sale a internet.

El banco de pruebas usa una fecha de referencia fija (jueves 27 de agosto de 2026,
15:00) para que "mañana" o "el próximo martes" tengan siempre la misma respuesta
correcta; sin ese ancla, las pruebas cambiarían de resultado cada día.

`agendar` aplica la regla de confianza: si no es `alta`, muestra el JSON y lo que el
bot preguntaría, y no crea nada hasta que se repita con `--si`. Es el mismo
comportamiento del bot en WhatsApp, ensayado en la terminal.

## Variables de entorno

`.env` (nunca se sube; está en `.gitignore`), basado en `.env.example` — **ese archivo
es la referencia**: cada variable trae arriba sus valores posibles, formato, dónde se
saca y si es obligatoria. Resumen:

```
# Extracción
ANTHROPIC_API_KEY=            # requerida
ANTHROPIC_MODEL=              # opcional, default claude-sonnet-5
ANTHROPIC_EFFORT=             # opcional: low|medium|high|xhigh|max|ninguno

# iCloud (CalDAV)
APPLE_ID=
APPLE_APP_PASSWORD=           # contraseña específica de app, NO la del Apple ID
ICLOUD_CALENDAR_NAME=         # vacío = calendario por defecto

# WhatsApp (Meta Cloud API)
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=            # ID interno de Meta, NO el número telefónico
WHATSAPP_VERIFY_TOKEN=        # lo inventas tú; igual aquí y en el panel de Meta
WHATSAPP_APP_SECRET=          # firma cada webhook; descarta POST que no sean de Meta
WHATSAPP_ALLOWED_NUMBERS=     # wa_id separados por coma; vacío = cualquiera

TZ=America/Mexico_City
PORT=                         # 3100 en este equipo; default 3000 si se omite
```

Dos trampas: `APPLE_APP_PASSWORD` no es la contraseña del Apple ID (se genera en
appleid.apple.com → Iniciar sesión y seguridad → Contraseñas específicas de app, con
2FA activo, y se revoca sin tocar la cuenta). `WHATSAPP_PHONE_ID` no es el número, es
un ID interno de Meta.

## Documentación del proyecto

| Archivo | Qué contiene |
| --- | --- |
| `README.md` | El presente: cómo es el sistema hoy. |
| `TODO.md` | El futuro: lo que falta. |
| `DECISIONS.md` | El porqué: las decisiones tomadas y lo que se descartó. |
| `CLAUDE.md` | Cómo se trabaja aquí (reglas para Claude Code). |

## Estructura

```
agendabot/
├── src/
│   ├── extractor.js      texto → JSON (Claude)
│   ├── calendar.js       JSON → evento en iCloud (CalDAV)
│   ├── agendar.js        texto → evento (CLI, une extractor + calendar)
│   ├── whatsapp.js       idioma de Meta (webhook, firmas, envíos)
│   └── index.js          servidor: webhook → extractor → calendar → respuesta
├── test/
│   ├── casos.js          mensajes de ejemplo + resultado esperado
│   └── probar.js         corre los casos y reporta qué falló
├── scripts/
│   ├── iniciar-servidor.cmd         arranca el servidor con log (tarea programada)
│   └── iniciar-servidor-oculto.vbs  lo lanza sin ventana de consola
├── .env.example
├── README.md · TODO.md · DECISIONS.md · CLAUDE.md
├── .gitignore
└── package.json
```
