"""Prueba de transcripcion: audio -> texto, con faster-whisper.

Esto NO es parte del bot. Es el banco de pruebas de la rama pruebas/notas-de-voz,
para contestar una sola pregunta: si Whisper entiende el espanol de quien le
habla al bot, con sus nombres propios y su jerga de obra. Si la respuesta es que
si, se decide como conectarlo; si es que no, se borra esta carpeta y ya.

Uso:
    .venv/Scripts/python.exe pruebas-voz/transcribir.py audio.ogg
    .venv/Scripts/python.exe pruebas-voz/transcribir.py audio.ogg --modelo large-v3
    .venv/Scripts/python.exe pruebas-voz/transcribir.py audio.ogg --dispositivo cpu

El OGG/Opus de WhatsApp se lee tal cual: faster-whisper decodifica con PyAV, que
trae ffmpeg dentro. No hace falta convertir nada ni instalar ffmpeg aparte.
"""

import argparse
import os
import sys
import sysconfig
import time
from pathlib import Path


def _registrar_dll_de_cuda():
    """Le ensena a Windows donde estan las DLL de CUDA instaladas por pip.

    cuBLAS y cuDNN llegan con `pip install nvidia-cudnn-cu12` y quedan dentro de
    site-packages/nvidia/*/bin, que no es una ruta que Windows busque sola. Sin
    esto, CTranslate2 ve la GPU y hasta carga el modelo en ella, pero truena al
    calcular: "cublas64_12.dll is not found or cannot be loaded".

    **Lo que importa es el PATH, no add_dll_directory.** Probado a base de
    fallar: add_dll_directory solo sirve cuando la DLL se pide con
    LoadLibraryEx y sus banderas de busqueda, y CTranslate2 la pide con
    LoadLibrary a secas, que mira el PATH. Se hacen las dos cosas porque no
    cuesta nada y cubre las dos formas de cargar.

    Va ANTES de importar ctranslate2 a proposito: despues ya seria tarde. En
    Linux no hace falta y la funcion se sale sin hacer nada.
    """
    if not hasattr(os, "add_dll_directory"):
        return
    raiz = Path(sysconfig.get_paths()["purelib"]) / "nvidia"
    carpetas = [str(c) for c in sorted(raiz.glob("*/bin"))]
    if not carpetas:
        return
    for carpeta in carpetas:
        os.add_dll_directory(carpeta)
    os.environ["PATH"] = os.pathsep.join(carpetas + [os.environ.get("PATH", "")])


_registrar_dll_de_cuda()

from faster_whisper import WhisperModel  # noqa: E402  (va despues del registro)
import ctranslate2  # noqa: E402


# En GPU, int8_float16 da practicamente la misma calidad que float16 y ocupa la
# mitad; con 6 GB de VRAM eso es lo que permite correr large-v3 con holgura.
# En CPU, int8 es el unico que corre a una velocidad usable.
COMPUTO = {"cuda": "int8_float16", "cpu": "int8"}


def elegir_dispositivo(pedido):
    """cuda si hay GPU y el usuario no dijo otra cosa; si no, cpu."""
    if pedido != "auto":
        return pedido
    return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"


def correr(nombre_modelo, dispositivo, args):
    """Carga el modelo y transcribe. Devuelve (trozos, info, carga, tardo).

    Cargar y transcribir van en la misma funcion a proposito. CTranslate2 carga
    el modelo en la GPU sin quejarse y falla hasta que de verdad tiene que
    calcular; separarlas dejaba la caida a CPU en el lugar equivocado.
    """
    t0 = time.perf_counter()
    modelo = WhisperModel(
        nombre_modelo, device=dispositivo, compute_type=COMPUTO[dispositivo]
    )
    carga = time.perf_counter() - t0
    print(f"  cargado en {carga:.1f} s")

    # El filtro de VAD recorta los silencios antes de transcribir. Importa aqui
    # porque Whisper, ante un silencio largo, tiende a inventarse texto --las
    # notas de voz empiezan y acaban con medio segundo de nada.
    t0 = time.perf_counter()
    segmentos, info = modelo.transcribe(
        str(args.audio),
        language=None if args.idioma == "auto" else args.idioma,
        vad_filter=not args.sin_vad,
    )

    # transcribe() devuelve un generador: nada se procesa --ni falla-- hasta que
    # se recorre. Por eso la lista se materializa aqui dentro y no fuera.
    trozos = list(segmentos)
    return trozos, info, carga, time.perf_counter() - t0


def main():
    p = argparse.ArgumentParser(description="Transcribe un audio y reporta cuanto tardo.")
    p.add_argument("audio", type=Path, help="archivo de audio (el .ogg de WhatsApp sirve directo)")
    p.add_argument("--modelo", default="small",
                   help="tiny | base | small | medium | large-v3 (por defecto: small)")
    p.add_argument("--dispositivo", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--idioma", default="es",
                   help="codigo de idioma; 'auto' deja que lo detecte solo")
    p.add_argument("--sin-vad", action="store_true",
                   help="apaga el filtro de silencios (por defecto va encendido)")
    args = p.parse_args()

    if not args.audio.exists():
        sys.exit(f"No existe el archivo: {args.audio}")

    dispositivo = elegir_dispositivo(args.dispositivo)
    print(f"Archivo:     {args.audio.name}  ({args.audio.stat().st_size / 1024:.0f} KB)")
    print(f"Modelo:      {args.modelo}")
    print(f"Dispositivo: {dispositivo} ({COMPUTO[dispositivo]})")
    print("\nCargando el modelo (la primera vez lo descarga)...")

    try:
        trozos, info, carga, tardo = correr(args.modelo, dispositivo, args)
    except Exception as e:
        if dispositivo != "cuda":
            raise
        print(f"\n  ! la GPU no sirvio ({type(e).__name__}: {e})", file=sys.stderr)
        print("  ! se reintenta por CPU\n", file=sys.stderr)
        dispositivo = "cpu"
        print(f"Dispositivo: {dispositivo} ({COMPUTO[dispositivo]})")
        trozos, info, carga, tardo = correr(args.modelo, dispositivo, args)

    print("\n--- texto ---")
    texto = " ".join(s.text.strip() for s in trozos).strip()
    print(texto if texto else "(no se entendio nada)")

    print("\n--- por segmento ---")
    for s in trozos:
        print(f"  [{s.start:6.2f} - {s.end:6.2f}]  {s.text.strip()}")

    print("\n--- medicion ---")
    print(f"  dispositivo:        {dispositivo}")
    print(f"  duracion del audio: {info.duration:.1f} s")
    print(f"  carga del modelo:   {carga:.1f} s")
    print(f"  transcripcion:      {tardo:.1f} s")
    if tardo > 0:
        print(f"  velocidad:          {info.duration / tardo:.1f}x tiempo real")
    print(f"  idioma detectado:   {info.language} (confianza {info.language_probability:.2f})")


if __name__ == "__main__":
    main()
