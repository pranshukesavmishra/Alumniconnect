#!/usr/bin/env python3
"""tts.py <en|hi> [voice] [speed] : one wav per narration line + lines.json (durations) in $GUIDE/audio/<lang>/"""
import json, os, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

G = os.environ["GUIDE"]
lang = sys.argv[1] if len(sys.argv) > 1 else "en"
voice = sys.argv[2] if len(sys.argv) > 2 else ("af_heart" if lang == "en" else "hf_alpha")
speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
N = json.load(open(os.path.join(os.path.dirname(__file__), "narration.json")))
LINES = N[lang]
SHOWN = N.get("text_" + lang, LINES)
k = Kokoro(f"{G}/kokoro-v1.0.onnx", f"{G}/voices-v1.0.bin")
out = f"{G}/audio/{lang}"
os.makedirs(out, exist_ok=True)
meta = []
for i, text in enumerate(LINES, 1):
    s, sr = k.create(text, voice=voice, speed=speed, lang="en-us" if lang == "en" else "hi")
    a = np.abs(s)
    idx = np.where(a > 0.01)[0]
    s = s[max(idx[0] - int(0.03 * sr), 0): idx[-1] + int(0.12 * sr)]
    sf.write(f"{out}/line{i}.wav", s, sr)
    meta.append({"i": i, "text": SHOWN[i - 1], "dur": len(s) / sr, "sr": sr})
    print(i, round(len(s) / sr, 2), text[:60])
json.dump(meta, open(f"{out}/lines.json", "w"), ensure_ascii=False, indent=1)
print("voice", voice, "speed", speed, "total", round(sum(m["dur"] for m in meta), 1))
