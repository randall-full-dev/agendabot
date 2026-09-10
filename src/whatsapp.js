// Fase 3: todo lo que sabe hablar con WhatsApp (Meta Cloud API).
//
// Esta pieza NO decide que responder ni que hacer con los mensajes; eso es de
// index.js. Aqui solo vive el idioma de Meta: verificar el webhook, validar
// firmas, sacar los mensajes del sobre en que llegan y mandar respuestas.

import "dotenv/config";

import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * El apreton de manos inicial. Cuando registras la URL del webhook en el panel
 * de Meta, Meta hace un GET con un token que tu mismo inventaste (el que pones
 * en WHATSAPP_VERIFY_TOKEN). Si coincide, hay que devolverle el "challenge"
 * tal cual; con eso queda registrado.
 *
 * Devuelve el challenge a responder, o null si no coincide.
 */
export function verificarWebhook(query, tokenEsperado) {
  const modo = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");

  if (modo === "subscribe" && tokenEsperado && token === tokenEsperado) {
    return challenge;
  }
  return null;
}

/**
 * Cada POST de Meta viene firmado con HMAC-SHA256 del cuerpo crudo, usando el
 * "app secret" como llave. Verificarla es lo que garantiza que el mensaje
 * viene de Meta y no de cualquiera que encontro la URL.
 *
 * Comparacion en tiempo constante para no filtrar informacion por el reloj.
 */
export function firmaValida(cuerpoCrudo, encabezado, secreto) {
  if (!encabezado || !encabezado.startsWith("sha256=")) return false;

  const esperada = createHmac("sha256", secreto)
    .update(cuerpoCrudo)
    .digest("hex");
  const recibida = encabezado.slice("sha256=".length);

  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recibida));
}

/**
 * Saca los mensajes de texto del sobre en que Meta los manda (entry >
 * changes > value > messages, con varios posibles de cada uno). Ignora todo
 * lo que no sea texto: estados de entrega, reacciones, audios, imagenes.
 *
 * Devuelve [{ id, de, nombre, texto }].
 */
export function extraerMensajes(payload) {
  const mensajes = [];

  for (const entry of payload?.entry ?? []) {
    for (const cambio of entry.changes ?? []) {
      const valor = cambio.value ?? {};
      const contactos = new Map(
        (valor.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]),
      );

      for (const m of valor.messages ?? []) {
        if (m.type !== "text" || !m.text?.body) continue;
        mensajes.push({
          id: m.id,
          de: m.from,
          nombre: contactos.get(m.from) ?? "",
          texto: m.text.body,
        });
      }
    }
  }

  return mensajes;
}

/**
 * Responde por el mismo chat. `a` es el numero del destinatario tal como vino
 * en el mensaje (wa_id, ej. "5215512345678").
 */
export async function enviarMensaje(a, texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    throw new Error(
      "Faltan WHATSAPP_TOKEN y/o WHATSAPP_PHONE_ID en el .env. " +
        "Se sacan del panel de developers.facebook.com (ver .env.example).",
    );
  }

  const mandar = (destino) =>
    fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: destino,
        type: "text",
        text: { body: texto },
      }),
    });

  let respuesta = await mandar(a);

  // Quirk de Mexico en modo prueba: los mensajes entrantes llegan con wa_id
  // "521..." (el 1 viejo de moviles), pero la lista de destinatarios del
  // numero de prueba guarda la forma "52...". Responderle al wa_id da error
  // 131030; se reintenta una vez sin el 1. Con un numero real no hay lista y
  // ambas formas entregan, asi que el reintento simplemente nunca ocurre.
  if (!respuesta.ok && a.startsWith("521") && a.length === 13) {
    const cuerpo = await respuesta.text().catch(() => "");
    if (cuerpo.includes("131030")) {
      respuesta = await mandar("52" + a.slice(3));
    } else {
      throw new Error(
        `Meta rechazo el envio (HTTP ${respuesta.status}): ${cuerpo.slice(0, 300)}`,
      );
    }
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(
      `Meta rechazo el envio (HTTP ${respuesta.status}): ${detalle.slice(0, 300)}`,
    );
  }

  return respuesta.json();
}
