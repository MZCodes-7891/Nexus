import argparse
import json
import math
import sys
import threading
import time

import numpy as np
import sounddevice as sd
import speech_recognition as sr


def list_devices():
    devices = [{"index": index, "name": device["name"]} for index, device in enumerate(sd.query_devices()) if device["max_input_channels"] > 0]
    print(json.dumps({"devices": devices, "default": sd.default.device[0]}, ensure_ascii=True), flush=True)


def voice_level(energy, floor):
    # Loudness is measured in decibels above the room's noise, so quiet and loud microphones both fill the range.
    # The floor is capped because someone already talking when the mic opens would otherwise read as room noise.
    decibels = 20 * math.log10(max(energy, 1.0) / min(max(floor, 40.0), 200.0))
    return min(1.0, max(0.0, (decibels - 3) / 27))


def wait_for_release(released):
    # Nexus sends a line when the button is let go. A closed pipe means Nexus went away, which ends it the same way.
    sys.stdin.readline()
    released.set()


def listen_and_transcribe(device=None, language="en-US", silence_seconds=1.2, hold=False, wait_seconds=18):
    released = threading.Event()
    if hold:
        threading.Thread(target=wait_for_release, args=(released,), daemon=True).start()
    sample_rate = 16000
    frame_seconds = 0.1
    frame_size = int(sample_rate * frame_seconds)
    no_speech_timeout = max(2, min(60, wait_seconds))
    max_phrase_seconds = 75

    try:
        recognizer = sr.Recognizer()
        with sd.InputStream(
            device=device,
            samplerate=sample_rate,
            channels=1,
            dtype="int16",
            blocksize=frame_size,
        ) as stream:
            print("STATE:listening", flush=True)
            # Measure room noise briefly so the start/stop threshold adapts to
            # the user's microphone and environment. The person may already be
            # talking, so the quietest frame counts and the audio is kept.
            # Silent frames from a microphone still waking up are not room noise.
            calibration = []
            pre_roll = []
            for _ in range(5):
                frame, _ = stream.read(frame_size)
                energy = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))
                calibration.append(energy)
                pre_roll.append(frame.tobytes())
                print(f"LEVEL:{voice_level(energy, min(calibration)):.3f}", flush=True)
            ambient_level = min([item for item in calibration if item >= 5] or calibration)
            threshold = max(260.0, min(1000.0, ambient_level * 2.6))

            frames = []
            started_at = time.monotonic()
            speech_started_at = None
            last_voice_at = None
            if max(calibration) >= threshold:
                speech_started_at = last_voice_at = started_at
                frames.extend(pre_roll)

            # Holding the button: everything counts until it is let go, pauses included.
            if hold:
                frames = list(pre_roll)
                heard = max(calibration) >= 260.0
                while not released.is_set() and time.monotonic() - started_at < max_phrase_seconds:
                    frame, _ = stream.read(frame_size)
                    energy = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))
                    ambient_level = min(ambient_level, max(energy, 5.0))
                    print(f"LEVEL:{voice_level(energy, ambient_level):.3f}", flush=True)
                    frames.append(frame.tobytes())
                    heard = heard or energy >= 260.0
                if not heard:
                    print("ERROR: No speech detected. Try again and speak closer to your microphone.", flush=True)
                    return

            while not hold and time.monotonic() - started_at < max_phrase_seconds + no_speech_timeout:
                frame, _ = stream.read(frame_size)
                raw = frame.tobytes()
                energy = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))
                print(f"LEVEL:{voice_level(energy, ambient_level):.3f}", flush=True)

                if speech_started_at is None:
                    pre_roll.append(raw)
                    pre_roll = pre_roll[-8:]
                    if energy >= threshold:
                        speech_started_at = time.monotonic()
                        last_voice_at = speech_started_at
                        frames.extend(pre_roll)
                        frames.append(raw)
                    elif time.monotonic() - started_at >= no_speech_timeout:
                        print("ERROR: No speech detected. Try again and speak closer to your microphone.", flush=True)
                        return
                    continue

                frames.append(raw)
                if energy >= threshold:
                    last_voice_at = time.monotonic()
                elif time.monotonic() - last_voice_at >= silence_seconds:
                    break

                if time.monotonic() - speech_started_at >= max_phrase_seconds:
                    break

        if not frames:
            print("ERROR: No speech detected.", flush=True)
            return

        print("STATE:transcribing", flush=True)
        audio = sr.AudioData(b"".join(frames), sample_rate, 2)
        print(recognizer.recognize_google(audio, language=language), flush=True)
    except sr.UnknownValueError:
        print("ERROR: Could not understand audio. Please try again.", flush=True)
    except sr.RequestError as error:
        print(f"ERROR: Speech recognition service failed: {error}", flush=True)
    except Exception as error:
        print(f"ERROR: {error}", flush=True)


