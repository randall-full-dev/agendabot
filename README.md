# agendabot

Bot personal que convierte mensajes de WhatsApp en texto libre en eventos de calendario (iCloud, en el iPhone).

## La idea

Escribo en un chat de WhatsApp algo como:

> "Hoy en la junta con el equipo de obra, acordamos que para la siguiente sesión llevemos el reporte X y será el día 5 de septiembre a las 4 pm"

Y el sistema automáticamente crea un evento en mi calendario con:

- **Nombre de la junta** (título del evento)
- **Fecha y hora**
- **Lugar** (si se menciona)
- **Descripción / detalles** (ej. "llevar el reporte X")

Si algún dato no aparece en el mensaje, el bot lo deja vacío o pregunta por él.

## ¿Cómo funciona? (flujo general)

```
Mensaje en WhatsApp
      │
      ▼
Servidor recibe el mensaje (webhook)
      │
      ▼
LLM extrae datos estructurados:
{ titulo, fecha, hora, lugar, descripcion }
      │
      ▼
Servidor crea el evento en iCloud (CalDAV)
      │
      ▼
El bot responde en WhatsApp confirmando el evento creado
```

## Componentes

| Componente        | Función                                             | Herramienta propuesta                                                                          |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Entrada WhatsApp  | Recibir mensajes del usuario                        | WhatsApp Business API (Meta Cloud API) o Baileys                                               |
| Extracción con AI | Convertir texto libre en datos estructurados (JSON) | API de Claude (`claude-sonnet-5`, con salida estructurada)                                     |
| Calendario        | Crear el evento                                     | **iCloud vía CalDAV** (Apple ID + contraseña específica de app). Google Calendar en el backlog |
| Servidor          | Orquestar todo, corriendo 24/7                      | Node.js + Railway/Render o VPS                                                                 |

### Por qué iCloud y no Google

Los eventos viven en el calendario de iCloud del iPhone, que es donde ya está la agenda.
Apple expone los calendarios por **CalDAV**, un protocolo estándar, y deja Calendario
(junto con Mail y Contactos) fuera de la Protección de Datos Avanzada justamente para
que siga funcionando con protocolos estándar. La autenticación es Apple ID + una
contraseña específica de app: menos fricción de arranque que el OAuth de Google, que
pide proyecto en Google Cloud Console, pantalla de consentimiento y refresh tokens.

El costo: no hay API oficial ni documentación de Apple, y los errores de CalDAV son
menos claros que los de Google. Del lado de Node la opción es `tsdav`.

La decisión es reversible. El extractor no sabe ni le importa a dónde va el evento:
escupe el mismo JSON en los dos casos. Cambiar de iCloud a Google (o soportar ambos)
es reescribir `calendar.js` y nada más.

## Alcance actual

- **Un solo usuario**: la agenda de una persona, no un servicio multiusuario todavía.
- Solo texto (no audios ni imágenes, por ahora).
- Zona horaria: America/Mexico_City.
- Idioma de entrada: español, con fechas relativas ("mañana", "el próximo martes", "en dos semanas").

## Estructura del evento extraído

El LLM debe devolver un JSON con este esquema:

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

Notas:

- `hora_fin`: si no se especifica, el evento dura 1 hora por defecto.
- `lugar`: opcional; solo si el mensaje lo menciona.
- `confianza`: `alta` | `media` | `baja`. Si no es `alta`, el bot pide confirmación antes de crear el evento.
- `notas`: cuando la confianza no es `alta`, explica en una frase qué fue lo ambiguo. Es el texto que le da al bot algo concreto que preguntar ("¿las 8 de la mañana o de la noche?") en vez de un "no entendí" genérico.
- `fecha` y `hora_inicio` pueden venir en `null` si el mensaje no los contiene. Un campo vacío es correcto; un campo inventado rompe la agenda.

El esquema está definido como JSON Schema en `src/extractor.js` y se le pasa a la API
como salida estructurada: la respuesta se valida contra él antes de llegar al código,
así que nunca hay que parsear texto libre ni reintentar por JSON mal formado.

