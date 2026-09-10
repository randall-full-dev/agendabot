// El servidor principal: recibe mensajes de WhatsApp y los convierte en
// eventos de calendario. Es el pegamento entre las tres fases:
//
//   webhook (whatsapp.js) -> extractor.js -> calendar.js -> respuesta al chat
//
//   npm start
//
// La conversacion sigue la regla de confianza del README:
//   - confianza alta y con fecha  -> crea el evento y confirma
//   - confianza media/baja        -> pregunta primero; un "si" del usuario crea
//   - sin fecha                   -> avisa que falta la fecha, no crea nada

import "dotenv/config";

import { createServer } from "node:http";
import { extraerEvento } from "./extractor.js";
import { crearEvento } from "./calendar.js";
import {
  verificarWebhook,
  firmaValida,
  extraerMensajes,
  enviarMensaje,
} from "./whatsapp.js";

const PUERTO = Number(process.env.PORT || 3000);
const RUTA = "/webhook";

// Solo estos numeros pueden usar el bot (wa_id, separados por coma). Vacio =
// cualquiera que le escriba. Para un bot de una persona, ponerlo cierra la
// puerta a que un desconocido llene el calendario.
const PERMITIDOS = (process.env.WHATSAPP_ALLOWED_NUMBERS || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

// --------------------------------------------------------------------------
//  Estado de la conversacion (en memoria)
// --------------------------------------------------------------------------

// Evento extraido con confianza media/baja, esperando el "si" del usuario.
// Uno por numero: una nueva propuesta pisa la anterior.
const pendientes = new Map();

// Meta reintenta los webhooks que no confirma a tiempo; sin esto, un reintento
// duplicaria el evento. Acotado para que no crezca sin limite.
const procesados = new Set();
function yaProcesado(id) {
  if (procesados.has(id)) return true;
  procesados.add(id);
  if (procesados.size > 1000) {
    procesados.delete(procesados.values().next().value);
  }
  return false;
}

const ES_CONFIRMACION = /^\s*(si|sí|sale|ok|dale|va|claro|correcto|confirmo)\s*[.!]*\s*$/i;

// --------------------------------------------------------------------------
//  La logica de cada mensaje
// --------------------------------------------------------------------------

function describir(evento) {
  const partes = [`"${evento.titulo}"`, evento.fecha];
  if (evento.hora_inicio) {
    partes.push(
      evento.hora_fin
        ? `de ${evento.hora_inicio} a ${evento.hora_fin}`
        : `a las ${evento.hora_inicio}`,
    );
  } else {
    partes.push("(todo el dia)");
  }
  if (evento.lugar) partes.push(`en ${evento.lugar}`);
  return partes.join(", ");
}

async function responder(mensaje) {
  const { de, texto } = mensaje;

  // ¿Es el "si" a una propuesta pendiente?
  if (ES_CONFIRMACION.test(texto)) {
    const pendiente = pendientes.get(de);
    if (!pendiente) {
      return "No tengo ningun evento esperando confirmacion. Mandame el mensaje de la cita y lo agendo.";
    }
    pendientes.delete(de);
    const r = await crearEvento(pendiente);
    return `Listo, agendado en "${r.calendario}": ${describir(pendiente)}.`;
  }

  const evento = await extraerEvento(texto);

  if (!evento.fecha) {
    return (
      "No encontre una fecha en el mensaje, asi que no agende nada." +
      (evento.notas ? `\n${evento.notas}` : "\n¿Para que dia es?")
    );
  }

  if (evento.confianza !== "alta") {
    pendientes.set(de, evento);
    return (
      `Entendi: ${describir(evento)}.` +
      (evento.notas ? `\nPero tengo una duda: ${evento.notas}` : "") +
      `\nResponde "si" para agendarlo asi, o mandame el mensaje corregido.`
    );
  }

  const r = await crearEvento(evento);
  return `Agendado en "${r.calendario}": ${describir(evento)}.`;
}

async function procesar(mensaje) {
  if (yaProcesado(mensaje.id)) return;

  if (PERMITIDOS.length && !PERMITIDOS.includes(mensaje.de)) {
    console.log(`[ignorado] mensaje de ${mensaje.de}, no esta en la lista`);
    return;
  }

  console.log(`[mensaje] ${mensaje.de}: ${mensaje.texto.slice(0, 80)}`);

  let respuesta;
  try {
    respuesta = await responder(mensaje);
  } catch (error) {
    console.error(`[error] procesando mensaje de ${mensaje.de}:`, error.message);
    respuesta =
      "Algo fallo de mi lado al procesar tu mensaje. Intentalo de nuevo en un momento.";
  }

  try {
    await enviarMensaje(mensaje.de, respuesta);
    console.log(`[respuesta] ${mensaje.de}: ${respuesta.slice(0, 80)}`);
  } catch (error) {
    console.error(`[error] enviando respuesta a ${mensaje.de}:`, error.message);
  }
}

// --------------------------------------------------------------------------
//  El servidor HTTP
// --------------------------------------------------------------------------

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => resolve(Buffer.concat(trozos)));
    req.on("error", reject);
  });
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== RUTA) {
    res.writeHead(404).end();
    return;
  }

  // El apreton de manos al registrar la URL en el panel de Meta.
  if (req.method === "GET") {
    const challenge = verificarWebhook(
      url.searchParams,
      process.env.WHATSAPP_VERIFY_TOKEN,
    );
    if (challenge) {
      console.log("[webhook] verificado por Meta");
      res.writeHead(200, { "Content-Type": "text/plain" }).end(challenge);
    } else {
      res.writeHead(403).end();
    }
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  const cuerpo = await leerCuerpo(req);

  // Sin firma valida no es Meta; se descarta sin procesar.
  const secreto = process.env.WHATSAPP_APP_SECRET;
  if (secreto) {
    const firma = req.headers["x-hub-signature-256"];
    if (!firmaValida(cuerpo, firma, secreto)) {
      console.warn("[webhook] POST con firma invalida, descartado");
      res.writeHead(401).end();
      return;
    }
  }

  let payload;
  try {
    payload = JSON.parse(cuerpo.toString("utf8"));
  } catch {
    res.writeHead(400).end();
    return;
  }

  // Responder 200 de inmediato: si Meta no lo recibe en segundos, reintenta y
  // acaba desactivando el webhook. El trabajo pesado sigue despues.
  res.writeHead(200).end();

  for (const mensaje of extraerMensajes(payload)) {
    procesar(mensaje); // sin await: cada mensaje avanza por su cuenta
  }
});

servidor.listen(PUERTO, () => {
  console.log(`agendabot escuchando en http://localhost:${PUERTO}${RUTA}`);
  if (!process.env.WHATSAPP_VERIFY_TOKEN) {
    console.warn(
      "OJO: falta WHATSAPP_VERIFY_TOKEN; la verificacion del webhook fallara.",
    );
  }
  if (!process.env.WHATSAPP_APP_SECRET) {
    console.warn(
      "OJO: falta WHATSAPP_APP_SECRET; se aceptaran POST sin verificar la firma.",
    );
  }
  if (!PERMITIDOS.length) {
    console.warn(
      "OJO: WHATSAPP_ALLOWED_NUMBERS esta vacio; cualquiera podra usar el bot.",
    );
  }
});
