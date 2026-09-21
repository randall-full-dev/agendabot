// Fase 1: texto libre -> JSON estructurado del evento.
//
// Esta pieza NO habla con WhatsApp ni con el calendario. Entra texto, sale JSON.
// Todo lo que necesita saber del mundo exterior (que dia es hoy) se le pasa como
// parametro, para que las pruebas sean deterministas.

// Carga el .env si existe. No pisa variables que ya esten en el entorno.
import "dotenv/config";

import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";

const MODELO = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// Cuanto razona el modelo antes de responder: low | medium | high | xhigh | max.
// medium es un buen punto de partida para extraccion. Si fallan las fechas
// relativas raras, sube a high y vuelve a correr las pruebas.
//
// "ninguno" omite el parametro por completo. Hace falta con claude-haiku-4-5,
// que no acepta effort y devuelve un 400 si se lo mandas.
const ESFUERZO = process.env.ANTHROPIC_EFFORT || "medium";

// Presupuesto de razonamiento en tokens, para los modelos de generacion anterior
// (claude-haiku-4-5) que no entienden "effort" pero si aceptan un numero.
// Vacio = el modelo responde sin razonamiento explicito.
// Si lo pones, "effort" se omite solo: son dos formas de lo mismo y los modelos
// aceptan una u otra, nunca las dos.
const PRESUPUESTO = process.env.ANTHROPIC_THINKING_BUDGET || "";

const ZONA = process.env.TZ || "America/Mexico_City";

// Se construye a la primera llamada, no al importar: asi el modulo se puede
// cargar (y probar sus funciones puras) sin tener la llave configurada.
let _cliente;
function obtenerCliente() {
  if (!_cliente) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "Falta ANTHROPIC_API_KEY. Copia .env.example a .env y pon tu llave.",
      );
    }
    _cliente = new Anthropic();
  }
  return _cliente;
}

/**
 * El contrato de salida. El modelo no puede devolver otra forma: la API valida
 * la respuesta contra este esquema antes de entregarla.
 */
export const ESQUEMA_EVENTO = {
  type: "object",
  properties: {
    titulo: {
      type: "string",
      description:
        "Nombre corto del evento, como se veria en el calendario. Maximo ~60 caracteres. " +
        "Es el NOMBRE de la reunion o compromiso, no la tarea pendiente.",
    },
    fecha: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Fecha del evento en formato YYYY-MM-DD. null si el mensaje no permite determinarla.",
    },
    hora_inicio: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Hora de inicio en formato HH:MM de 24 horas. null si no se menciona una hora concreta.",
    },
    hora_fin: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Hora de fin en formato HH:MM de 24 horas. null salvo que el mensaje la diga explicitamente.",
    },
    lugar: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Lugar del evento. null si el mensaje no lo menciona.",
    },
    descripcion: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Detalles, acuerdos y pendientes mencionados. null si no hay nada mas que el titulo.",
    },
    confianza: {
      type: "string",
      enum: ["alta", "media", "baja"],
      description:
        "alta = fecha y hora inequivocas. media = una de las dos se infirio. baja = falta un dato clave.",
    },
    notas: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Si la confianza no es alta, la pregunta que hay que hacerle a quien mando el mensaje, " +
        "dirigida a esa persona y en una sola frase, tal como la va a leer en el chat. " +
        "null si la confianza es alta.",
    },
  },
  required: [
    "titulo",
    "fecha",
    "hora_inicio",
    "hora_fin",
    "lugar",
    "descripcion",
    "confianza",
    "notas",
  ],
  additionalProperties: false,
};

/**
 * Calcula como se ve "ahora" en la zona horaria configurada.
 * El modelo no sabe que dia es hoy; hay que decirselo o inventa.
 */
