"""Extract the seven added planets from this OpenSpace snapshot (requires Pillow).

Run: python scripts/import-openspace.py --cache /tmp/solarspace-openspace-assets
Only the known literal fields below are read; Lua is never executed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
import subprocess
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageChops

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
PLANETS = ROOT / "data/assets/scene/solarsystem/planets"
REPOSITORY = "https://liu-se.bigbang.openspaceproject.com/request"
parser = argparse.ArgumentParser()
parser.add_argument("--cache", type=Path, required=True)
args = parser.parse_args()
args.cache.mkdir(parents=True, exist_ok=True)
(WEB / "public/textures").mkdir(parents=True, exist_ok=True)


def lua(path):
    return re.sub(r"--[^\n]*", "", path.read_text())


def fetch(url, path):
    if not path.exists():
        temporary = path.with_suffix(path.suffix + ".part")
        print(f"Downloading {url}", flush=True)
        subprocess.run(["curl", "-fsSL", "--retry", "2", "--connect-timeout", "15", "--max-time", "300", "-C", "-", url, "-o", str(temporary)], check=True)
        temporary.replace(path)
    return path


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


manifest = {"repository": REPOSITORY, "planets": {}, "textures": []}
def import_planet(body):
    globe = PLANETS / body / "globe.asset"
    source = lua(globe)
    match = re.search(r"Radii\s*=\s*(\{[^}]+\}|[\d.]+)", source)
    values = [float(n) / 1000 for n in re.findall(r"[\d.]+", match[1])]
    if len(values) == 1:
        values *= 3
    manifest["planets"][body] = {
        "radiiKm": values,
        "asset": str(globe.relative_to(ROOT)),
    }
    layer = PLANETS / body / "layers/colorlayers" / f"{body}_texture.asset"
    layer_source = lua(layer)
    identifier = re.search(r'Identifier\s*=\s*"([^"]+)"', layer_source)[1]
    version = int(re.search(r"Version\s*=\s*(\d+)", layer_source)[1])
    query = urllib.parse.urlencode({"identifier": identifier, "file_version": version, "application_version": 1})
    list_path = fetch(f"{REPOSITORY}?{query}", args.cache / f"{identifier}-{version}.txt")
    urls = {Path(urllib.parse.urlparse(url).path).name: url for url in list_path.read_text().split() if url.startswith("http")}
    filename = re.search(r'FilePath\s*=\s*texturesPath\s*\.\.\s*"([^"]+)"', layer_source)[1]
    # Venus uses the first layer, its visible clouds, rather than radar surface imagery.
    needed = [(filename, f"{body}.jpg")]
    if body == "saturn":
        manifest["saturnRings"] = {"innerKm": float(re.search(r"Offset\s*=\s*\{\s*([\d.]+)", source)[1]), "outerKm": float(re.search(r"Size\s*=\s*([\d.]+)", source)[1]) / 1000, "asset": str(globe.relative_to(ROOT))}
        needed += [("color_original_single.png", None), ("trans_original_single.png", None)]
    for original, output in needed:
        url = urls[original].replace("http://", "https://", 1)
        cached = fetch(url, args.cache / original)
        with Image.open(cached) as image:
            original_size = list(image.size)
            if output:
                image = image.convert("RGB")
                image.thumbnail((2048, 1024), Image.Resampling.LANCZOS)
                image.save(WEB / "public/textures" / output, quality=90, optimize=True)
        manifest["textures"].append({"body": body, "asset": str((layer if output else globe).relative_to(ROOT)), "identifier": identifier, "version": version, "url": url, "originalSize": original_size, "sha256Original": checksum(cached), "output": output or "saturn-rings.png"})

with ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(import_planet, ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"]))
manifest["planets"] = dict(sorted(manifest["planets"].items()))
manifest["textures"].sort(key=lambda entry: (entry["body"], entry["url"]))

# OpenSpace's advanced ring shader uses color and opacity = 1 - transparency.r.
with Image.open(args.cache / "color_original_single.png") as color, Image.open(args.cache / "trans_original_single.png") as transparency:
    color = color.convert("RGBA")
    opacity = ImageChops.invert(transparency.convert("RGB").getchannel("R"))
    opacity = opacity.resize(color.size, Image.Resampling.LANCZOS)
    color.putalpha(opacity)
    if color.height > color.width:
        color = color.transpose(Image.Transpose.TRANSPOSE)
    color = color.resize((2048, 4), Image.Resampling.LANCZOS)
    color.save(WEB / "public/textures/saturn-rings.png", optimize=True)
for entry in manifest["textures"]:
    entry["sha256Output"] = checksum(WEB / "public/textures" / entry["output"])
(WEB / "src/openspace-data.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("Imported seven planet textures, radii, and Saturn's ring profile.")
