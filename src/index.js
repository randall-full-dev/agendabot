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

// La misma zona que usa calendar.js: sirve para decir "hoy" y "manana" en el
// chat sin depender de la zona del sistema.
const ZONA = process.env.TZ || "America/Mexico_City";

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

// El repo escribe el codigo y los comentarios sin acentos, pero lo que lee el
// usuario no es codigo: ahi las tildes van completas. No cuestan nada --estas
// frases nunca pasan por la API-- y su ausencia es de las cosas que hacen que
// un bot suene a maquina.

// Sin acento: solo se usa para indexar por getUTCDay().
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const CON_TILDE = { miercoles: "miércoles", sabado: "sábado" };
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// El dia de hoy en la zona del calendario, no en la del sistema.
function hoyEnZona(ahora) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

// "2026-09-25" -> "el jueves 25 de septiembre". Hoy y manana se dicen por su
// nombre: nadie contesta "el 21 de septiembre" cuando puede decir "hoy".
function decirFecha(fecha, ahora) {
  if (fecha === hoyEnZona(ahora)) return "hoy";
  if (fecha === hoyEnZona(new Date(ahora.getTime() + 24 * 60 * 60 * 1000))) {
    return "mañana";
  }

  const [anio, mes, dia] = fecha.split("-").map(Number);
  const nombre = DIAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  return `el ${CON_TILDE[nombre] || nombre} ${dia} de ${MESES[mes - 1]}`;
}