export function contextoTemporal(ahora, zona = ZONA) {
  const partes = (opciones) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("es-MX", { timeZone: zona, ...opciones })
        .formatToParts(ahora)
        .map((p) => [p.type, p.value]),
    );

  const numerico = partes({
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const { weekday } = partes({ weekday: "long" });
  const { month: mesLargo } = partes({ month: "long" });

  // Intl devuelve "24" para la medianoche en algunos entornos.
  const hora = numerico.hour === "24" ? "00" : numerico.hour;

  return {
    fecha: numerico.year + "-" + numerico.month + "-" + numerico.day,
    hora: hora + ":" + numerico.minute,
    diaSemana: weekday,
    legible:
      weekday + " " + numerico.day + " de " + mesLargo + " de " + numerico.year,
    zona,
  };
}

function promptSistema(ctx) {
  return [
    "Eres el motor de extraccion de un bot de agenda personal. Recibes un mensaje",
    "de WhatsApp escrito de forma informal en espanol de Mexico y devuelves los",
    "datos del evento de calendario que ese mensaje describe.",
    "",
    "## Referencia temporal (usala para toda fecha relativa)",
    "",
    "- Ahora mismo es: " + ctx.legible + ", " + ctx.hora + " horas.",
    "- En formato ISO: " + ctx.fecha + ", hora " + ctx.hora + ".",
    "- Zona horaria: " + ctx.zona + ".",
    "",
    "## Como resolver fechas",
    "",
    '- "manana" = el dia siguiente a hoy. "pasado manana" = dos dias despues de hoy.',
    '- "el martes", "el viernes" = la proxima vez que caiga ese dia, contando desde',
    "  manana. Si hoy es martes y dicen \"el martes\", hablan del de la semana que entra.",
    '- "el proximo martes" = igual que arriba: el siguiente martes que venga.',
    '- "en dos semanas" = hoy mas 14 dias. "en un mes" = mismo dia del mes siguiente.',
    '- "el 15", "el dia 5" sin mes = el proximo dia 15 o 5 que llegue. Si ese numero',
    "  ya paso este mes, es del mes siguiente.",
    '- Un dia de la semana junto a un numero ("el lunes 7") es una pista doble:',
    "  usala para confirmar que el mes es el correcto.",
    "",
    "## Como resolver horas",
    "",
    '- Convierte todo a 24 horas: "4 pm" = 16:00, "8 de la manana" = 08:00.',
    '- "medio dia" = 12:00. "media noche" = 00:00.',
    "- Una hora sin am/pm es ambigua salvo que el contexto la resuelva. Las juntas",
    "  de trabajo entre 7 y 11 suelen ser de la manana; entre 1 y 7, de la tarde.",
    '  Elige la mas probable, pero baja la confianza a "media" y dilo en notas.',
    '- Vaguedades como "en la tarde" o "temprano" NO son una hora. Deja hora_inicio',
    "  en null, guarda la pista en descripcion y reduce la confianza.",
    '- hora_fin solo si el mensaje la dice ("de 9 a 11", "dura una hora"). Si no,',
    "  null: el sistema le pondra una hora de duracion por defecto.",
    "",
    "## Titulo y descripcion",
    "",
    '- El titulo nombra el compromiso ("Junta con equipo de obra"), no la tarea que',
    "  hay que llevar. Sin fechas ni horas dentro del titulo.",
    "- La descripcion recoge acuerdos, pendientes y participantes. No repitas el titulo.",
    "- lugar solo si el mensaje lo menciona de forma explicita. No lo deduzcas.",
    "",
    "## Confianza",
    "",
    '- "alta": fecha y hora quedaron claras sin adivinar nada.',
    '- "media": tuviste que inferir am/pm, o el dia se dedujo del contexto.',
    '- "baja": falta la fecha, o el mensaje no describe un compromiso concreto.',
    "",
    'Cuando la confianza no sea "alta", escribe en notas la pregunta que hay que',
    "hacerle a la persona que mando el mensaje. Ojo: la va a leer tal cual en el",
    "chat, asi que dirigete a ella, en una sola frase, con sus acentos y sin",
    "tecnicismos. No describas el problema: pregunta.",
    "",
    '  Bien: "¿Es a las 4 de la tarde o de la mañana?"',
    '  Mal:  "El usuario no especifico si am o pm."',
    "",
    "Nunca inventes datos que el mensaje no contiene. Un campo vacio es correcto;",
    "un campo inventado rompe la agenda del usuario.",
  ].join("\n");
}

/**
 * Extrae los datos del evento de un mensaje en texto libre.
 *
 * @param {string} texto - El mensaje tal cual lo escribio el usuario.
 * @param {object} [opciones]
 * @param {Date}   [opciones.ahora] - Momento de referencia. Fijalo en las pruebas.
 * @param {string} [opciones.zona]  - Zona horaria IANA.
 * @param {string} [opciones.modelo]
 * @param {string} [opciones.esfuerzo]
 * @returns {Promise<object>} El evento conforme a ESQUEMA_EVENTO.
 */
export async function extraerEvento(texto, opciones = {}) {
  if (typeof texto !== "string" || texto.trim() === "") {
    throw new Error("extraerEvento necesita un texto no vacio.");
  }

  const {
    ahora = new Date(),
    zona = ZONA,
    modelo = MODELO,
    esfuerzo = ESFUERZO,
    presupuesto = PRESUPUESTO,
  } = opciones;

  const ctx = contextoTemporal(ahora, zona);

  const MAX_TOKENS = 16000;

  // Un presupuesto de razonamiento y un nivel de esfuerzo son la misma idea
  // expresada distinto. Ningun modelo acepta los dos, asi que el presupuesto
  // manda: si esta puesto, el esfuerzo se omite.
  const conPresupuesto = presupuesto !== "" && presupuesto != null;
  const sinEsfuerzo =
    conPresupuesto ||
    ["ninguno", "none", "off", ""].includes(String(esfuerzo).toLowerCase());

  let thinking;
  if (conPresupuesto) {
    const tokens = Number(presupuesto);
    if (!Number.isInteger(tokens) || tokens < 1024) {
      throw new Error(
        `ANTHROPIC_THINKING_BUDGET debe ser un entero >= 1024 (recibi "${presupuesto}").`,
      );
    }
    if (tokens >= MAX_TOKENS) {
      throw new Error(
        `ANTHROPIC_THINKING_BUDGET (${tokens}) debe ser menor que max_tokens (${MAX_TOKENS}).`,
      );
    }
    thinking = { type: "enabled", budget_tokens: tokens };
  }

  let respuesta;
  try {
    respuesta = await obtenerCliente().messages.create({
      model: modelo,
      max_tokens: MAX_TOKENS,
      system: promptSistema(ctx),
      ...(thinking ? { thinking } : {}),
      output_config: {
        // Los modelos de generacion anterior (haiku) no aceptan effort: se omite.
        ...(sinEsfuerzo ? {} : { effort: esfuerzo }),
        format: { type: "json_schema", schema: ESQUEMA_EVENTO },
      },
      messages: [{ role: "user", content: texto }],
    });
  } catch (error) {
    // Traduce los dos choques modelo/parametro a algo accionable, en vez de
    // dejar pasar el JSON crudo del 400.
    const mensaje = String(error?.message ?? "");
    if (mensaje.includes("effort")) {
      throw new Error(
        `El modelo ${modelo} no acepta ANTHROPIC_EFFORT. En tu .env pon ` +
          `ANTHROPIC_EFFORT=ninguno, o usa ANTHROPIC_THINKING_BUDGET (un entero ` +
          `>= 1024) que es la perilla equivalente en ese modelo.`,
      );
    }
    if (mensaje.includes("thinking") || mensaje.includes("budget_tokens")) {
      throw new Error(
        `El modelo ${modelo} no acepta ANTHROPIC_THINKING_BUDGET. Borra esa ` +
          `variable de tu .env y usa ANTHROPIC_EFFORT (low|medium|high|xhigh|max).`,
      );
    }
    throw error;
  }

  if (respuesta.stop_reason === "refusal") {
    const motivo = respuesta.stop_details?.explanation || "sin detalle";
    throw new Error("El modelo declino procesar el mensaje: " + motivo);
  }

  if (respuesta.stop_reason === "max_tokens") {
    throw new Error(
      "La respuesta se corto por limite de tokens. Sube max_tokens en extractor.js.",
    );
  }

  const bloque = respuesta.content.find((b) => b.type === "text");
  if (!bloque) {
    throw new Error("La respuesta no trajo ningun bloque de texto.");
  }

  const evento = JSON.parse(bloque.text);

  // Metadata para depurar. No enumerable, para que no ensucie un JSON.stringify.
  Object.defineProperty(evento, "_uso", {
    value: respuesta.usage,
    enumerable: false,
  });

  return evento;
}

// Modo linea de comandos:  npm run extraer -- "texto del mensaje"
const esEjecucionDirecta =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esEjecucionDirecta) {
  const texto = process.argv.slice(2).join(" ");
  if (!texto) {
    console.error('Uso: npm run extraer -- "el mensaje de WhatsApp"');
    process.exit(1);
  }
  const evento = await extraerEvento(texto);
  console.log(JSON.stringify(evento, null, 2));
  console.error(
    "\n[tokens] entrada " +
      evento._uso.input_tokens +
      ", salida " +
      evento._uso.output_tokens,
  );
}
