"""Prueba de transcripcion: audio -> texto, con faster-whisper.

Esto NO es parte del bot. Es el banco de pruebas de la rama pruebas/notas-de-voz,
para contestar una sola pregunta: si Whisper entiende el espanol de quien le
habla al bot, con sus nombres propios y su jerga de obra. Si la respuesta es que
si, se decide como conectarlo; si es que no, se borra esta carpeta y ya.

Uso:
    .venv/Scripts/python.exe pruebas-voz/transcribir.py audio.ogg
    .venv/Scripts/python.exe pruebas-voz/transcribir.py pruebas-voz/audios/*.ogg
    .venv/Scripts/python.exe pruebas-voz/transcribir.py audio.ogg --modelo large-v3
    .venv/Scripts/python.exe pruebas-voz/transcribir.py audio.ogg --dispositivo cpu

Acepta varios audios de golpe: el modelo se carga una sola vez para todos.

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
    fallar: add_dll_directory solo sirve cuando la DLL se pide con LoadLibraryEx
    y sus banderas de busqueda, y CTranslate2 la pide con LoadLibrary a secas,
    que mira el PATH. Se hacen las dos cosas porque no cuesta nada.

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
    """Carga el modelo una vez y transcribe todos los audios de la tanda.

    Devuelve (resultados, carga), con resultados = [(ruta, trozos, info, tardo)].

    Carga y transcripcion viven en la misma funcion a proposito. CTranslate2
    carga el modelo en la GPU sin quejarse y falla hasta que de verdad tiene que
    calcular; si se separan, la caida a CPU queda en el lugar equivocado y no
    atrapa nada. Aqui, si algo truena, truena dentro, y el que llama reintenta
    la tanda entera por CPU.

    El modelo se carga UNA vez para toda la tanda. Con GPU eso importa mas de lo
    que parece: ademas de los ~6 s de carga, la primera transcripcion del
    proceso paga ~25 s de inicializacion de CUDA. Repetirlo por archivo seria
    medir el arranque en vez de la transcripcion.
    """
    t0 = time.perf_counter()
    modelo = WhisperModel(
        nombre_modelo, device=dispositivo, compute_type=COMPUTO[dispositivo]
    )
    carga = time.perf_counter() - t0
    print(f"  cargado en {carga:.1f} s")

    resultados = []
    for ruta in args.audios:
        # El filtro de VAD recorta los silencios antes de transcribir. Importa
        # aqui porque Whisper, ante un silencio largo, tiende a inventarse texto
        # --las notas de voz empiezan y acaban con medio segundo de nada.
        t0 = time.perf_counter()
        segmentos, info = modelo.transcribe(
            str(ruta),
            language=None if args.idioma == "auto" else args.idioma,
            vad_filter=not args.sin_vad,
        )

        # transcribe() devuelve un generador: nada se procesa --ni falla-- hasta
        # que se recorre. Por eso la lista se materializa aqui dentro.
        trozos = list(segmentos)
        resultados.append((ruta, trozos, info, time.perf_counter() - t0))

    return resultados, carga


def main():
    p = argparse.ArgumentParser(description="Transcribe audios y reporta cuanto tardo.")
    p.add_argument("audios", type=Path, nargs="+",
                   help="uno o mas archivos (el .ogg de WhatsApp sirve directo)")
    p.add_argument("--modelo", default="small",
                   help="tiny | base | small | medium | large-v3 (por defecto: small)")
    p.add_argument("--dispositivo", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--idioma", default="es",
                   help="codigo de idioma; 'auto' deja que lo detecte solo")
    p.add_argument("--sin-vad", action="store_true",
                   help="apaga el filtro de silencios (por defecto va encendido)")
    args = p.parse_args()

    for ruta in args.audios:
        if not ruta.exists():
            sys.exit(f"No existe el archivo: {ruta}")

    dispositivo = elegir_dispositivo(args.dispositivo)
    print(f"Audios:      {len(args.audios)}")
    print(f"Modelo:      {args.modelo}")
    print(f"Dispositivo: {dispositivo} ({COMPUTO[dispositivo]})")
    print("\nCargando el modelo (la primera vez lo descarga)...")

    try:
        resultados, carga = correr(args.modelo, dispositivo, args)
    except Exception as e:
        if dispositivo != "cuda":
            raise
        print(f"\n  ! la GPU no sirvio ({type(e).__name__}: {e})", file=sys.stderr)
        print("  ! se reintenta por CPU\n", file=sys.stderr)
        dispositivo = "cpu"
        print(f"Dispositivo: {dispositivo} ({COMPUTO[dispositivo]})")
        resultados, carga = correr(args.modelo, dispositivo, args)

    for ruta, trozos, info, tardo in resultados:
        print("\n" + "=" * 70)
        print(f"{ruta.name}  ({ruta.stat().st_size / 1024:.0f} KB, {info.duration:.1f} s)")
        print("=" * 70)
        texto = " ".join(s.text.strip() for s in trozos).strip()
        print(texto if texto else "(no se entendio nada)")
        if len(trozos) > 1:
            print("\n  por segmento:")
            for s in trozos:
                print(f"    [{s.start:6.2f} - {s.end:6.2f}]  {s.text.strip()}")
        print(f"\n  {tardo:.1f} s  ({info.duration / tardo:.1f}x tiempo real)"
              f"  |  idioma {info.language} ({info.language_probability:.2f})")

    audio_total = sum(r[2].duration for r in resultados)
    tardo_total = sum(r[3] for r in resultados)
    print("\n--- la tanda ---")
    print(f"  dispositivo:        {dispositivo} ({COMPUTO[dispositivo]}), modelo {args.modelo}")
    print(f"  carga del modelo:   {carga:.1f} s (una vez para los {len(resultados)})")
    print(f"  audio en total:     {audio_total:.1f} s")
    print(f"  transcribir todo:   {tardo_total:.1f} s  ({audio_total / tardo_total:.1f}x tiempo real)")


if __name__ == "__main__":
    main()
