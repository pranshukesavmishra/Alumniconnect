#!/usr/bin/env python3
"""chapters.py: merge $GUIDE/out/guide-<lang>-chapters.json into src/features/guide/chapters.json (en + hi; a missing language reuses English)."""
import json, os
out = os.path.join(os.environ["GUIDE"], "out")
res = {}
for lang in ("en", "hi"):
    p = f"{out}/guide-{lang}-chapters.json"
    src = json.load(open(p if os.path.exists(p) else f"{out}/guide-en-chapters.json"))["chapters"]
    res[lang] = [{k: c[k] for k in ("step", "start", "end")} for c in src]
json.dump(res, open("src/features/guide/chapters.json", "w"), indent=1)
print("chapters written")