## Plan de desarrollo (fases)

### Fase 1 — Núcleo de extracción

- [x] Script que recibe un texto y devuelve el JSON del evento usando la API de Claude (`src/extractor.js`).
- [x] Banco de 15 mensajes de ejemplo con su resultado esperado (`test/casos.js`).
- [x] Correr el banco y elegir modelo. **15/15 con `claude-sonnet-5`.**

### Qué modelo y por qué

Los tres candidatos contra los mismos 15 casos, una corrida cada uno
(27 de agosto de 2026, con el prompt actual):

| Modelo | Casos | Costo por mensaje |
| ------ | ----- | ----------------- |
| `claude-haiku-4-5` (budget 8000) | 13/15 | 0.58¢ |
| **`claude-sonnet-5`** (effort medium) | **15/15** | **1.00¢** |
| `claude-opus-5` (effort medium) | 15/15 | 1.60¢ |

Haiku falló en "el miércoles que viene": puso la junta el jueves. Ese es el error
que no se puede tolerar aquí — una junta en el día equivocado y sin aviso. Opus
resolvió ese caso con el mismo prompt, o sea que no era un hueco de instrucciones
sino de capacidad.

Se eligió Sonnet 5: iguala a Opus en este banco por 60¢ menos al mes. Pero eso
**no prueba que sean equivalentes**, solo que estos 15 casos ya no los distinguen.
Si en uso real aparece un evento en la fecha equivocada, el plan B es cambiar
`ANTHROPIC_MODEL=claude-opus-5` en el `.env`. Nada más.

Pendiente: el banco necesita casos más difíciles: ya no discrimina entre Sonnet y
Opus. Los buenos van a salir de mensajes reales cuando la Fase 3 esté andando.

Cómo probarlo:

```bash
npm install
cp .env.example .env        # y pon tu ANTHROPIC_API_KEY

npm test                    # corre los 15 casos
npm test -- --caso 3        # solo el caso 3
npm test -- --ver           # imprime el JSON completo de cada caso

npm run extraer -- "mañana a las 4 junta con el ingeniero"
```

Las pruebas usan una fecha de referencia fija (jueves 27 de agosto de 2026, 15:00) para
que "mañana" o "el próximo martes" tengan siempre la misma respuesta correcta. Sin ese
ancla, las pruebas cambiarían de resultado cada día.

### Fase 2 — Integración con iCloud (CalDAV)

- [x] Script que convierte el JSON del evento en iCalendar y lo sube (`src/calendar.js`).
- [x] Generar una contraseña específica de app en appleid.apple.com (requiere 2FA activo).
- [x] Conectar a `caldav.icloud.com` y listar los calendarios de la cuenta.
- [x] Conectar Fase 1 + Fase 2: texto → JSON → evento en el calendario (`src/agendar.js`).

```bash
npm run calendario              # lista los calendarios de la cuenta
npm run calendario -- --probar  # crea un evento de prueba mañana a las 10
npm run agendar -- "junta con el ingeniero el viernes a las 4"   # pipeline completo
```

`agendar` aplica la regla de confianza del README: si no es `alta`, muestra el JSON
y lo que el bot preguntaría, y no crea nada hasta que se repita con `--si`. Es el
mismo comportamiento que tendrá el bot en WhatsApp, ensayado en la terminal.

Dos decisiones de `calendar.js` que conviene no deshacer sin saber por qué:

**Las horas se mandan como hora de pared con su zona** (`DTSTART;TZID=America/Mexico_City:...20260910T100000`),
no como instante UTC. Se empezó con UTC y salió mal: la base de zonas horarias de
iCloud está desactualizada (en 2026 todavía le pone horario de verano a Ciudad de
México, abolido en 2022) y pintaba los eventos una hora corridos. La hora de pared
se convierte y desconvierte con las mismas reglas, buenas o malas, así que el error
se cancela: "las 10:00" se ven a las 10:00 en la web, en el iPhone y en cualquier
cliente. Que es además lo que la persona quiso decir con "junta a las 10".

