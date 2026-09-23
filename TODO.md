# TODO · agendabot

> El **futuro**: lo que falta por hacer. Lo terminado no vive aquí — se borra, su
> rastro queda en `git log` y su porqué en `DECISIONS.md`.

| Sí va aquí | No va aquí |
| --- | --- |
| Trabajo pendiente | Lo hecho (→ `git log`) |
| Bloqueos: qué espera a qué | El porqué de una decisión (→ `DECISIONS.md`) |
| Preguntas abiertas que hay que resolver | Cómo está el código hoy (→ `README.md`) |

Última revisión: **2026-09-23**

---

## Fase 4 — Que corra 24/7

Va en dos tiempos: primero un piloto autoalojado sin costo, para poder presentar el
producto; el hosting de pago solo después, cuando haya aprobación. El porqué de ese
orden está en `DECISIONS.md` (2026-09-15). **El piloto (4a) ya está completo:**
token permanente, URL fija y arranque automático — la máquina revive sola tras un
reinicio.

### 4b · Hosting de pago (cuando aprueben)

- [ ] **Auditoría de seguridad antes de desplegar** al servidor rentado: revisar qué
      queda expuesto, cómo viajan y se guardan las credenciales, y la validación de
      firma del webhook, para no llevarse problemas al entorno de pago.
- [ ] Contratar Railway Hobby ($5/mes). Alternativa: Render Starter ($7/mes).
- [ ] Configurar las variables de entorno en producción.
- [ ] Apuntar el webhook de Meta a la URL nueva y probar de punta a punta.
- [ ] **Desmontar el servidor local** una vez que el hosting funcione: quitar el
      Tailscale Funnel, el arranque automático de 4a y cualquier otra cosa expuesta
      en la máquina personal. Si ya no se ocupa, no debe quedar nada abierto.
- [ ] **Recordatorio por WhatsApp, en el aviso de una hora antes.** El bot manda un
      mensaje al chat **además** de la alerta del iPhone, no en su lugar: el calendario
      es el canal fiable y WhatsApp el que puede fallar. Decidido el 2026-09-22 que sea
      el de una hora —es el momento en que todavía se puede actuar, y el que más veces
      cae dentro de la ventana de Meta—. Si con el rodaje la alerta del calendario a esa
      hora resulta redundante, se quita entonces, ya con evidencia.
      Probado el 2026-09-21: se programó un envío y Meta lo aceptó. Espera al hosting
      porque exige un proceso vivo a la hora exacta del envío.
      **Se manda solo si la ventana de 24 h está abierta**; si está cerrada, no se manda
      nada y el aviso lo da la alerta del calendario. Así no hace falta la plantilla de
      utilidad aprobada por Meta, que es la única forma de escribir fuera de la ventana
      y que se cobra por envío (~$0.0080 en México). Decidido el 2026-09-23 para evitar
      el trámite, no el cobro: la plantilla obliga a texto fijo y a esperar revisión de
      Meta. Ver `DECISIONS.md` (2026-09-23).
      **Si la cita está a menos de ~65 minutos no se manda nada por WhatsApp**, porque
      a esa distancia el aviso de una hora no existe (lo descarta el umbral). Es
      deliberado: el bot acaba de contestar en ese mismo chat con la confirmación, y esa
      respuesta ya hace de aviso. El calendario cubre el rango con la alarma de 15
      minutos o la de rescate. Ver `DECISIONS.md` (2026-09-22).

### El dolor que sigue vivo

**El servidor solo vive mientras la computadora esté encendida y con sesión
iniciada.** El piloto lo amortigua (todo revive solo al iniciar sesión); lo resuelve
del todo el hosting de 4b. Detalle: si Windows reinicia solo y se queda en la
pantalla de bloqueo, el bot no corre hasta que alguien entre — ver `DECISIONS.md`
(2026-09-16).

