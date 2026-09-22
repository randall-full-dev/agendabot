// Casos de prueba del extractor.
//
// Todos comparten el mismo "ahora": jueves 27 de agosto de 2026, 15:00, hora de
// Ciudad de Mexico. Fijarlo es lo que hace que "manana" o "el proximo martes"
// tengan una respuesta correcta unica y las pruebas no cambien de resultado.
//
// Referencia de ese calendario:
//   jue 27 ago | vie 28 | sab 29 | dom 30 | lun 31 | mar 1 sep | mie 2 | jue 3
//   vie 4 | sab 5 | dom 6 | lun 7 | ... | mar 15 sep | ... | jue 1 oct
//
// En "esperado" solo pones los campos que de verdad quieres fijar. Un arreglo
// significa "cualquiera de estos vale" (util para confianza y para horas que
// admiten mas de una lectura razonable).

export const AHORA = new Date("2026-08-27T15:00:00-06:00");

export const CASOS = [
  {
    nombre: "Fecha y hora explicitas (el ejemplo del README)",
    texto:
      "Hoy en la junta con el equipo de obra, acordamos que para la siguiente sesion llevemos el reporte X y sera el dia 5 de septiembre a las 4 pm",
    esperado: {
      fecha: "2026-09-05",
      hora_inicio: "16:00",
      hora_fin: null,
      confianza: "alta",
    },
  },
  {
    nombre: "manana + hora sin am/pm",
    texto: "manana a las 10 tengo cita con el ingeniero para revisar los planos",
    esperado: {
      fecha: "2026-08-28",
      hora_inicio: "10:00",
      confianza: ["alta", "media"],
    },
  },
  {
    nombre: "proximo martes, sin hora",
    texto: "el proximo martes vemos el avance de la cimentacion",
    esperado: {
      fecha: "2026-09-01",
      hora_inicio: null,
      confianza: ["media", "baja"],
    },
  },
  {
    nombre: "en dos semanas + mediodia",
    texto: "en dos semanas junta de seguimiento con el cliente a mediodia",
    esperado: {
      fecha: "2026-09-10",
      hora_inicio: "12:00",
      confianza: ["alta", "media"],
    },
  },
  {
    nombre: "rango de horas + lugar explicito",
    texto:
      "el viernes de 9 a 11 en la sala de juntas del corporativo revisamos el presupuesto",
    esperado: {
      fecha: "2026-08-28",
      hora_inicio: "09:00",
      hora_fin: "11:00",
    },
  },
  {
    nombre: "sin fecha: no hay evento que crear",
    texto: "hay que vernos pronto para lo del contrato",
    esperado: {
      fecha: null,
      confianza: "baja",
    },
  },
  {
    nombre: "dia de semana + numero (pista doble) + am explicito",
    texto: "el lunes 7 a las 8 am supervision en la obra del hospital",
    esperado: {
      fecha: "2026-09-07",
      hora_inicio: "08:00",
      confianza: "alta",
    },
  },
  {
    nombre: "dia del mes suelto + hora vaga",
    texto: "nos vemos el 15 en la tarde para firmar",
    esperado: {
      fecha: "2026-09-15",
      hora_inicio: null,
      confianza: ["media", "baja"],
    },
  },
  {
    nombre: "hora con minutos, am/pm inferido por contexto",
    texto: "junta con los arquitectos manana 4:30",
    esperado: {
      fecha: "2026-08-28",
      hora_inicio: "16:30",
      confianza: ["media", "alta"],
    },
  },
  {
    nombre: "pasado manana, am resuelto por la palabra desayuno",
    texto: "pasado manana a las 7 desayuno con el proveedor de acero",
    esperado: {
      fecha: "2026-08-29",
      hora_inicio: "07:00",
      confianza: ["alta", "media"],
    },
  },
  {
    nombre: "mensaje largo sin puntuacion, como se escribe de verdad",
    texto:
      "oye acabo de salir de la junta con proteccion civil quedamos que el proximo jueves a las 11 am regresamos con el plan de evacuacion actualizado y los planos sellados nos vemos en sus oficinas",
    esperado: {
      fecha: "2026-09-03",
      hora_inicio: "11:00",
      confianza: "alta",
    },
  },
  {
    nombre: "recordatorio sin fecha: no es una junta",
    texto: "recordar llamar al proveedor por lo de las varillas",
    esperado: {
      fecha: null,
      confianza: "baja",
    },
  },
  {
    nombre: "fecha absoluta de otro mes, sin hora",
    texto: "el 1 de octubre es la entrega final del proyecto",
    esperado: {
      fecha: "2026-10-01",
      hora_inicio: null,
    },
  },
  {
    nombre: "duracion expresada en palabras, no como hora de fin",
    texto:
      "junta de obra el miercoles que viene a las 9 de la manana, dura hora y media",
    esperado: {
      fecha: "2026-09-02",
      hora_inicio: "09:00",
      hora_fin: "10:30",
    },
  },
  {
    nombre: "acento y mayusculas reales, con lugar y pendiente",
    texto:
      "Quedamos con Mendoza el jueves 3 a las 5 de la tarde en su oficina de Polanco para cerrar el tema del anticipo. Hay que llevar el desglose de costos.",
    esperado: {
      fecha: "2026-09-03",
      hora_inicio: "17:00",
      confianza: "alta",
    },
  },
  // Caso real, 2026-09-22: un martes, "el siguiente miercoles" se agendo para el
  // miercoles de manana con confianza alta, y la persona hablaba del de la semana
  // siguiente. Fecha equivocada y sin aviso, que es el error que este proyecto no
  // se puede permitir. Aqui el equivalente: hoy es jueves, asi que "el proximo
  // viernes" puede ser manana 28 o el 4 de septiembre. Cualquiera de las dos
  // lecturas vale; lo que NO vale es resolverlo en silencio, por eso se exige que
  // la confianza baje y que notas traiga la pregunta.
  {
    nombre: "proximo + dia que cae manana: hay que preguntar, no adivinar",
    texto:
      "quedamos con el proveedor el proximo viernes a las 10 de la manana para revisar el acero",
    esperado: {
      fecha: ["2026-08-28", "2026-09-04"],
      hora_inicio: "10:00",
      confianza: "media",
    },
  },
];
