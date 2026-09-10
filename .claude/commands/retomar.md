---
description: Paso 0 · dice en qué punto estamos leyendo git y TODO
---

Reconstruye el punto de retomada de agendabot. Es el **paso 0**: se ejecuta al abrir
sesión, antes de proponer o tocar nada.

**Barato y acotado.** Nadie pidió una auditoría: se trata de saber dónde nos quedamos.

## Qué mirar, en este orden

**1. Git primero — es gratis y es factual.**

```bash
git branch --show-current
git status --short
git log --oneline -8
```

agendabot trabaja en `main`. Si hay cambios sin commitear, di **de qué son** y desde
cuándo: un árbol sucio al abrir sesión significa que el cierre anterior no terminó.

**2. `TODO.md`.** El trabajo vivo y sus bloqueos. **Lo hecho no está ahí** — se borra al
cerrarlo; su rastro vive en `git log` y el porqué en `DECISIONS.md`.

## Qué NO cargar

`README.md` entero, `DECISIONS.md`, el código. Todo eso a demanda, cuando el trabajo
elegido lo pida. Este paso son tres comandos de git y una hojeada al `TODO.md`.

## Lo que no persiste entre sesiones (recordarlo)

agendabot corre en local, no desplegado. El servidor (`npm start`) y el túnel de
`cloudflared` **no siguen vivos** de una sesión a otra, y el token de WhatsApp del panel
de pruebas caduca cada pocas horas. Si la tarea es probar WhatsApp de punta a punta, hay
que volver a levantarlos y probablemente regenerar el token — no es un bug, es el estado
local (ver `TODO.md`, Fase 4).

## Qué responder

Tres líneas, en este orden. Nada de informes:

1. **Qué se hizo** — lo último, según `git log`.
2. **En qué estamos** — si el árbol tiene cambios sin commitear, dilo con de qué son; si
   está limpio, dilo tal cual.
3. **Qué falta** — el siguiente natural del `TODO.md`, en una línea. Sin desarrollarlo.
