import argparse
import json
import sys
from xml.sax.saxutils import escape

import pyttsx3

# Windows keeps its newer voices, and any added in Settings > Speech, here instead of with the classic voices.
ONECORE = r"SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens"
ONECORE_PREFIX = "HKEY_LOCAL_MACHINE\\" + ONECORE + "\\"


def onecore_voices():
    found = []
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, ONECORE) as tokens:
            index = 0
            while True:
                try:
                    name = winreg.EnumKey(tokens, index)
                except OSError:
                    break
                index += 1
                try:
                    with winreg.OpenKey(tokens, name) as token:
                        label = winreg.QueryValue(token, None) or name
                except OSError:
                    label = name
                found.append({"id": ONECORE_PREFIX + name, "name": label})
    except Exception:
        pass
    return found


def use_voice(engine, voice_id):
    if not voice_id.startswith(ONECORE_PREFIX):
        engine.setProperty("voice", voice_id)
        return
    # The classic voice list doesn't include these, so the voice is handed to Windows by its registry path.
    import comtypes.client
    token = comtypes.client.CreateObject("SAPI.SpObjectToken")
    token.SetId(voice_id, "", False)
    engine.proxy._driver._tts.Voice = token


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-voices", action="store_true")
    parser.add_argument("--rate", type=int, default=175)
    parser.add_argument("--voice", default="")
    parser.add_argument("--volume", type=int, default=100)
    parser.add_argument("--pitch", type=int, default=0)
    parser.add_argument("text", nargs="*")
    args = parser.parse_args()
    try:
        engine = pyttsx3.init()
        if args.list_voices:
            voices = [{"id": v.id, "name": v.name} for v in engine.getProperty("voices")]
            print(json.dumps({"voices": voices + onecore_voices()}))
            return
        # Text arrives on stdin so long replies are not limited by the command line and cannot be read as flags.
        text = " ".join(args.text) or sys.stdin.read()
        if not text.strip():
            print("No text provided to speak.", file=sys.stderr)
            return
        engine.setProperty("rate", args.rate)
        engine.setProperty("volume", max(0, min(100, args.volume)) / 100)
        if args.voice:
            try:
                use_voice(engine, args.voice)
            except Exception as error:
                print(f"TTS voice not available, using the default: {error}", file=sys.stderr)
        # Windows reads speech markup, so the text is escaped and pitch is set around it.
        pitch = max(-10, min(10, args.pitch))
        engine.say(f'<pitch absmiddle="{pitch}">{escape(text)}</pitch>' if pitch else escape(text))
        engine.runAndWait()
    except Exception as error:
        print(f"TTS Error: {error}", file=sys.stderr)


if __name__ == "__main__":
    main()
