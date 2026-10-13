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

// Solo estos numeros pueden usar el bot (wa_id, separados por coma).
const PERMITIDOS = (process.env.WHATSAPP_ALLOWED_NUMBERS || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

// Sin estas dos el bot queda abierto: sin la llave de firma, cualquiera que
// encuentre la URL puede hacerse pasar por Meta; sin la lista, cualquiera que
// le escriba al numero llena el calendario y gasta la cuenta de Anthropic.
// Antes solo se avisaba en el log, pero en un servidor rentado ese aviso no lo
// lee nadie: sin ellas, el servidor no arranca.
const FALTAN = ["WHATSAPP_APP_SECRET", "WHATSAPP_ALLOWED_NUMBERS"].filter(
  (nombre) => !process.env[nombre]?.trim(),
);
if (FALTAN.length) {
  console.error(`agendabot no arranca: falta ${FALTAN.join(" y ")} (ver .env.example).`);
  process.exit(1);
}

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

// El dedup por id no basta: tras una caida, Meta vuelve a entregar los
// mensajes atrasados con ids nuevos. El 2026-10-12 tres entraron dos veces, la
// segunda copia ~50 min despues de la primera, y una cita quedo doble en el
// calendario. Tambien cubre a quien reenvia lo mismo porque el bot no
// contestaba. Se compara la hora en que se escribio cada copia, no la de
// llegada, que tras una caida se separa mucho mas.
const VENTANA_DUPLICADO_MS = 2 * 60 * 60 * 1000;
const textosVistos = new Map(); // "numero|texto" -> [ms en que se escribio, ...]
function esDuplicado({ de, texto, enviado }) {
  const clave = `${de}|${sinAcentos(texto).replace(/\s+/g, " ")}`;
  const t = enviado.getTime();
  const vistos = textosVistos.get(clave) ?? [];
  if (vistos.some((v) => Math.abs(v - t) < VENTANA_DUPLICADO_MS)) return true;
  textosVistos.set(clave, [...vistos, t]);
  if (textosVistos.size > 1000) {
    textosVistos.delete(textosVistos.keys().next().value);
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

// Cambiar o borrar una cita todavia no se puede (ver TODO). Sin esto, "cancela
// la junta del viernes" llegaba al modelo como si fuera una cita nueva. Solo
// cuenta el imperativo al inicio: "cancelar la tarjeta el lunes" si es una
// cita, y "cancelar" no coincide.
const ES_CAMBIO =
  /^(por favor\s+)?(cancela|borra|elimina|quita|anula|cambia|mueve|recorre)(me|le)?(la|lo|las|los)?\b/;

const SIN_CAMBIOS =
  "Todavía no sé cambiar ni borrar citas, solo agendarlas.\n\n" +
  "Eso se hace desde el calendario de tu iPhone: abre la cita y ahí puedes editarla o eliminarla.";

const AYUDA =
  "Mándame una cita en un mensaje y la agendo en tu calendario.\n\n" +
  "Por ejemplo: «Comida con Rosa el viernes a la 1 en el centro».";

// Lo que llega sin texto --una nota de voz, una foto, una ubicacion-- tampoco
// pasa por el modelo, pero no por ahorro: el bot no sabe leerlo. Lo que importa
// es contestar. Quedarse mudo es justo el sintoma de que el servidor se cayo
// (ver README), y quien escribio no tiene como distinguir una cosa de la otra.
const NO_TEXTO = {
  voz: ["las notas de voz", "las"],
  audio: ["los audios", "los"],
  image: ["las imágenes", "las"],
  video: ["los videos", "los"],
  document: ["los documentos", "los"],
  sticker: ["los stickers", "los"],
  location: ["las ubicaciones", "las"],
  contacts: ["los contactos", "los"],
};

function avisoSoloTexto(tipo) {
  const [nombre, pronombre] = NO_TEXTO[tipo] ?? ["eso", "lo"];
  return (
    `Por ahora solo leo texto: ${nombre} todavía no ${pronombre} entiendo.\n\n` +
    "Si me escribes la cita, la agendo."
  );
}

async function responder(mensaje) {
  const { de, texto, tipo, enviado } = mensaje;

  // Sin texto no hay nada que extraer. Se contesta aqui y no sigue: no gasta
  // una llamada al modelo y no toca lo que estuviera pendiente --si el bot
  // habia preguntado algo, la pregunta sigue en pie para el proximo mensaje.
  if (tipo !== "text") return avisoSoloTexto(tipo);

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
  if (ES_CAMBIO.test(limpio)) return SIN_CAMBIOS;

  // El dedup por texto va aqui y no al entrar el mensaje: un "hola" o un "sí"
  // repetidos son legitimos, y lo caro de repetir es lo que llega al modelo y
  // al calendario. Con algo pendiente no se aplica, porque un mismo "a las 5"
  // puede contestar dos preguntas distintas. Corre antes del primer await: dos
  // copias que entran juntas no se cuelan las dos. Null = no contestar.
  if (!pendiente && esDuplicado(mensaje)) return null;

  // Con algo pendiente, este mensaje casi siempre es la respuesta a la pregunta
  // del bot. Mandarlo solo pierde el titulo, la hora y el lugar: un "que sea el
  // 30" acababa produciendo un "Evento por confirmar" de dia completo. Se le
  // manda junto con el mensaje original, y el modelo decide si lo corrige o si
  // es una cita nueva.
  // "Mañana" se cuenta desde que se escribio el mensaje, no desde que llego:
  // tras una caida, Meta entrega horas despues lo que tenia encolado.
  const evento = await extraerEvento(texto, {
    ahora: enviado,
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

  if (!PERMITIDOS.includes(mensaje.de)) {
    console.log(`[ignorado] mensaje de ${mensaje.de}, no esta en la lista`);
    return;
  }

  console.log(
    `[mensaje] ${mensaje.de}: ` +
      (mensaje.tipo === "text" ? mensaje.texto.slice(0, 80) : `(${mensaje.tipo})`),
  );

  let respuesta;
  try {
    respuesta = await responder(mensaje);
  } catch (error) {
    console.error(`[error] procesando mensaje de ${mensaje.de}:`, error.message);
    respuesta =
      "Algo falló de mi lado al procesar tu mensaje. Inténtalo otra vez en un momento.";
  }

  if (respuesta === null) {
    console.log(`[duplicado] ${mensaje.de}: mismo texto que uno reciente, no se contesta`);
    return;
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

// Lo que manda Meta pesa unos pocos KB. El tope evita que un POST enorme, sin
// firma siquiera, se acumule entero en memoria antes de poder descartarlo.
const MAX_CUERPO = 256 * 1024;

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on("data", (t) => {
      total += t.length;
      if (total > MAX_CUERPO) return reject(new Error("cuerpo demasiado grande"));
      trozos.push(t);
    });
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

  // Si la lectura falla --cuerpo de mas, o la conexion cortada a medias-- se
  // contesta aqui. Sin el try, el rechazo quedaba sin atrapar, y en Node eso
  // tumba el proceso entero.
  let cuerpo;
  try {
    cuerpo = await leerCuerpo(req);
  } catch {
    res.writeHead(400, { Connection: "close" }).end();
    return;
  }

  // Sin firma valida no es Meta; se descarta sin procesar.
  const firma = req.headers["x-hub-signature-256"];
  if (!firmaValida(cuerpo, firma, process.env.WHATSAPP_APP_SECRET)) {
    console.warn("[webhook] POST con firma invalida, descartado");
    res.writeHead(401).end();
    return;
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
});
