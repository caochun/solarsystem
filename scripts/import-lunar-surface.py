"""Import NASA SVS LROC color and LOLA elevation maps (Pillow, numpy).

Original TIFFs stay in data-cache; reproducible browser derivatives and provenance
are published locally. No missing imagery or elevation is synthesized here.
"""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image

WEB = Path(__file__).resolve().parents[1]
CACHE = WEB / "data-cache/moon"
BASE = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/"
PAGE = "https://svs.gsfc.nasa.gov/4720/"


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def source(name, dimensions):
    path = CACHE / name
    if not path.exists():
        temporary = path.with_suffix(path.suffix + ".part")
        subprocess.run(["curl", "-fsSL", "--connect-timeout", "15", "--max-time", "900",
                        "--retry", "2", "-C", "-", BASE + name, "-o", str(temporary)], check=True)
        with Image.open(temporary) as image:
            image.load()
            assert image.size == dimensions
        temporary.replace(path)
    with Image.open(path) as image:
        assert image.size == dimensions
    return path, {"url": BASE + name, "sha256": sha(path), "bytes": path.stat().st_size,
                  "width": dimensions[0], "height": dimensions[1]}


def record(path, **extra):
    return {"path": str(path.relative_to(WEB / "public")), "sha256": sha(path),
            "bytes": path.stat().st_size, **extra}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    texture_dir = WEB / "public/textures"
    elevation_dir = WEB / "public/terrain"
    elevation_dir.mkdir(exist_ok=True)
    color, color_source = source("lroc_color_16bit_srgb_8k.tif", (8192, 4096))
    dem, dem_source = source("ldem_16_uint.tif", (5760, 2880))
    outputs = {}
    with Image.open(color) as image:
        # Source TIFF is sRGB, not the separate linear EXR on the source page.
        image = image.convert("RGB")
        for key, name, size in [("color", "moon-lroc-8k.jpg", (8192, 4096)),
                                ("sceneColor", "moon-lroc-4k.jpg", (4096, 2048))]:
            path = texture_dir / name
            image.resize(size, Image.Resampling.LANCZOS).save(path, quality=94, subsampling=0, optimize=True)
            outputs[key] = record(path, width=size[0], height=size[1], encoding="sRGB JPEG, 8 bit per channel")

    with Image.open(dem) as image:
        raw = np.asarray(image, dtype="<u2")
        path = elevation_dir / "moon-lola-16ppd.u16le.gz"
        path.write_bytes(gzip.compress(raw.tobytes(), compresslevel=9, mtime=0))
        outputs["elevation"] = record(path, width=5760, height=2880, encoding="gzip of row-major unsigned 16-bit little-endian samples",
            scaleMeters=0.5, offsetMeters=-10000, referenceRadiusKm=1737.4,
            minMeters=float(raw.min()) * 0.5 - 10000, maxMeters=float(raw.max()) * 0.5 - 10000)
        height = (raw.astype(np.float32) * 0.5 - 10000)
        height = np.asarray(Image.fromarray(height).resize((4096, 2048), Image.Resampling.BILINEAR))

    # Derive object-space normals from actual LOLA slopes, without relief exaggeration.
    rows, cols = height.shape
    lon = ((np.arange(cols, dtype=np.float32) + 0.5) / cols * 2 * np.pi - np.pi)[None, :]
    lat = (np.pi / 2 - (np.arange(rows, dtype=np.float32) + 0.5) / rows * np.pi)[:, None]
    dh_lon = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / (4 * np.pi / cols)
    dh_lat = np.gradient(height, -np.pi / rows, axis=0)
    radius = 1737400 + height
    east_slope = dh_lon / (radius * np.maximum(np.cos(lat), 0.01))
    north_slope = dh_lat / radius
    x = np.cos(lat) * np.cos(lon) + east_slope * np.sin(lon) + north_slope * np.sin(lat) * np.cos(lon)
    east = np.cos(lat) * np.sin(lon) - east_slope * np.cos(lon) + north_slope * np.sin(lat) * np.sin(lon)
    north = np.sin(lat) - north_slope * np.cos(lat)
    norm = np.sqrt(x*x + east*east + north*north)
    # Three SphereGeometry convention: +X = longitude zero, +Y = north, -Z = east.
    packed = np.stack([x / norm, north / norm, -east / norm], axis=2)
    path = texture_dir / "moon-lola-normals.png"
    Image.fromarray(np.rint((packed + 1) * 127.5).clip(0, 255).astype(np.uint8)).save(path, optimize=True)
    outputs["normals"] = record(path, width=cols, height=rows, encoding="linear RGB object-space XYZ normal, n = RGB / 127.5 - 1", exaggeration=1)
    scene_path = texture_dir / "moon-lola-normals-2k.png"
    with Image.open(path) as image:
        image.resize((2048,1024),Image.Resampling.BILINEAR).save(scene_path,optimize=True)
    outputs["sceneNormals"] = record(scene_path,width=2048,height=1024,encoding="linear RGB object-space normal; normalize after texture filtering",exaggeration=1)
    manifest = {
        "body": "moon", "page": PAGE, "credit": "NASA's Scientific Visualization Studio; LRO / LROC / LOLA; Ernie Wright",
        "retrieved": "2026-09-13", "colorEdition": "2025", "elevationEdition": "2019",
        "projection": {"type": "equirectangular", "longitudeLeftDeg": -180, "longitudeRightDeg": 180, "latitudeTopDeg": 90, "latitudeBottomDeg": -90, "longitudePositive": "east"},
        "sources": {"color": color_source, "elevation": dem_source}, **outputs,
        "limitations": ["LROC color covers 70 N to 70 S; NASA fills polar areas with lower-resolution monochrome albedo and inpaints small data gaps.",
                         "Color is exposure/white-balance adjusted; it is not a calibrated spectral reflectance cube.",
                         "LOLA grid is 16 pixels/degree (~1.90 km/pixel at the equator); 0.5 m encoding is not a claim of 0.5 m accuracy.",
                         "Normals affect local illumination only; no terrain silhouette, cast shadows, terrain ray tracing or lunar eclipse model."]
    }
    (WEB / "src/lunar-surface-data.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value["bytes"] for key,value in outputs.items()}), flush=True)


if __name__ == "__main__":
    main()
