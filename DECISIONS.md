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

## 2026-09-15 · Token de WhatsApp: usuario del sistema, sin caducidad

**Contexto.** El token del panel de pruebas de Meta caduca cada pocas horas. Estaba
anotado como uno de los tres dolores que resolvería el despliegue (Fase 4).

**Decisión.** Un **usuario del sistema** (`agendabot-servidor`, acceso Admin) en el
portfolio comercial, con la app `agendabot` y la WABA asignadas con **Acceso total**, y
un token de caducidad **Nunca** con los permisos `whatsapp_business_messaging` y
`whatsapp_business_management`.

**Por qué.** No era un problema de hosting: se arregla igual en local que en producción,
y no dependía de ninguna otra decisión. Tenerlo resuelto antes quita ruido de todo lo
que venga después — un 401 ya no es "seguro caducó otra vez".

**Detalles que costaron.** El permiso `business_management` que pide la guía de Meta no
aparece en el selector: solo se ofrecen los permisos de los casos de uso configurados en
la app. Con los dos de WhatsApp basta, porque agendabot no administra el portfolio. Y en
el panel nuevo de Business Suite, el "Acceso total" que se ve en la cuenta de WhatsApp
puede ser el del usuario *personal*: la comprobación buena es que el usuario del sistema
diga "puede acceder a 2 activos comerciales".

**Contrapartida aceptada.** Meta recomienda 60 días. Un token que no expira, si se
filtra, sigue sirviendo hasta revocarlo a mano desde "Revocar tokens".

## 2026-09-15 · Piloto autoalojado antes del hosting de pago

**Contexto.** El despliegue cuesta ~$5-7 al mes, y eso hay que presentarlo a los
superiores del usuario. Pedir presupuesto para algo que todavía no han visto funcionar
es el orden equivocado.

**Decisión.** Primero un piloto sin costo sobre una máquina propia: token permanente
(arriba), URL pública fija con **Tailscale Funnel** y arranque automático al encender.
El hosting de pago se contrata cuando haya aprobación, y entonces será **Railway Hobby**
($5/mes).

**Por qué Railway para después.** El uso real de agendabot (~120-200 MB de RAM, CPU casi
nula) cabe dentro de los $5 de crédito que el plan Hobby ya incluye, y no se duerme: su
modo Serverless es opt-in. Render Starter ($7/mes) hace lo mismo con precio plano; es la
alternativa si se prefiere no mirar un medidor de consumo.

**Descartado.**
- **Free tier de Render:** se suspende a los 15 minutos sin tráfico y tarda cerca de un
  minuto en despertar. Para un webhook que recibe tres mensajes al día, eso significa
  arranque en frío en casi todos.
- **Plan Free de Railway:** $1/mes de crédito no cubre un servicio encendido todo el mes
  (RAM a $10/GB/mes).
- **ngrok:** su free tier se recortó a principios de 2026 a sesiones de 2 horas y URLs
  aleatorias. Ya no resuelve el problema de la URL fija.
- **Cloudflare Tunnel con nombre:** funciona y `cloudflared` ya está instalado, pero
  exige un dominio propio (~$10-12/año), o sea deja de ser costo cero.
- **Oracle Cloud Always Free:** una VM 24/7 de verdad y gratis, pero en junio de 2026
  Oracle recortó el Always Free de ARM a la mitad sin avisar y empezó a terminar
  instancias que excedían el nuevo límite. Para una demo ante los jefes, el riesgo de
  que un tercero apague la máquina el día equivocado no compensa.

## 2026-09-15 · URL pública fija: Tailscale Funnel

**Contexto.** El quick tunnel de `cloudflared` da una URL distinta en cada arranque y
había que re-pegarla en el panel de Meta cada vez. Segundo dolor del ciclo local.

**Decisión.** **Tailscale Funnel** (plan Personal, gratis) exponiendo el puerto 3000.
La URL queda fija: `https://rm-lap-03.tail65c817.ts.net/webhook`, con HTTPS y
certificado automáticos. Corre con `tailscale funnel --bg 3000`, que persiste como
configuración del servicio de Windows (arranque automático), así que sobrevive
reinicios. El webhook de Meta apunta ahí, verificado y probado de punta a punta.

