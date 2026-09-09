// Fases 1 + 2 conectadas: texto libre -> JSON -> evento en iCloud.
//
//   npm run agendar -- "junta con el ingeniero el viernes a las 4"
//   npm run agendar -- --si "..."   crea aunque la confianza no sea alta
//
// Este es el pipeline completo que en la Fase 3 disparara cada mensaje de
// WhatsApp. La regla de confianza es la del README: si no es alta, el bot
// pregunta antes de crear. Aqui en la terminal, "preguntar" es ensenarte el
// JSON y pedirte el --si.

import "dotenv/config";

import { extraerEvento } from "./extractor.js";
import { crearEvento } from "./calendar.js";

const args = process.argv.slice(2);
const forzar = args.includes("--si");
const texto = args.filter((a) => a !== "--si").join(" ");

if (!texto) {
  console.error('Uso: npm run agendar -- "el mensaje, como llegaria por WhatsApp"');
  process.exit(1);
}

console.log("Extrayendo...");
const evento = await extraerEvento(texto);
console.log(JSON.stringify(evento, null, 2));

if (!evento.fecha) {
  console.log(
    "\nNo se creo ningun evento: el mensaje no trae fecha." +
      (evento.notas ? `\nEl bot preguntaria: ${evento.notas}` : ""),
  );
  process.exitCode = 1;
} else if (evento.confianza !== "alta" && !forzar) {
  console.log(
    "\nNo se creo el evento: la confianza es \"" + evento.confianza + '".' +
      (evento.notas ? `\nEl bot preguntaria: ${evento.notas}` : "") +
      "\nSi asi esta bien, repite el comando agregando --si",
  );
  process.exitCode = 1;
} else {
  console.log("\nCreando en iCloud...");
  const r = await crearEvento(evento);
  console.log(
    `Evento "${evento.titulo}" creado en "${r.calendario}": ` +
      `${evento.fecha} ${evento.hora_inicio ?? "(todo el dia)"}`,
  );
}
