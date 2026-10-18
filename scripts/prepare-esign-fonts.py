"""Build local WOFF2 marks. Optional tooling: fonttools[woff]==4.60.1.

Run from the repository root. Inputs are pinned, hash-verified Google Fonts
originals. Modified fonts have new family names; copyright/OFL notices remain.
This script is not part of install/build or the running application.
"""
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen

from fontTools.ttLib import TTFont

REVISION = "47d54ca1ebb14fd864695f1d39dc734f39017c33"
FONTS = [
    ("nanumpenscript", "NanumPenScript-Regular.ttf", "Sendb Pen", "6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43"),
    ("nanumbrushscript", "NanumBrushScript-Regular.ttf", "Sendb Brush", "27ceaf578c96f594cdf07fe0181b251790acbb746a164e45c1f6473f89911a31"),
    ("yeonsung", "YeonSung-Regular.ttf", "Sendb Classic", "49ac2a11009f5f58307d377911eb45d210cf4c1d379d9eca38fb4cdad5491ef6"),
    ("himelody", "HiMelody-Regular.ttf", "Sendb Light", "360d2c0a880918aa48328d1d9219f5390788d09a1c9353e12b471de018673ae6"),
]
root = Path("public/esign/fonts")
root.mkdir(parents=True, exist_ok=True)
manifest = {"repository": "https://github.com/google/fonts", "revision": REVISION,
            "modifications": "Renamed families and lossless WOFF2 conversion with fonttools 4.60.1. No glyphs removed.", "fonts": []}
for directory, original, family, expected in FONTS:
    base = f"https://raw.githubusercontent.com/google/fonts/{REVISION}/ofl/{directory}"
    with urlopen(f"{base}/{original}", timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(f"Unexpected font input: {original}")
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)
    postscript = family.replace(" ", "") + "-Regular"
    names = {1: family, 2: "Regular", 3: f"Sendb: {postscript}: 2026", 4: family + " Regular", 6: postscript, 16: family, 17: "Regular", 18: family + " Regular"}
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    for name_id, value in names.items():
        font["name"].setName(value, name_id, 3, 1, 0x409)
    filename = postscript + ".woff2"
    font.flavor = "woff2"
    font.save(root / filename)
    with urlopen(f"{base}/OFL.txt", timeout=60) as response:
        (root / (directory + "-OFL.txt")).write_bytes(response.read())
    manifest["fonts"].append({"family": family, "original": original, "sourceSha256": expected,
                              "file": filename, "sha256": hashlib.sha256((root / filename).read_bytes()).hexdigest(),
                              "licenseFile": directory + "-OFL.txt"})
(root / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
