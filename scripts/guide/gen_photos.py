#!/usr/bin/env python3
"""Generated sample reunion photos (illustrated scenes, no real people) + thumbnails into $GUIDE/assets/photos."""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter

out = os.path.join(os.environ["GUIDE"], "assets", "photos")
os.makedirs(out, exist_ok=True)
W, H = 1600, 1067


def grad(top, bot):
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)))
    return im


def person(d, x, y, s, shirt, skin=(220, 170, 130), hair=(40, 30, 28)):
    d.ellipse([x - s * 0.5, y - s * 2.2, x + s * 0.5, y - s * 1.2], fill=skin)
    d.pieslice([x - s * 0.55, y - s * 2.3, x + s * 0.55, y - s * 1.35], 180, 360, fill=hair)
    d.rounded_rectangle([x - s * 0.8, y - s * 1.2, x + s * 0.8, y + s * 1.2], radius=int(s * 0.4), fill=shirt)


def scene(name, sky, ground, kind, seed):
    random.seed(seed)
    im = grad(*sky)
    d = ImageDraw.Draw(im)
    if kind in ("sunset", "campus", "river"):
        d.ellipse([W * 0.68, H * 0.22, W * 0.68 + 170, H * 0.22 + 170], fill=(255, 226, 150))
    d.rectangle([0, H * 0.68, W, H], fill=ground)
    if kind == "campus":
        d.rectangle([W * 0.18, H * 0.38, W * 0.82, H * 0.68], fill=(150, 62, 52))
        d.polygon([(W * 0.14, H * 0.38), (W * 0.5, H * 0.18), (W * 0.86, H * 0.38)], fill=(120, 48, 42))
        for i in range(8):
            d.rectangle([W * (0.22 + i * 0.07), H * 0.46, W * (0.22 + i * 0.07) + 36, H * 0.6], fill=(250, 226, 170))
        d.rectangle([W * 0.46, H * 0.55, W * 0.54, H * 0.68], fill=(70, 40, 30))
    if kind == "river":
        d.rectangle([0, H * 0.7, W, H * 0.82], fill=(90, 160, 190))
        d.polygon([(0, H * 0.7), (W * 0.2, H * 0.52), (W * 0.45, H * 0.7)], fill=(98, 120, 100))
        d.polygon([(W * 0.55, H * 0.7), (W * 0.8, H * 0.5), (W, H * 0.7)], fill=(84, 108, 90))
    if kind in ("group", "dinner", "lawn"):
        cols = [(200, 70, 80), (60, 120, 170), (240, 190, 70), (90, 160, 110), (150, 90, 170), (230, 130, 60), (50, 60, 100), (200, 100, 140)]
        n = 9 if kind == "group" else 6
        for i in range(n):
            person(d, W * (0.14 + i * 0.72 / (n - 1)) + random.randint(-14, 14), H * (0.72 + 0.05 * (i % 2)), 52 + (i % 3) * 5, cols[i % len(cols)])
    if kind == "dinner":
        d.rounded_rectangle([W * 0.1, H * 0.76, W * 0.9, H * 0.9], radius=30, fill=(235, 220, 190))
        for i in range(7):
            d.ellipse([W * (0.15 + i * 0.1), H * 0.8, W * (0.15 + i * 0.1) + 70, H * 0.8 + 40], fill=(250, 250, 245))
        for i in range(14):
            x = random.randint(40, W - 40)
            d.line([(x, 0), (x, H * 0.18)], fill=(255, 236, 170), width=3)
            d.ellipse([x - 12, H * 0.18, x + 12, H * 0.18 + 24], fill=(255, 220, 120))
    if kind == "sunset":
        for i in range(10):
            person(d, W * (0.1 + i * 0.09), H * 0.9, 38, (20, 24, 40), (30, 24, 30), (20, 20, 20))
    im = im.filter(ImageFilter.GaussianBlur(1.1))
    im.save(f"{out}/{name}.jpg", quality=88)
    im.resize((480, int(480 * H / W)), Image.LANCZOS).save(f"{out}/t_{name}.jpg", quality=82)


S = [
    ("p1", ((130, 180, 230), (250, 220, 190)), (96, 140, 84), "campus", 1),
    ("p2", ((250, 150, 100), (255, 220, 150)), (80, 100, 70), "sunset", 2),
    ("p3", ((140, 190, 235), (230, 240, 250)), (100, 150, 90), "group", 3),
    ("p4", ((30, 34, 70), (90, 60, 100)), (60, 50, 60), "dinner", 4),
    ("p5", ((120, 190, 230), (200, 230, 245)), (104, 150, 96), "river", 5),
    ("p6", ((150, 200, 240), (240, 230, 200)), (110, 158, 98), "lawn", 6),
    ("p7", ((255, 170, 110), (250, 214, 160)), (86, 110, 76), "campus", 7),
    ("p8", ((110, 170, 225), (225, 238, 250)), (98, 146, 88), "group", 8),
]
for s in S:
    scene(*s)
print("photos", len(S), out)