// "16:00" -> "4:00 p.m.". Reloj de 12 horas porque es como se lee la hora aqui.
function decirHora(hora) {
  const [h, m] = hora.split(":").map(Number);
  const doce = h % 12 === 0 ? 12 : h % 12;
  return `${doce}:${String(m).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
}

// ["a", "b", "c"] -> "a, b y c"
function unirY(lista) {
  if (lista.length <= 1) return lista.join("");
  return `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}`;
}

// El evento como se lee en el chat: el titulo en negritas --WhatsApp entiende
// los asteriscos-- y debajo cuando y donde, un dato por renglon.
function describir(evento, ahora) {
  const lineas = [`*${evento.titulo || "Evento sin titulo"}*`];
  const cuando = decirFecha(evento.fecha, ahora);

  if (evento.hora_inicio) {
    // "a la una" en singular: "a las 1:00" no lo dice nadie.
    const inicio = decirHora(evento.hora_inicio);
    const articulo = inicio.startsWith("1:") ? "a la" : "a las";
    lineas.push(
      evento.hora_fin
        ? `${cuando}, de ${inicio} a ${decirHora(evento.hora_fin)}`
        : `${cuando}, ${articulo} ${inicio}`,
    );
  } else {
    lineas.push(`${cuando}, todo el día`);
  }

  if (evento.lugar) lineas.push(evento.lugar);
  return lineas.join("\n");
}

/**
 * Los avisos del evento, dichos como los diria una persona.
 *
 * Recibe minutos antes del inicio, tal como los devuelve crearEvento. Los de un
 * evento de dia completo no se pueden decir asi --estan anclados a las 9:00, no
 * a "tanto antes de la medianoche"--, por eso se traducen aparte.
 */
function decirAvisos(minutos, esDiaCompleto) {
  if (minutos.length === 0) return null;

  if (esDiaCompleto) {
    const dichos = [];
    if (minutos.includes(900)) dichos.push("la mañana anterior");
    if (minutos.includes(-540)) dichos.push("la mañana del día");
    // Lo que quede es el rescate de un dia completo agendado ya empezado.
    if (dichos.length === 0) return "Te aviso en un momento.";
    return `Te aviso ${unirY(dichos)}.`;
  }

  const dichos = minutos.map((m) => {
    if (m % 1440 === 0) return m === 1440 ? "un día antes" : `${m / 1440} días antes`;
    if (m % 60 === 0) return m === 60 ? "una hora antes" : `${m / 60} horas antes`;
    return `${m} ${m === 1 ? "minuto" : "minutos"} antes`;
  });
  return `Te aviso ${unirY(dichos)}.`;
}

// --------------------------------------------------------------------------
//  Lo que se contesta sin molestar al modelo
// --------------------------------------------------------------------------
//
// Un saludo no es una cita, y mandarlo al extractor cuesta una llamada entera a
// Claude para concluirlo. Estos se contestan en local: gratis y al instante.
//
// La lista es corta y de coincidencia exacta a proposito. Cualquier atajo mas
// listo --"no trae numeros, entonces no es una cita"-- se come un "nos vemos
// manana en la obra", que si lo es. Ante la duda, que se pague la llamada.

const sinAcentos = (t) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const ES_SALUDO =
  /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|que onda|saludos)$/;

const ES_CORTESIA = /^(gracias|muchas gracias|mil gracias|de nada|excelente)$/;

const AYUDA =
  "Mándame una cita en un mensaje y la agendo en tu calendario.\n\n" +
  "Por ejemplo: «Comida con Rosa el viernes a la 1 en el centro».";

async function responder(mensaje) {
  const { de, texto } = mensaje;

  // Lo que quedo esperando respuesta: { evento, texto }. El texto original hace
  // falta porque la respuesta, por si sola, casi nunca es una cita completa.
  const pendiente = pendientes.get(de);

  // ¿Es el "si" a una propuesta pendiente?
  if (ES_CONFIRMACION.test(texto)) {
    if (!pendiente) {
      return "No tengo ninguna cita esperando confirmación. Mándame el mensaje y la agendo.";
    }
    pendientes.delete(de);
    const ahora = new Date();
    const r = await crearEvento(pendiente.evento, { ahora });
    const avisos = decirAvisos(r.avisos, !pendiente.evento.hora_inicio);
    return (
      `Listo, ya la agendé.\n\n${describir(pendiente.evento, ahora)}` +
      (avisos ? `\n\n${avisos}` : "")
    );
  }

  // Se quita la puntuacion de los dos extremos: en español la pregunta abre
  // con "¿", y sin eso un "¿Que tal?" se escapaba a la llamada de pago.
  const limpio = sinAcentos(texto).replace(/^[¡¿]+|[.!?¡¿]+$/g, "").trim();
  if (ES_SALUDO.test(limpio)) return `Hola. ${AYUDA}`;
  if (ES_CORTESIA.test(limpio)) return "De nada.";

  // Con algo pendiente, este mensaje casi siempre es la respuesta a la pregunta
  // del bot. Mandarlo solo pierde el titulo, la hora y el lugar: un "que sea el
  // 30" acababa produciendo un "Evento por confirmar" de dia completo. Se le
  // manda junto con el mensaje original, y el modelo decide si lo corrige o si
  // es una cita nueva.
  const evento = await extraerEvento(texto, {
    previo: pendiente
      ? { texto: pendiente.texto, pregunta: pendiente.evento.notas }
      : null,
  });

  if (!evento.fecha) {
    // `notas` viene redactado como una pregunta directa a quien escribio (lo
    // pide asi el prompt del extractor) y nombra lo que falta en los terminos
    // del propio mensaje: "¿para que dia quieres que agende la llamada al
    // contador?" dice mas que cualquier frase fija que se pusiera aqui.
    return evento.notas || "¿Para qué día es? Sin el día no puedo agendarla.";
  }

  const ahora = new Date();

  if (evento.confianza !== "alta") {
    // Se guarda el intercambio completo, no solo el ultimo mensaje: si hay que
    // preguntar otra vez, la segunda respuesta tiene que llegar al modelo con
    // todo lo anterior o se vuelve a perder lo que ya se habia entendido.
    pendientes.set(de, {
      evento,
      texto: pendiente ? `${pendiente.texto}\n${texto}` : texto,
    });
    return (
      `Entendí esto:\n\n${describir(evento, ahora)}` +
      (evento.notas ? `\n\n${evento.notas}` : "") +
      `\n\nResponde "sí" y la agendo, o mándame el mensaje corregido.`
    );
  }

  const r = await crearEvento(evento, { ahora });
  const avisos = decirAvisos(r.avisos, !evento.hora_inicio);
  return (
    `Listo, ya la agendé.\n\n${describir(evento, ahora)}` +
    (avisos ? `\n\n${avisos}` : "")
  );
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
      "Algo falló de mi lado al procesar tu mensaje. Inténtalo otra vez en un momento.";
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
