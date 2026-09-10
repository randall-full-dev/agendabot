# TODO · agendabot

> El **futuro**: lo que falta por hacer. Lo terminado no vive aquí — se borra, su
> rastro queda en `git log` y su porqué en `DECISIONS.md`.

| Sí va aquí | No va aquí |
| --- | --- |
| Trabajo pendiente | Lo hecho (→ `git log`) |
| Bloqueos: qué espera a qué | El porqué de una decisión (→ `DECISIONS.md`) |
| Preguntas abiertas que hay que resolver | Cómo está el código hoy (→ `README.md`) |

Última revisión: **2026-09-10**

---

## Fase 4 — Despliegue (lo siguiente)

Subir el servidor a un hosting para que corra 24/7. Resuelve de un golpe los tres
dolores que hoy son manuales y frágiles (ver abajo).

- [ ] Elegir hosting (Railway o Render; deploy automático desde GitHub).
- [ ] Configurar las variables de entorno en producción.
- [ ] Prueba de punta a punta desde el teléfono contra el servidor desplegado.

### Los tres dolores que la Fase 4 elimina

Hoy, para probar en local, hace falta repetir esto a mano cada vez:

1. **El token de WhatsApp caduca cada pocas horas.** El del panel de pruebas es
   temporal. En producción hay que usar un **token de "usuario del sistema"**, que no
   expira.
2. **La URL del túnel cambia en cada reinicio.** Se usa `cloudflared` (ya instalado en
   la máquina) para exponer `localhost:3000`; su URL `*.trycloudflare.com` es distinta
   cada vez y hay que re-pegarla en el webhook del panel de Meta. En producción será
   una URL fija.
3. **Servidor y túnel solo viven mientras la computadora esté encendida.**

Mientras no haya Fase 4, el ciclo de prueba local es: `node src/index.js` + levantar
el túnel, pegar la URL en el webhook de Meta, suscribir el campo `messages`, y
regenerar el token en el `.env`.

---

## Producción: la conversación con el jefe

Antes de que esto deje de ser prueba, hay decisiones que son suyas, no técnicas:

- [ ] **Número de WhatsApp real** en vez del número de pruebas de Meta. Implica
      decidir si el bot vive en su chat propio o en otro flujo.
- [ ] **Cuenta de Apple del jefe:** que genere él su contraseña específica de app y
      pase solo esos 16 caracteres. Ver `DECISIONS.md` (2026-09-08).
- [ ] **Calendario destino real** en vez de `agendabot-pruebas`.

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
