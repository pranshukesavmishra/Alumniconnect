#!/usr/bin/env python3
"""Generated sample avatars (flat illustrated head and shoulders on a colour wash). No real people."""
import os, sys
from PIL import Image, ImageDraw

out = os.path.join(os.environ["GUIDE"], "assets", "avatars")
os.makedirs(out, exist_ok=True)
S = 4  # supersample
PEOPLE = {
    "rohan": ((38, 110, 94), (233, 180, 140), (40, 30, 28), "short"),
    "priya": ((126, 62, 120), (225, 170, 130), (30, 20, 22), "long"),
    "kavita": ((196, 112, 52), (214, 160, 120), (60, 36, 28), "long"),
    "shreya": ((52, 98, 150), (236, 188, 150), (28, 24, 30), "bob"),
    "ankit": ((60, 120, 90), (205, 150, 112), (24, 20, 20), "short"),
    "meera": ((170, 70, 90), (222, 168, 128), (36, 24, 24), "long"),
    "vikram": ((70, 80, 140), (230, 180, 142), (50, 38, 30), "short"),
    "sandeep": ((150, 110, 50), (200, 146, 108), (30, 28, 28), "short"),
    "neha": ((40, 130, 140), (228, 176, 138), (42, 28, 24), "bob"),
    "amit": ((120, 90, 60), (214, 162, 122), (26, 22, 22), "short"),
}
for key, (bg, skin, hair, style) in PEOPLE.items():
    W = 512 * S
    im = Image.new("RGB", (W, W), bg)
    d = ImageDraw.Draw(im)
    lighter = tuple(min(255, c + 40) for c in bg)
    d.ellipse([-W * 0.2, -W * 0.3, W * 0.9, W * 0.6], fill=lighter)
    shirt = tuple(max(0, c - 55) for c in bg)
    d.ellipse([W * 0.12, W * 0.66, W * 0.88, W * 1.3], fill=(245, 245, 245) if key in ("rohan", "vikram", "ankit") else shirt)
    d.rectangle([W * 0.43, W * 0.52, W * 0.57, W * 0.7], fill=tuple(int(c * 0.9) for c in skin))
    if style in ("long", "bob"):
        d.ellipse([W * 0.26, W * 0.17, W * 0.74, W * 0.66], fill=hair)
        d.rectangle([W * 0.26, W * 0.4, W * 0.74, W * (0.78 if style == "long" else 0.6)], fill=hair)
    d.ellipse([W * 0.31, W * 0.2, W * 0.69, W * 0.62], fill=skin)
    d.pieslice([W * 0.29, W * 0.14, W * 0.71, W * 0.5], 180, 360, fill=hair)
    for ex in (0.42, 0.58):
        d.ellipse([W * (ex - 0.015), W * 0.4, W * (ex + 0.015), W * 0.43], fill=(40, 30, 30))
    d.arc([W * 0.42, W * 0.46, W * 0.58, W * 0.55], 20, 160, fill=(150, 70, 70), width=int(W * 0.008))
    im = im.resize((512, 512), Image.LANCZOS)
    im.save(f"{out}/{key}.png")
print("avatars", len(PEOPLE), out)