**Por qué.** Gratis, URL estable pensada justo para webhooks, y el servicio de
Tailscale revive solo al encender la máquina. La superficie expuesta es pequeña:
`src/index.js` solo responde en `/webhook` y descarta POSTs sin firma válida de Meta.

**Descartado.** El quick tunnel de `cloudflared` (URL efímera, el dolor original);
ngrok (free tier recortado en 2026: sesiones de 2h y URLs aleatorias); Cloudflare
Tunnel con nombre (exige dominio propio, ~$10-12/año). El detalle de la tailnet: es
la cuenta de GitHub `randall-full-dev`, aceptado para el piloto — si esto pasa a la
empresa, la tailnet debería ser suya, no personal.

## 2026-09-16 · Arranque automático: tarea programada al iniciar sesión, no NSSM

**Contexto.** Último dolor del piloto autoalojado: tras un reinicio, Tailscale y el
túnel revivían solos pero el servidor Node había que arrancarlo a mano.

**Decisión.** Tarea programada `agendabot-servidor` (Programador de tareas de
Windows), disparada al iniciar sesión del usuario, con 3 reintentos si el proceso
muere. Lanza `scripts/iniciar-servidor-oculto.vbs`, que a su vez corre
`scripts/iniciar-servidor.cmd` sin ventana; la salida queda en `logs/servidor.log`.

**Por qué.** No pide permisos de administrador ni instalar nada. El `.vbs`
intermedio existe porque un `.cmd` lanzado directo deja una consola abierta en la
sesión, y cerrarla por accidente mata el servidor. El `.cmd` usa la ruta estable de
node en fnm (`%APPDATA%\fnm\node-versions\...`), no la del PATH: la que fnm pone en
el PATH es efímera y una tarea programada no la ve.

**Descartado.**
- **NSSM:** convertiría el servidor en un servicio de verdad (corre sin iniciar
  sesión, se reinicia siempre), pero exige instalación y consola elevada. Para una
  laptop en la que el usuario inicia sesión a diario, la tarea basta.
- **Tarea "al arrancar el equipo" como SYSTEM:** también requiere elevación.

**Contrapartida aceptada.** Si Windows reinicia solo (una actualización) y queda en
la pantalla de bloqueo, el bot no corre hasta que alguien inicie sesión. Y la ruta
de node está fijada a `v24.16.0`: actualizar Node con fnm implica ajustar el `.cmd`.

## 2026-09-17 · Puerto propio 3100 (revisa el 3000 del 2026-09-16)

**Contexto.** El piloto se cayó en silencio. La tarea programada arrancó bien a las
10:04 y atendió mensajes, pero a las 11:26 el servidor murió sin dejar error en
`logs/servidor.log`; un segundo después arrancaba el backend de `control-de-obra` en
el 3000. Otra sesión de trabajo mató a agendabot para quedarse con el puerto. El
Funnel siguió publicando la URL pública hacia el 3000, o sea apuntando al repo
equivocado: el webhook de WhatsApp quedó contestando otra aplicación.

**Decisión.** agendabot escucha en el **3100** (`PORT=3100` en el `.env`) y el Funnel
apunta ahí (`tailscale funnel --bg 3100`). El default del código sigue siendo 3000,
porque en hosting la plataforma inyecta el puerto.

**Por qué.** El 3000 es la convención de los repos de `control-de-obra` y agendabot
llegó después a una laptop que ya lo usaba a diario. Un servicio que debe estar
siempre arriba no puede compartir puerto con servidores de desarrollo que se levantan
y se bajan todo el día: la colisión no es un accidente, es rutina. La URL pública no
cambia, así que no hay nada que reconfigurar en el panel de Meta.

**Descartado.**
- **Dejar el 3000 y coordinar a mano** (bajar agendabot antes de trabajar en otro
  repo): depende de acordarse, y el modo de fallo es el peor posible — el bot
  silencioso y el webhook contestando otra app, sin señal de que algo va mal.
- **Reservar el 3000 para agendabot y mover `control-de-obra`:** son varios repos con
  el puerto en su documentación y su `.env`; mover el que llegó último cuesta menos.

