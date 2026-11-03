"""Single entry point for the Python helpers, so the installed app can bundle them and needs no Python on the computer."""
import importlib.util
import json
import runpy
import sys

# Named here so PyInstaller bundles them.
import document_extract  # noqa: F401
import office_create  # noqa: F401
import pdf_images  # noqa: F401
import pdf_text_extract  # noqa: F401
import tts_core  # noqa: F401
import voice_app_core  # noqa: F401

SCRIPTS = {"document_extract", "office_create", "pdf_images", "pdf_text_extract", "tts_core", "voice_app_core"}


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "--check":
        modules = ["pypdf", "sounddevice", "numpy", "speech_recognition", "pyttsx3"]
        print(json.dumps({"version": sys.version.split()[0], **{name: bool(importlib.util.find_spec(name)) for name in modules}}))
        return
    name = command[:-3] if command.endswith(".py") else command
    if name not in SCRIPTS:
        print(json.dumps({"error": f"Unknown helper: {command}"}))
        raise SystemExit(2)
    sys.argv = [name, *sys.argv[2:]]
    runpy.run_module(name, run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
