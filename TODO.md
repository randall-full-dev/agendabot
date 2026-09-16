# TODO · agendabot

> El **futuro**: lo que falta por hacer. Lo terminado no vive aquí — se borra, su
> rastro queda en `git log` y su porqué en `DECISIONS.md`.

| Sí va aquí | No va aquí |
| --- | --- |
| Trabajo pendiente | Lo hecho (→ `git log`) |
| Bloqueos: qué espera a qué | El porqué de una decisión (→ `DECISIONS.md`) |
| Preguntas abiertas que hay que resolver | Cómo está el código hoy (→ `README.md`) |

Última revisión: **2026-09-15**

---

## Fase 4 — Que corra 24/7

Va en dos tiempos: primero un piloto autoalojado sin costo, para poder presentar el
producto; el hosting de pago solo después, cuando haya aprobación. El porqué de ese
orden está en `DECISIONS.md` (2026-09-15).

### 4a · Piloto autoalojado (lo siguiente)

- [ ] **Arranque automático** del servidor al encender la máquina (Programador de
      tareas o NSSM), para que sobreviva a un reinicio. La URL ya es fija y el
      webhook ya apunta ahí; el servidor es lo único que todavía se arranca a mano.

### 4b · Hosting de pago (cuando aprueben)

- [ ] Contratar Railway Hobby ($5/mes). Alternativa: Render Starter ($7/mes).
- [ ] Configurar las variables de entorno en producción.
- [ ] Apuntar el webhook de Meta a la URL nueva y probar de punta a punta.

### El dolor que sigue vivo

**El servidor solo vive mientras la computadora esté encendida y alguien lo
arranque.** El arranque automático de 4a lo amortigua; lo resuelve del todo 4b.
La URL pública ya es fija (`https://rm-lap-03.tail65c817.ts.net/webhook`, Tailscale
Funnel persistente) y el webhook de Meta apunta ahí, verificado y probado de punta a
punta el 2026-09-15.

---

## Producción: la conversación con el jefe

Antes de que esto deje de ser prueba, hay decisiones que son suyas, no técnicas:

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