def listen_continuously(device=None, language="ar-SA", pause_seconds=0.6, chunk_seconds=8.0):
    """Keeps listening and prints TEXT:<words> for each phrase, for following along while someone recites.
    Each phrase is transcribed in the background, so listening never stops for it. A line on stdin, or a closed pipe, ends it."""
    import queue
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sample_rate = 16000
    frame_size = int(sample_rate * 0.1)
    recognizer = sr.Recognizer()
    phrases = queue.Queue()
    stop = threading.Event()

    def transcribe():
        while True:
            data = phrases.get()
            if data is None:
                return
            try:
                text = recognizer.recognize_google(sr.AudioData(data, sample_rate, 2), language=language)
                print(f"TEXT:{text}", flush=True)
            except sr.UnknownValueError:
                print("STATE:unclear", flush=True)
            except sr.RequestError as error:
                print(f"ERROR: Speech recognition service failed: {error}", flush=True)
            except Exception as error:
                print(f"ERROR: {error}", flush=True)

    def wait_for_stop():
        sys.stdin.readline()
        stop.set()

    worker = threading.Thread(target=transcribe, daemon=True)
    worker.start()
    threading.Thread(target=wait_for_stop, daemon=True).start()
    try:
        with sd.InputStream(device=device, samplerate=sample_rate, channels=1, dtype="int16", blocksize=frame_size) as stream:
            calibration = []
            for _ in range(5):
                frame, _ = stream.read(frame_size)
                calibration.append(float(np.sqrt(np.mean(frame.astype(np.float32) ** 2))))
            ambient = min([item for item in calibration if item >= 5] or calibration)
            threshold = max(260.0, min(1000.0, ambient * 2.6))
            print("STATE:listening", flush=True)
            frames, pre_roll = [], []
            speaking = False
            started = last_voice = 0.0
            while not stop.is_set():
                frame, _ = stream.read(frame_size)
                raw = frame.tobytes()
                energy = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))
                print(f"LEVEL:{voice_level(energy, ambient):.3f}", flush=True)
                now = time.monotonic()
                if not speaking:
                    pre_roll = (pre_roll + [raw])[-5:]
                    if energy >= threshold:
                        speaking = True
                        started = last_voice = now
                        frames = list(pre_roll)
                    continue
                frames.append(raw)
                if energy >= threshold:
                    last_voice = now
                # A short pause, or a long stretch with no pause, ends the phrase so words show up while reciting.
                if now - last_voice >= pause_seconds or now - started >= chunk_seconds:
                    phrases.put(b"".join(frames))
                    print("STATE:heard", flush=True)
                    frames, pre_roll, speaking = [], [], False
            if speaking and frames:
                phrases.put(b"".join(frames))
    except Exception as error:
        print(f"ERROR: {error}", flush=True)
    phrases.put(None)
    worker.join(timeout=15)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--device", type=int, default=None)
    parser.add_argument("--language", default="en-US")
    parser.add_argument("--silence", type=float, default=1.2)
    parser.add_argument("--hold", action="store_true")
    parser.add_argument("--wait", type=float, default=18)
    parser.add_argument("--continuous", action="store_true")
    options = parser.parse_args()
    if options.list_devices:
        list_devices()
    elif options.continuous:
        listen_continuously(options.device, options.language)
    else:
        listen_and_transcribe(options.device, options.language, options.silence, options.hold, options.wait)
