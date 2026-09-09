// Fase 2: JSON del evento -> evento en el calendario de iCloud (CalDAV).
//
// Esta pieza NO sabe de donde salio el JSON. Recibe la forma que produce
// extractor.js y la deja escrita en el calendario. El dia que haya que soportar
// Google Calendar, se escribe otro archivo como este y el resto no se entera.

import "dotenv/config";

import { createDAVClient } from "tsdav";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const SERVIDOR = "https://caldav.icloud.com";

const ZONA = process.env.TZ || "America/Mexico_City";

// En que calendario de la cuenta se escriben los eventos.
// Vacio = el primero que devuelva iCloud.
const CALENDARIO = process.env.ICLOUD_CALENDAR_NAME || "";

// Cuanto dura un evento al que el mensaje no le puso hora de fin.
// El README lo fija en una hora.
const DURACION_POR_DEFECTO_MIN = 60;

// Se construye a la primera llamada, no al importar: asi el modulo se puede
// cargar (y probar las funciones que no tocan la red) sin credenciales.
let _cliente;

async function obtenerCliente() {
  if (_cliente) return _cliente;

  const usuario = process.env.APPLE_ID;
  const clave = process.env.APPLE_APP_PASSWORD;

  if (!usuario || !clave) {
    throw new Error(
      "Faltan APPLE_ID y/o APPLE_APP_PASSWORD en el .env.\n" +
        "APPLE_APP_PASSWORD es la contrasena especifica de app " +
        "(xxxx-xxxx-xxxx-xxxx), no la del Apple ID.",
    );
  }

  try {
    _cliente = await createDAVClient({
      serverUrl: SERVIDOR,
      credentials: { username: usuario, password: clave },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  } catch (error) {
    // El 401 de iCloud no explica nada. Casi siempre es una de dos cosas.
    if (String(error?.message ?? error).includes("401")) {
      throw new Error(
        "iCloud rechazo las credenciales (401). Revisa dos cosas:\n" +
          "  1. Que APPLE_APP_PASSWORD sea una contrasena especifica de app,\n" +
          "     generada en appleid.apple.com, y no la contrasena del Apple ID.\n" +
          "  2. Que la cuenta tenga la verificacion en dos pasos activa: sin\n" +
          "     ella Apple ni siquiera deja generar contrasenas de app.",
      );
    }
    throw error;
  }

  return _cliente;
}

// ---------------------------------------------------------------------------
//  Fechas y horas
// ---------------------------------------------------------------------------

// Las horas se mandan como hora de pared con su zona (DTSTART;TZID=zona), NO
// como instante UTC. La diferencia importa: la base de zonas horarias de iCloud
// esta desactualizada (a septiembre de 2026 todavia le pone horario de verano a
// America/Mexico_City, abolido en 2022). Un instante UTC lo convierte con esas
// reglas viejas y pinta el evento una hora corrido. Una hora de pared se
// convierte y desconvierte con las mismas reglas, buenas o malas, y el error se
// cancela: "las 10:00" se muestran a las 10:00 en la web, en el iPhone y en
// cualquier cliente. Que es, ademas, lo que la persona quiso decir.
//
// No se manda bloque VTIMEZONE: iCloud reconoce los nombres IANA y anexa su
// propia definicion al guardar (verificado leyendo de vuelta sus eventos).

const dosDigitos = (n) => String(n).padStart(2, "0");

// ("2026-09-10", "10:00") -> "20260910T100000", desplazada los minutos que se
// le pidan. La aritmetica se hace sobre la hora de pared, sin tocar zonas.
function marcaLocal(fecha, hora, masMinutos = 0) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [horas, minutos] = hora.split(":").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia, horas, minutos + masMinutos));
  return (
    d.getUTCFullYear() +
    dosDigitos(d.getUTCMonth() + 1) +
    dosDigitos(d.getUTCDate()) +
    "T" +
    dosDigitos(d.getUTCHours()) +
    dosDigitos(d.getUTCMinutes()) +
    "00"
  );
}

// 2026-09-05T22:00:00Z -> "20260905T220000Z"
function marcaUTC(instante) {
  return (
    instante.getUTCFullYear() +
    dosDigitos(instante.getUTCMonth() + 1) +
    dosDigitos(instante.getUTCDate()) +
    "T" +
    dosDigitos(instante.getUTCHours()) +
    dosDigitos(instante.getUTCMinutes()) +
    dosDigitos(instante.getUTCSeconds()) +
    "Z"
  );
}

