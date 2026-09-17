# TODO · agendabot

> El **futuro**: lo que falta por hacer. Lo terminado no vive aquí — se borra, su
> rastro queda en `git log` y su porqué en `DECISIONS.md`.

| Sí va aquí | No va aquí |
| --- | --- |
| Trabajo pendiente | Lo hecho (→ `git log`) |
| Bloqueos: qué espera a qué | El porqué de una decisión (→ `DECISIONS.md`) |
| Preguntas abiertas que hay que resolver | Cómo está el código hoy (→ `README.md`) |

Última revisión: **2026-09-16**

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

### El dolor que sigue vivo

**El servidor solo vive mientras la computadora esté encendida y con sesión
iniciada.** El piloto lo amortigua (todo revive solo al iniciar sesión); lo resuelve
del todo el hosting de 4b. Detalle: si Windows reinicia solo y se queda en la
pantalla de bloqueo, el bot no corre hasta que alguien entre — ver `DECISIONS.md`
(2026-09-16).

---

## Producción: la conversación con el jefe

Antes de que esto deje de ser prueba, hay decisiones que son suyas, no técnicas:

- [ ] **Cotización completa: servidor + consumo de API.** Si se aprueba, presentar no
      solo el hosting (~$5/mes) sino también el costo del modelo por mensaje (~1¢ con
      Sonnet, ver `DECISIONS.md` 2026-08-27) y quién paga esa cuenta: hoy el consumo
      sale de la cuenta personal de Anthropic del usuario, y eso debe pasar a una
      cuenta de la empresa.
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

- [ ] **Casos de prueba más difíciles.** El banco de 15 ya no distingue Sonnet de
      Opus. Los buenos saldrán de mensajes reales ahora que la Fase 3 funciona.

---

## Backlog (sin prioridad aún)

- [ ] Soporte para Google Calendar (alternativa o en paralelo a iCloud). Se vuelve
      necesario si el proyecto pasa de un usuario a varios: no se le puede pedir a
      mucha gente que genere contraseñas de app; ahí OAuth deja de ser opcional.
- [ ] Editar / cancelar eventos por mensaje ("cambia la junta del viernes a las 5").
- [ ] Recordatorios configurables.
- [ ] Soporte para notas de voz.
