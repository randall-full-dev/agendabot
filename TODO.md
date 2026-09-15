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

- [ ] **URL pública fija** con Tailscale Funnel (plan Personal, gratis) en vez del
      túnel efímero de `cloudflared`. Hoy el webhook de Meta apunta a una URL
      `*.trycloudflare.com` que ya está muerta.
- [ ] **Arranque automático** del servidor al encender la máquina (Programador de
      tareas o NSSM), para que sobreviva a un reinicio.
- [ ] Prueba de punta a punta desde el teléfono contra esa URL fija.

### 4b · Hosting de pago (cuando aprueben)

- [ ] Contratar Railway Hobby ($5/mes). Alternativa: Render Starter ($7/mes).
- [ ] Configurar las variables de entorno en producción.
- [ ] Apuntar el webhook de Meta a la URL nueva y probar de punta a punta.

### Los dos dolores que siguen vivos

1. **La URL del túnel cambia en cada reinicio.** Se usa `cloudflared` (ya instalado en
   la máquina) para exponer `localhost:3000`; su URL `*.trycloudflare.com` es distinta
   cada vez y hay que re-pegarla en el webhook del panel de Meta. Lo resuelve 4a.
2. **Servidor y túnel solo viven mientras la computadora esté encendida.** Lo resuelve
   4b; 4a solo lo amortigua con el arranque automático.

Mientras no esté 4a, el ciclo de prueba local es: `node src/index.js` + levantar el
túnel, pegar la URL en el webhook de Meta y suscribir el campo `messages`.

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