**`notas` no se escribe en el evento.** Explica qué fue lo ambiguo del mensaje: eso
alimenta la pregunta de confirmación de la Fase 3, no el calendario. Al evento ya
creado nadie le sirve saber que hubo una duda.

### Fase 3 — Entrada por WhatsApp (Meta Cloud API)

Se eligió la vía oficial (Meta Cloud API) sobre Baileys: cero riesgo de
suspensión del número y estable, a cambio de un trámite inicial en
developers.facebook.com y de que el bot viva en un chat propio.

- [x] Servidor webhook que recibe los mensajes (`src/index.js` + `src/whatsapp.js`):
      verificación del webhook, firma HMAC de cada POST, deduplicación de
      reintentos y lista de números permitidos.
- [x] Conectar el webhook al pipeline de Fases 1-2 (probado en local simulando
      los POST de Meta: mensaje falso → evento real en iCloud).
- [x] Lógica de confirmación: confianza alta agenda directo; media/baja
      pregunta la duda y espera un "si" por el mismo chat.
- [ ] Crear la app en developers.facebook.com y llenar las variables `WHATSAPP_*`.
- [ ] Probar con mensajes reales desde un teléfono (requiere Fase 4 o un túnel local).

```bash
npm start    # levanta el servidor en http://localhost:3000/webhook
```

### Fase 4 — Despliegue

- [ ] Subir el servidor a Railway/Render (deploy automático desde GitHub).
- [ ] Variables de entorno en producción.
- [ ] Pruebas de punta a punta desde el teléfono.

### Fase 5 — Mejoras (backlog)

- [ ] Soporte para Google Calendar (como alternativa o en paralelo a iCloud).
- [ ] Editar/cancelar eventos por mensaje ("cambia la junta del viernes a las 5").
- [ ] Recordatorios configurables.
- [ ] Soporte para notas de voz.

## Variables de entorno

Crear un archivo `.env` (NUNCA subirlo al repo) basado en `.env.example`:

```
# Fase 1
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=            # opcional, por defecto claude-sonnet-5
ANTHROPIC_EFFORT=           # opcional: low | medium | high | xhigh | max | ninguno
ANTHROPIC_THINKING_BUDGET=  # opcional, solo para haiku (entero >= 1024)

# Fase 2 (iCloud vía CalDAV)
APPLE_ID=
APPLE_APP_PASSWORD=       # contraseña específica de app, NO la del Apple ID
ICLOUD_CALENDAR_NAME=     # vacío = calendario por defecto

# Fase 3
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=

TZ=America/Mexico_City
```

Arriba está el resumen. **El detalle está en `.env.example`**: cada variable trae
arriba un comentario con sus valores posibles, el formato esperado, dónde se saca y
si es obligatoria u opcional. Ese archivo es la referencia; esta lista solo es un
vistazo rápido.

Dos que confunden:

- `APPLE_APP_PASSWORD` no es la contraseña del Apple ID. Se genera en
  appleid.apple.com → Iniciar sesión y seguridad → Contraseñas específicas de app,
  y requiere 2FA activo. Solo sirve para esta app y se revoca sin tocar la cuenta.
- `WHATSAPP_PHONE_ID` no es el número telefónico, es un ID interno de Meta.

## Estructura del proyecto

```
agendabot/
├── src/
│   ├── extractor.js      # Fase 1: texto → JSON (Claude, salida estructurada)
│   ├── calendar.js       # Fase 2: JSON → evento en iCloud (CalDAV)
│   ├── agendar.js        # Fases 1+2 conectadas: texto → evento  ✓
│   ├── whatsapp.js       # Fase 3: el idioma de Meta (webhook, firmas, envios)
│   └── index.js          # Servidor principal: webhook → extractor → calendario
├── test/
│   ├── casos.js          # Mensajes de ejemplo + resultado esperado
│   └── probar.js         # Corre los casos y reporta qué campos fallaron
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
