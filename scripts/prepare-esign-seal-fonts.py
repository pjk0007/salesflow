"""Build optional seal fonts with fonttools[woff]==4.60.1.

Download the original school font from its official KERIS page, then run:
  python scripts/prepare-esign-seal-fonts.py --school-font path/to/Hakgyoansim_SangjangR.woff
The source is checked by SHA-256. No temporary CDN authorization URL is saved.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument("--school-font", type=Path, required=True)
args = parser.parse_args()
root = Path("public/esign/fonts")
revision = "47d54ca1ebb14fd864695f1d39dc734f39017c33"
base = f"https://raw.githubusercontent.com/google/fonts/{revision}/ofl/nanummyeongjo"
with urlopen(base + "/NanumMyeongjo-ExtraBold.ttf", timeout=60) as response:
    serif = response.read()
with urlopen(base + "/OFL.txt", timeout=60) as response:
    serif_license = response.read().decode("utf-8")
school_license = "Copyright (c) 2025 by KERIS. All rights reserved.\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\n\n" + serif_license[serif_license.index("SIL OPEN FONT LICENSE\n"):]
fonts = [
    (serif, "60c0077fce069ba90ae97c0a3679f6eb3712e0ca637bdd0c15b72d335ec46db7", "Sendb Seal Serif", "NanumMyeongjo-ExtraBold.ttf", base, serif_license),
    (args.school_font.read_bytes(), "a59aca61d4c142a3d555505bdbffe1c18e3c50f5a20502d1e0ce5246f16f197f", "Sendb Seal Formal", "Hakgyoansim_SangjangR.woff", "https://copyright.keris.or.kr/wft/fntDwnldView?fntGrpId=GFT202509240000000000004", school_license),
]
manifest = {"modifications": "Renamed families and converted to WOFF2 with fonttools 4.60.1. All glyphs retained.", "fonts": []}
for data, expected, family, original, source, license_text in fonts:
    assert hashlib.sha256(data).hexdigest() == expected, "Unexpected source font: " + original
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
    license_file = postscript + "-OFL.txt"
    (root / license_file).write_text(license_text, encoding="utf-8")
    manifest["fonts"].append({"family": family, "original": original, "source": source, "sourceSha256": expected,
                              "file": filename, "sha256": hashlib.sha256((root / filename).read_bytes()).hexdigest(), "licenseFile": license_file})
(root / "seal-sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