- [ ] **Nadie vigila al servidor mientras corre.** Los 3 reintentos de la tarea
      programada no sirven: el `.vbs` sale de inmediato, Windows da la tarea por
      terminada con éxito y el reinicio vigila a `wscript.exe`, no al servidor. Si el
      proceso muere a media mañana, queda caído hasta el siguiente inicio de sesión
      — y en silencio: el log no registra la muerte. Pasó el 2026-09-17 (ver
      `DECISIONS.md`). Se resuelve solo con el hosting de 4b, así que arreglarlo aquí
      es trabajo que se tira; vale la pena solo si el piloto se alarga.
- [ ] **No hay forma de saber si el bot está vivo sin revisarlo a mano.** Relacionado
      con lo de arriba: el síntoma de que algo falle es que los mensajes de WhatsApp
      dejen de contestarse, y eso se nota tarde. Una comprobación periódica del
      webhook, o siquiera anotar en el log cada arranque y cada cierre, daría aviso.

---

## Producción: la conversación con el jefe

Antes de que esto deje de ser prueba, hay decisiones que son suyas, no técnicas:

- [ ] **Cotización completa: son tres renglones, no dos.** Hosting (~$5/mes), consumo
      del modelo y WhatsApp. Las cifras ya están medidas —2,470 tokens de entrada y 409
      de salida por mensaje, **$0.0090 (0.90¢)** con `claude-sonnet-5`, medido el
      2026-09-23 con `npm run extraer`— y confirman el ~1¢ estimado en `DECISIONS.md`
      (2026-08-27). **WhatsApp no cuesta nada** mientras el bot solo conteste, y con la
      regla de la ventana tampoco costará después: ver `DECISIONS.md` (2026-09-23). Lo
      que falta no son números sino la conversación: **quién paga la cuenta de
      Anthropic**, que hoy sale de la cuenta personal del usuario y debe pasar a una de
      la empresa. Hay una hoja de una página para presentarlo, ya hecha.
- [ ] **Número de WhatsApp real** en vez del número de pruebas de Meta. Implica
      decidir si el bot vive en su chat propio o en otro flujo.
- [ ] **Cuenta de Apple del jefe:** que genere él su contraseña específica de app y
      pase solo esos 16 caracteres. Ver `DECISIONS.md` (2026-09-08).
- [ ] **Calendario destino real** en vez de `agendabot-pruebas`.
- [ ] **Dónde viven las credenciales durante el piloto.** Hoy el `.env` —con el token
      permanente de WhatsApp y la contraseña de app de Apple— está en una máquina
      personal. Si el piloto se alarga, es tema suyo.

---

## Núcleo de extracción

- [ ] **Casos de prueba más difíciles.** El banco ya no distingue Sonnet de Opus. Los
      buenos salen de mensajes reales: así entró el caso 16, de una cita que se agendó
      con una semana de error (ver `DECISIONS.md`, 2026-09-22). Seguir sumándolos.

- [ ] **Duplicados cuando el túnel se recupera.** El 2026-09-22 el mismo mensaje entró
      dos veces, con identificadores distintos, y creó dos eventos idénticos. El dedup
      va por id de mensaje y solo cubre los reintentos de Meta. La sospecha: Meta tenía
      encolado el envío perdido mientras el túnel estaba caído y lo entregó junto con el
      nuevo. Si se confirma, cada caída puede dejar eventos duplicados al recuperarse.

---

## Backlog (sin prioridad aún)

- [ ] Soporte para Google Calendar (alternativa o en paralelo a iCloud). Se vuelve
      necesario si el proyecto pasa de un usuario a varios: no se le puede pedir a
      mucha gente que genere contraseñas de app; ahí OAuth deja de ser opcional.
- [ ] Editar / cancelar eventos por mensaje ("cambia la junta del viernes a las 5").
- [ ] **Recordatorios a la medida.** Ya todos los eventos avisan, con anticipación
      fija (ver `DECISIONS.md`, 2026-09-21). Elegir otra anticipación desde el mensaje
      —"avísame con dos días"— se descartó por ahora: obliga a tocar el prompt y el
      esquema del extractor. Se retoma si alguien lo pide de verdad.
- [ ] Soporte para notas de voz.
