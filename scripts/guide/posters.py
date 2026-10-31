#!/usr/bin/env python3
"""posters.py: poster-<lang>.webp (<= 58 KB) for public/guide from frames in $GUIDE/explore/poster-<lang>.png"""
import os
from PIL import Image
G = os.environ["GUIDE"]
for l in ("en", "hi"):
    im = Image.open(f"{G}/explore/poster-{l}.png").convert("RGB")
    out = f"public/guide/poster-{l}.webp"
    q = 72
    while True:
        im.save(out, quality=q, method=6)
        if os.path.getsize(out) <= 58000 or q <= 30:
            break
        q -= 8
    print(out, os.path.getsize(out), "q", q)