// "2026-09-05" -> "20260905", desplazada los dias que se le pidan.
function marcaFecha(fecha, masDias = 0) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia + masDias));
  return (
    d.getUTCFullYear() +
    dosDigitos(d.getUTCMonth() + 1) +
    dosDigitos(d.getUTCDate())
  );
}

// ---------------------------------------------------------------------------
//  Construccion del .ics
// ---------------------------------------------------------------------------

// RFC 5545: en los campos de texto hay que escapar la barra, el punto y coma,
// la coma y los saltos de linea. Sin esto, una coma en el titulo parte el campo
// en dos y el evento llega mocho.
function escapar(texto) {
  return String(texto)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545: ninguna linea pasa de 75 octetos. Las que se pasan se parten y la
// continuacion arranca con un espacio. Se cuenta en bytes, no en caracteres,
// porque una tilde ocupa dos.
function plegar(linea) {
  const bytes = Buffer.from(linea, "utf8");
  if (bytes.length <= 75) return linea;

  const trozos = [];
  let inicio = 0;

  while (inicio < bytes.length) {
    // 75 el primer trozo; 74 los siguientes, porque el espacio inicial cuenta.
    let fin = Math.min(inicio + (trozos.length === 0 ? 75 : 74), bytes.length);
    // No partir a media secuencia UTF-8: retrocede hasta el inicio del caracter.
    while (fin < bytes.length && (bytes[fin] & 0xc0) === 0x80) fin--;
    trozos.push(bytes.subarray(inicio, fin).toString("utf8"));
    inicio = fin;
  }

  return trozos.join("\r\n ");
}

/**
 * JSON del extractor -> texto iCalendar.
 *
 * Funcion pura: no toca la red ni el reloj salvo por lo que se le pase. Se
 * puede probar sin credenciales.
 */
export function construirICalendar(evento, opciones = {}) {
  const { zona = ZONA, uid = randomUUID(), ahora = new Date() } = opciones;

  if (!evento.fecha) {
    throw new Error(
      "El evento no trae fecha. No hay nada que crear en el calendario: " +
        "esto es justo lo que el bot debe preguntarle al usuario antes.",
    );
  }

  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//agendabot//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${marcaUTC(ahora)}`,
  ];

  if (evento.hora_inicio) {
    const inicio = marcaLocal(evento.fecha, evento.hora_inicio);

    let fin;
    if (evento.hora_fin) {
      // "de 11 de la noche a 1" cae al dia siguiente. Sin el ajuste el evento
      // terminaria antes de empezar y iCloud lo rechaza.
      const cruzaMedianoche = evento.hora_fin <= evento.hora_inicio;
      fin = marcaLocal(evento.fecha, evento.hora_fin, cruzaMedianoche ? 24 * 60 : 0);
    } else {
      fin = marcaLocal(evento.fecha, evento.hora_inicio, DURACION_POR_DEFECTO_MIN);
    }

    lineas.push(`DTSTART;TZID=${zona}:${inicio}`, `DTEND;TZID=${zona}:${fin}`);
  } else {
    // Sin hora es un evento de dia completo. Ahi DTEND es exclusivo: para que
    // ocupe un solo dia hay que apuntar al siguiente.
    lineas.push(
      `DTSTART;VALUE=DATE:${marcaFecha(evento.fecha)}`,
      `DTEND;VALUE=DATE:${marcaFecha(evento.fecha, 1)}`,
    );
  }

  lineas.push(`SUMMARY:${escapar(evento.titulo || "Evento sin titulo")}`);

  if (evento.lugar) lineas.push(`LOCATION:${escapar(evento.lugar)}`);
  if (evento.descripcion) {
    lineas.push(`DESCRIPTION:${escapar(evento.descripcion)}`);
  }

  // `notas` a proposito no se escribe. Explica que fue lo ambiguo del mensaje,
  // y eso es material para la pregunta de confirmacion en WhatsApp, no para el
  // calendario: al evento ya creado nadie le sirve saber que hubo una duda.

  lineas.push("END:VEVENT", "END:VCALENDAR");

  return lineas.map(plegar).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
//  Calendarios
// ---------------------------------------------------------------------------

// tsdav a veces devuelve displayName como string y a veces como el objeto XML
// sin desenvolver. Normalizarlo aqui evita comparaciones que fallan sin motivo.
function nombreDe(calendario) {
  const n = calendario.displayName;
  if (typeof n === "string") return n;
  if (n && typeof n === "object") return n._cdata ?? n._text ?? "";
  return "";
}

/** Los calendarios de eventos de la cuenta. */
export async function listarCalendarios() {
  const cliente = await obtenerCliente();
  const todos = await cliente.fetchCalendars();

  // iCloud mezcla aqui las listas de recordatorios (VTODO). No son destino
  // valido para un evento: si se escribe ahi, no aparece en la app Calendario.
  return todos.filter(
    (c) => !c.components || c.components.includes("VEVENT"),
  );
}

async function elegirCalendario(nombre) {
  const calendarios = await listarCalendarios();

  if (calendarios.length === 0) {
    throw new Error("La cuenta no tiene ningun calendario de eventos.");
  }

  if (!nombre) return calendarios[0];

  const elegido = calendarios.find((c) => nombreDe(c) === nombre);
  if (!elegido) {
    throw new Error(
      `No existe el calendario "${nombre}" en la cuenta.\n` +
        "Los que hay: " +
        calendarios.map((c) => `"${nombreDe(c)}"`).join(", ") +
        ".\nAjusta ICLOUD_CALENDAR_NAME en el .env, o dejalo vacio para usar el primero.",
    );
  }

  return elegido;
}

/**
 * Crea el evento en iCloud. Devuelve con que uid y en que calendario quedo,
 * mas el .ics que se mando (util para depurar cuando el evento sale raro).
 */
export async function crearEvento(evento, opciones = {}) {
  const { nombreCalendario = CALENDARIO, zona = ZONA } = opciones;

  const cliente = await obtenerCliente();
  const calendario = await elegirCalendario(nombreCalendario);

  const uid = randomUUID();
  const ics = construirICalendar(evento, { zona, uid });

  const respuesta = await cliente.createCalendarObject({
    calendar: calendario,
    filename: `${uid}.ics`,
    iCalString: ics,
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(
      `iCloud rechazo el evento (HTTP ${respuesta.status}).` +
        (detalle ? `\nRespuesta del servidor:\n${detalle.slice(0, 500)}` : ""),
    );
  }

  return { uid, calendario: nombreDe(calendario), ics };
}

// ---------------------------------------------------------------------------
//  Modo linea de comandos
// ---------------------------------------------------------------------------
//
//   npm run calendario              lista los calendarios de la cuenta
//   npm run calendario -- --probar  crea un evento de prueba manana a las 10

const esEjecucionDirecta =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (esEjecucionDirecta) {
  const args = process.argv.slice(2);

  if (args.includes("--probar")) {
    // Manana en la zona configurada, no en la del sistema.
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const fecha = new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(manana);

    const prueba = {
      titulo: "Prueba de agendabot",
      fecha,
      hora_inicio: "10:00",
      hora_fin: "11:00",
      lugar: "Ninguno, es una prueba",
      descripcion: "Si ves esto en el calendario, la Fase 2 funciona. Se puede borrar.",
      notas: null,
      confianza: "alta",
    };

    const resultado = await crearEvento(prueba);
    console.log(
      `Evento creado en "${resultado.calendario}" el ${fecha} a las 10:00 (${ZONA}).`,
    );
    console.log(`uid: ${resultado.uid}`);
    console.log(
      "\nAbre icloud.com/calendar con esa cuenta y confirma que aparece.",
    );
  } else {
    const calendarios = await listarCalendarios();
    console.log(`\n${calendarios.length} calendario(s) de eventos:\n`);
    for (const c of calendarios) {
      const marca = nombreDe(c) === CALENDARIO ? " <- ICLOUD_CALENDAR_NAME" : "";
      console.log(`  ${nombreDe(c) || "(sin nombre)"}${marca}`);
      console.log(`      ${c.url}`);
    }
    console.log(
      CALENDARIO
        ? ""
        : "\nICLOUD_CALENDAR_NAME esta vacio: se usaria el primero de la lista.\n",
    );
  }
}
