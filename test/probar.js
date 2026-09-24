// Corre el extractor contra todos los casos y reporta que campos fallaron.
//
//   npm test                            todos los casos
//   node test/probar.js --caso 3        solo el caso 3
//   node test/probar.js --ver           imprime el JSON completo de cada caso
//
// Con banderas hay que llamar a node directo: npm 11 rechaza lo que no
// reconoce ("Unknown cli flag: --caso") aunque vaya despues de --.
//
// No es un framework de pruebas: es un banco de pruebas para afinar el prompt.
// Cuando toques el prompt del extractor, corre esto y confirma que no rompiste
// nada que antes funcionaba.

import "dotenv/config";
import { extraerEvento } from "../src/extractor.js";
import { AHORA, CASOS } from "./casos.js";

const CONCURRENCIA = 4;

// Aqui NO hay tabla de precios, y es a proposito. Hubo una y se desfaso en
// silencio: tenia sonnet-5 a $3/$15 cuando ya iba en $2/$10, asi que el banco
// imprimia un costo 50% inflado mientras el TODO, medido aparte, decia otra
// cosa. Dos fuentes de verdad para el mismo numero, y la equivocada era la que
// se imprimia en pantalla.
//
// Lo que se reporta son los tokens, que no caducan. Para pasarlos a dinero se
// multiplica por la tarifa del dia, que vive en platform.claude.com y en ningun
// otro lado. Si vuelve a hacer falta un costo, se apunta fechado en TODO.md o
// DECISIONS.md, no se cablea aqui.

const args = process.argv.slice(2);
const verboso = args.includes("--ver");
const indiceCaso = args.includes("--caso")
  ? Number(args[args.indexOf("--caso") + 1])
  : null;

const VERDE = "\x1b[32m";
const ROJO = "\x1b[31m";
const GRIS = "\x1b[90m";
const FIN = "\x1b[0m";

function comparar(esperado, obtenido) {
  const fallos = [];
  for (const [campo, valor] of Object.entries(esperado)) {
    const real = obtenido[campo];
    const ok = Array.isArray(valor) ? valor.includes(real) : real === valor;
    if (!ok) {
      const quiero = Array.isArray(valor)
        ? valor.map((v) => JSON.stringify(v)).join(" | ")
        : JSON.stringify(valor);
      fallos.push({ campo, esperado: quiero, obtenido: JSON.stringify(real) });
    }
  }
  return fallos;
}

async function correrCaso(caso, numero) {
  try {
    const evento = await extraerEvento(caso.texto, { ahora: AHORA });
    return { caso, numero, evento, fallos: comparar(caso.esperado, evento) };
  } catch (error) {
    return { caso, numero, error };
  }
}

// Ejecuta con un tope de llamadas simultaneas, conservando el orden de salida.
async function enLotes(items, tope, fn) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  const trabajadores = Array.from(
    { length: Math.min(tope, items.length) },
    async () => {
      while (siguiente < items.length) {
        const i = siguiente++;
        resultados[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(trabajadores);
  return resultados;
}

const seleccion =
  indiceCaso === null
    ? CASOS.map((c, i) => ({ ...c, _n: i + 1 }))
    : [{ ...CASOS[indiceCaso - 1], _n: indiceCaso }];

if (seleccion.some((c) => !c.texto)) {
  console.error(`No existe ese caso. Hay ${CASOS.length} casos (1-${CASOS.length}).`);
  process.exit(1);
}

const modelo = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const razonamiento = process.env.ANTHROPIC_THINKING_BUDGET
  ? `budget_tokens=${process.env.ANTHROPIC_THINKING_BUDGET}`
  : `effort=${process.env.ANTHROPIC_EFFORT || "medium"}`;

console.log(
  `\n${modelo}  ${GRIS}(${razonamiento})${FIN}\n` +
    `${GRIS}${seleccion.length} caso(s), referencia ${AHORA.toISOString()}${FIN}\n`,
);

const resultados = await enLotes(seleccion, CONCURRENCIA, (caso) =>
  correrCaso(caso, caso._n),
);

let pasaron = 0;
let tokensEntrada = 0;
let tokensSalida = 0;

for (const r of resultados) {
  const etiqueta = `${String(r.numero).padStart(2)}. ${r.caso.nombre}`;

  if (r.error) {
    console.log(`${ROJO}ERR${FIN} ${etiqueta}`);
    console.log(`    ${ROJO}${r.error.message}${FIN}\n`);
    continue;
  }

  tokensEntrada += r.evento._uso?.input_tokens ?? 0;
  tokensSalida += r.evento._uso?.output_tokens ?? 0;

  if (r.fallos.length === 0) {
    pasaron++;
    console.log(`${VERDE} OK${FIN} ${etiqueta}`);
  } else {
    console.log(`${ROJO}FAIL${FIN} ${etiqueta}`);
    console.log(`    ${GRIS}"${r.caso.texto.slice(0, 90)}..."${FIN}`);
    for (const f of r.fallos) {
      console.log(
        `    ${f.campo}: esperaba ${f.esperado}, obtuvo ${ROJO}${f.obtenido}${FIN}`,
      );
    }
  }

  if (verboso || r.fallos.length > 0) {
    console.log(
      GRIS +
        JSON.stringify(r.evento, null, 2)
          .split("\n")
          .map((l) => "    " + l)
          .join("\n") +
        FIN +
        "\n",
    );
  }
}

const total = resultados.length;
const errores = resultados.filter((r) => r.error).length;
const color = pasaron === total ? VERDE : ROJO;

let linea = `${GRIS}tokens: ${tokensEntrada} entrada, ${tokensSalida} salida`;
if (total > 0) {
  // Por mensaje es la forma util: es lo que se multiplica por la tarifa del dia
  // para sacar el costo, y lo que se compara entre modelos o niveles de effort.
  linea +=
    ` | por mensaje: ${Math.round(tokensEntrada / total)} entrada` +
    `, ${Math.round(tokensSalida / total)} salida`;
}

console.log(
  `\n${color}${pasaron}/${total} casos pasaron${FIN}` +
    (errores ? ` (${errores} con error de llamada)` : "") +
    `\n${linea}${FIN}\n`,
);

// exitCode en vez de process.exit(): deja que Node cierre los sockets abiertos
// por su cuenta. Con process.exit() en Windows, libuv aborta si todavia hay
// conexiones cerrandose.
process.exitCode = pasaron === total ? 0 : 1;
