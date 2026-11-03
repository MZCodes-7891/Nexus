import argparse
import json
import sys

import pyttsx3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-voices", action="store_true")
    parser.add_argument("--rate", type=int, default=175)
    parser.add_argument("--voice", default="")
    parser.add_argument("text", nargs="*")
    args = parser.parse_args()
    try:
        engine = pyttsx3.init()
        if args.list_voices:
            print(json.dumps({"voices": [{"id": v.id, "name": v.name} for v in engine.getProperty("voices")]}))
            return
        # Text arrives on stdin so long replies are not limited by the command line and cannot be read as flags.
        text = " ".join(args.text) or sys.stdin.read()
        if not text.strip():
            print("No text provided to speak.", file=sys.stderr)
            return
        engine.setProperty("rate", args.rate)
        if args.voice:
            engine.setProperty("voice", args.voice)
        engine.say(text)
        engine.runAndWait()
    except Exception as error:
        print(f"TTS Error: {error}", file=sys.stderr)


if __name__ == "__main__":
    main()