**Hallazgo colateral (no resuelto).** Los "3 reintentos si el proceso muere" de la
entrada anterior no protegen nada: el `.vbs` lanza el `.cmd` y sale de inmediato, así
que Windows da la tarea por terminada con éxito en el primer segundo y el reinicio
vigila a `wscript.exe`, no al servidor. Si el servidor muere, nadie lo revive hasta el
siguiente inicio de sesión. Queda en `TODO.md`; con hosting (4b) el problema
desaparece solo, así que no vale arreglarlo dos veces.

---

## 2026-09-21 · Todos los eventos llevan recordatorio, y el corto plazo tiene rescate

**Contexto.** Hasta hoy el `.ics` se escribía sin ningún `VALARM`: el evento quedaba en
el calendario y no avisaba nada. Un bot al que le dictas una cita por WhatsApp y que la
agenda en silencio resuelve la mitad del problema — la cita queda anotada, pero igual se
te pasa.

**Decisión.** Todo evento se crea con aviso; no hay forma de pedir uno sin él.

- Cita con hora: **1 día, 1 hora y 15 minutos antes**.
- Día completo: **9:00 de la víspera y 9:00 del mismo día**. No pueden usar las mismas
  anticipaciones porque empiezan a la medianoche, y un aviso a esa hora no lo ve nadie.
  Las 9:00 de la víspera son además el default de Apple.
- De esa escalera se caen los avisos que ya pasaron y los que caerían a menos de
  **5 minutos** de haber agendado (`MARGEN_MIN`).
- Si se cae la escalera entera, entra un **aviso de rescate**: uno solo, a la mitad del
  tiempo que falta, con tope de 15 minutos y piso de 1.

**Por qué las tres anticipaciones.** Son las que ofrece la app de Calendario de iCloud y
cubren tres momentos distintos: el día antes para reacomodar la agenda, la hora antes
para prepararse, los 15 minutos para salir. Que sean fijas es lo que hace que el bot
valga la pena: se dicta "junta con el arquitecto el jueves a las 4" y no hay nada más
que decidir. Pedir la anticipación en cada mensaje convierte una frase en una
conversación.

**Por qué el rescate.** Una alarma cuyo momento ya pasó no suena. Por aquí entra mucho
"nos vemos en media hora", y ahí las tres nacen vencidas: el evento se quedaba mudo
justo cuando olvidarlo cuesta más. El rescate va a la mitad del tiempo que falta y no a
un fijo porque el tiempo que falta es el único dato que hay: con 30 minutos avisa a los
15, con 6 avisa a los 3.

**Por qué se descartan los avisos casi inmediatos.** Sin el umbral, una cita dentro de
17 minutos conservaba la alarma de 15, que sonaba a los 2 minutos de agendar —con el
chat del bot todavía abierto— y después ya no avisaba nada más. El umbral la descarta y
deja que el rescate ponga una a los 9 minutos, mucho mejor colocada.

**El piso del rescate es independiente del umbral, y tiene que serlo.** Al principio se
escribió como `MARGEN_MIN * 2`, y subir el umbral a 5 dejó sin ningún aviso todo lo que
cayera a menos de 10 minutos — el agujero que el rescate existía para tapar. No son el
mismo concepto: el umbral descarta un aviso que sobra porque vendrán otros; el rescate
es el último recurso, y ahí un aviso a los 3 minutos sigue siendo mejor que ninguno.

**Comprobado contra iCloud, no solo contra el RFC.** Se creó un evento de cada tipo en
`agendabot-pruebas` y se leyeron de vuelta por CalDAV: las alarmas vuelven tal cual se
mandaron, incluido el disparo positivo `PT9H` del día completo. Importaba verificarlo:
iCloud reescribe lo que guarda —anexa su propio `VTIMEZONE`, entre otras cosas— y no
había garantía de que respetara un disparo posterior al inicio.

**Comprobado también en el dispositivo.** Dos simulacros con el iPhone delante: lo que
llega es una **alerta de calendario**, no una alarma de reloj. Se ve como una
notificación normal y respeta el silencio y los modos de concentración. Eso fija el
techo de lo que un `VALARM` puede hacer: nunca va a despertar a nadie.

