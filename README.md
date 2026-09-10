# agendabot

Bot que convierte mensajes de WhatsApp en texto libre en eventos de calendario
(iCloud, vía CalDAV). Escribes "junta con el ingeniero el viernes a las 4 en la obra"
y aparece el evento en el calendario, con confirmación por el mismo chat.

> El **presente**: cómo es el sistema hoy. El porqué de cada decisión vive en
> `DECISIONS.md`; lo que falta, en `TODO.md`.

## Estado actual

Las tres fases del pipeline funcionan y están probadas de punta a punta: un WhatsApp
real crea el evento en iCloud y el bot responde por el chat.

**Corre en local, no desplegado.** El servidor y el túnel viven mientras la
computadora esté encendida; el token de WhatsApp de pruebas caduca cada pocas horas.
El paso a un servidor 24/7 es la Fase 4 → `TODO.md`.

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
- `notas`: cuando la confianza no es `alta`, explica en una frase qué fue ambiguo — el
  texto que le da al bot algo concreto que preguntar. **No se escribe en el evento.**
- `fecha` y `hora_inicio` pueden venir `null`. Un campo vacío es correcto; uno
  inventado rompe la agenda.

## Módulos

| Archivo | Qué hace |
| --- | --- |
| `src/extractor.js` | Texto → JSON validado, con Claude (`claude-sonnet-5`). No sabe de WhatsApp ni de calendarios. |
| `src/calendar.js` | JSON → evento CalDAV en `caldav.icloud.com`. No sabe de dónde salió el JSON. |
| `src/agendar.js` | Conecta extractor + calendar por CLI: texto → evento, en un comando. |
| `src/whatsapp.js` | El idioma de Meta: verificación del webhook, firma HMAC, extracción de mensajes, envío de respuestas. |
| `src/index.js` | El servidor: webhook → extractor → calendar → respuesta. Dedup de reintentos, lista de números permitidos, regla de confianza. |
| `test/casos.js` · `test/probar.js` | 15 mensajes de ejemplo con su resultado esperado, y el banco que los corre. |

**Detalle de `calendar.js`:** las horas se escriben como hora de pared con zona
(`DTSTART;TZID=America/Mexico_City:...`), no como UTC. El porqué (un bug de la base de
zonas de iCloud) está en `DECISIONS.md` — no deshacer sin leerlo.

## Cómo correrlo

```bash
npm install
cp .env.example .env        # y llenar las variables (ver .env.example)
```

```bash
# Extracción (Fase 1)
npm test                                     # los 15 casos
npm test -- --caso 3                         # solo el caso 3
npm test -- --ver                            # imprime el JSON de cada caso
npm run extraer -- "mañana a las 4 junta con el ingeniero"

# Calendario (Fase 2)
npm run calendario                           # lista los calendarios de la cuenta
npm run calendario -- --probar               # crea un evento de prueba
npm run agendar -- "junta el viernes a las 4" # pipeline texto → evento (con --si fuerza)

# Servidor de WhatsApp (Fase 3)
npm start                                    # http://localhost:3000/webhook
```

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
PORT=                         # opcional, default 3000
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
├── .env.example
├── README.md · TODO.md · DECISIONS.md · CLAUDE.md
├── .gitignore
└── package.json
```
