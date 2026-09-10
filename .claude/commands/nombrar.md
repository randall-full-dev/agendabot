---
description: Utilería · compone el nombre de la sesión y entrega el /rename listo para pegar
---

Compón el nombre de la sesión actual y entrégalo listo para usar.

⚠️ **Claude no puede renombrar la sesión.** `/rename` es un comando del CLI que solo el
usuario puede teclear. Este comando compone el nombre; el renombrado es del usuario, con
un solo pegado.

## Cómo se compone

```
<tema> · <descripción>
```

- **Tema**: la parte del proyecto que se tocó. En agendabot no hay IDs ni tickets, así
  que el tema es la fase o el módulo (`fase-4`, `extractor`, `calendar`, `whatsapp`,
  `docs`) o, si la sesión no tocó código, el asunto (`retomada`, `exploración`).
- **Descripción**: qué pasó, en 3–6 palabras; en pasado si ya se hizo (`webhook probado
  end to end`), en presente si apenas empieza (`arranca despliegue`).
- Máximo ~60 caracteres, sin comillas: el nombre es el asa para `claude --resume`.

## De dónde sale

De la propia conversación y, si hace falta, de `git log --oneline -5`. **No se explora
código ni se leen documentos**: si la sesión aún no da para un nombre, se dice tal cual.

## Qué responder

Dos líneas, nada más:

1. El comando exacto, listo para copiar: `` /rename fase-3 · webhook de WhatsApp probado end to end ``
2. Una alternativa por si la primera no convence.

Sin explicar el formato ni listar opciones de más.