**Descartado.**
- **Preguntar la anticipación en el chat**, o sacarla del mensaje con el extractor: es
  la pregunta que el bot existe para no hacer. Además obligaría a tocar el prompt y el
  esquema, con los 15 casos de por medio, por un dato que casi nadie va a dictar.
- **Un solo aviso.** Elegir cuál es imposible sin saber de qué cita se trata: 15 minutos
  no alcanzan si hay que cruzar la ciudad, y un día antes se olvida.
- **Hacerlas configurables por `.env`.** Hoy el piloto es de un usuario y de una
  máquina; una variable que nadie va a cambiar es ceremonia. Las constantes están al
  principio del archivo.
- **Sustituir el tercer aviso por un mensaje de WhatsApp del bot.** Se probó y funciona
  —se programó un envío y Meta lo aceptó—, pero no puede sustituir a una alerta del
  calendario, por dos razones independientes. La primera: la Cloud API solo deja mandar
  texto libre dentro de las **24 horas** siguientes al último mensaje del usuario, así
  que en una cita agendada el lunes para el jueves el aviso de 15 minutos cae fuera de
  la ventana y Meta lo rechaza. La segunda: una alerta del calendario la dispara Apple y
  suena aunque la máquina esté apagada, mientras que un mensaje del bot exige que el
  proceso esté vivo a esa hora exacta — y hoy muere al cerrar sesión. Un recordatorio
  que no llega es peor que no haberlo prometido. Queda para después del hosting (4b),
  anotado en `TODO.md`, y como **añadido** a las alertas, no como reemplazo.

**Consecuencia aceptada.** Los avisos vencidos no se escriben en el `.ics`. Si después
se mueve el evento a una fecha lejana desde el teléfono, no reaparecen: se queda con los
que se le pusieron al crearlo. Para un piloto de un usuario es un precio menor frente a
tener la lista de alertas de la app llena de avisos que nunca van a sonar.

---

## 2026-09-22 · Se confirman las tres alarmas; WhatsApp irá en la de una hora

**Contexto.** La entrada de ayer dejó una duda que no se podía cerrar desde el código:
los eventos se crean con tres alarmas, pero la app Calendario de Apple solo tiene dos
ranuras —"Alerta" y "Segunda alerta"— y muestra únicamente las dos más cercanas. No se
sabía si la tercera, la de un día antes, existía de verdad o si iOS la descartaba al
sincronizar. Mientras no se supiera, el bot prometía en el chat un aviso posiblemente
inexistente.

**Cómo se resolvió.** Con un truco de calendario en vez de esperar un día: se creó un
evento para *mañana* a una hora concreta, de modo que su alarma de un día antes cayera
*hoy* a esa misma hora. Las otras dos quedaban fuera del día, así que era la única que
podía sonar y no había ambigüedad posible. La idea fue del usuario. Sonó las dos veces
que se probó (21 y 22 de septiembre).

**Conclusión.** La tercera alarma funciona; el límite de Apple es solo de presentación.
Las tres anticipaciones se quedan como están. Que el iPhone muestre dos es cosmético y
no hay que corregir nada — conviene saberlo para no volver a diagnosticarlo.

**Decisión sobre WhatsApp.** Cuando llegue (Fase 4b), el mensaje del bot irá en el aviso
de **una hora antes**, y será un **añadido** a la alerta del calendario, no un
reemplazo.

**Por qué esa hora.** Es el último momento en que el aviso sirve para actuar: salir,
preparar lo que hay que llevar, cancelar. El de 15 minutos llega cuando ya se va en
camino, y el de un día antes se pierde en el chat. Hay además una razón práctica: es el
que más veces cae dentro de la ventana de 24 horas de Meta, porque en una cita agendada
para el día siguiente el aviso de un día suele nacer vencido.

**Por qué añadido y no reemplazo.** El calendario lo dispara Apple: suena con la máquina
apagada y sin que nada nuestro esté vivo. El mensaje del bot depende de un proceso
corriendo en el minuto exacto y de una ventana que puede estar cerrada. Cambiar el aviso
más útil de un canal probado a uno sin rodaje es apostar de más. Si con el tiempo la
alerta del calendario a esa hora resulta redundante, se quita **entonces**, con la
evidencia de que el mensaje llega de forma fiable.
