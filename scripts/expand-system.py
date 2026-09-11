"""Import major satellites, dwarf planets, and distant bodies from OpenSpace."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import threading
import numpy as np
from PIL import Image
import spiceypy as spice
from resources import WEB, ROOT, CACHE, resource, resource_file, text_asset, digest, fetch
from spk import RemoteSPK

BASE = "data/assets/scene/solarsystem/"
EPOCH = "2026-09-10T00:00:00Z"
EPOCH_MS = datetime.fromisoformat(EPOCH.replace("Z", "+00:00")).timestamp() * 1000
# ET is TDB seconds from J2000, with current UTC/TAI leap-second offset.
et = (EPOCH_MS - datetime(2000, 1, 1, 12, tzinfo=timezone.utc).timestamp() * 1000) / 1000 + 69.184
et += .001657 * math.sin(math.radians(357.53 + .9856003 * et / 86400))
GM = {"mars": 42828.375214, "jupiter": 126686534.911, "saturn": 37931207.8, "uranus": 5793951.3, "neptune": 6835099.97, "pluto": 975.5}
PARENTS = {"mars": 499, "jupiter": 599, "saturn": 699, "uranus": 799, "neptune": 899, "pluto": 999}
SATS = [
    ("phobos", "火卫一", "mars", 401), ("deimos", "火卫二", "mars", 402),
    ("io", "木卫一", "jupiter", 501), ("europa", "木卫二", "jupiter", 502),
    ("ganymede", "木卫三", "jupiter", 503), ("callisto", "木卫四", "jupiter", 504),
    ("mimas", "土卫一", "saturn", 601), ("enceladus", "土卫二", "saturn", 602),
    ("tethys", "土卫三", "saturn", 603), ("dione", "土卫四", "saturn", 604),
    ("rhea", "土卫五", "saturn", 605), ("titan", "土卫六", "saturn", 606),
    ("hyperion", "土卫七", "saturn", 607), ("iapetus", "土卫八", "saturn", 608),
    ("ariel", "天卫一", "uranus", 701), ("umbriel", "天卫二", "uranus", 702),
    ("titania", "天卫三", "uranus", 703), ("oberon", "天卫四", "uranus", 704),
    ("miranda", "天卫五", "uranus", 705),
    ("triton", "海卫一", "neptune", 801), ("nereid", "海卫二", "neptune", 802),
    ("charon", "冥卫一", "pluto", 901), ("nix", "冥卫二", "pluto", 902),
    ("hydra", "冥卫三", "pluto", 903), ("kerberos", "冥卫四", "pluto", 904), ("styx", "冥卫五", "pluto", 905),
]
DISTANT = [("ceres", "谷神星"), ("pluto", "冥王星"), ("eris", "阋神星"), ("haumea", "妊神星"), ("makemake", "鸟神星"), ("vesta", "灶神星"), ("sedna", "塞德娜"), ("quaoar", "创神星"), ("gonggong", "共工星"), ("orcus", "亡神星")]
KERNELS = {"mars": (1, "mar097.bsp"), "jupiter": (3, "jup365.bsp"), "saturn": (3, "sat441.bsp"), "uranus": (3, "ura111.bsp"), "neptune": (3, "nep097.bsp"), "pluto": (1, "ssd_jpl_nasa_gov_plu043.bsp")}
manifest = {"epoch": EPOCH, "bodies": {}, "resources": [], "spk": [], "notes": ["SPK epoch states propagated as fixed two-body osculating ellipses; not full SPICE at arbitrary dates.", "Satellite dimensions use the general PCK referenced by OpenSpace; original asset values retained for auditing."]}
pck_path, pck_source = resource_file("general_pck", 1, "pck00011.tpc")
manifest["resources"].append(pck_source)
spice.furnsh(str(pck_path))
spice_lock = threading.Lock()


def raw_radii(path):
    if not (ROOT / path).exists(): return None
    m = re.search(r"Radii\s*=\s*(\{[^}]+\}|[\d.]+)", text_asset(path))
    if not m: return None
    values = [float(n) / 1000 for n in re.findall(r"[\d.]+", m[1])]
    return values * 3 if len(values) == 1 else values


def orbit_from_state(state, mu):
    with spice_lock:
        rp, eccentricity, inc, node, peri, mean, _, _ = spice.oscelt(state, et, mu)
    a = rp / (1 - eccentricity)
    if not 0 <= eccentricity < 1: raise ValueError("Non-elliptic state")
    return {"a": float(a / 149597870.7), "e": float(eccentricity), "i": float(np.rad2deg(inc)), "node": float(np.rad2deg(node)), "peri": float(np.rad2deg(peri)), "m": float(np.rad2deg(mean)), "period": float(2 * np.pi * np.sqrt(a ** 3 / mu) / 86400), "epoch": EPOCH_MS}


def import_satellites(parent):
    version, filename = KERNELS[parent]
    kernel = RemoteSPK(resource(f"{parent}_kernels", version)[filename])
    for id, name, group, naif in SATS:
        if group != parent: continue
        folder = f"dwarf_planets/pluto/moons/{id}" if group == "pluto" else f"planets/{group}/{'moons/' if group == 'mars' else ''}{id}"
        asset = BASE + folder + "/globe.asset"
        if parent == "neptune" and id == "nereid":
            manifest["spk"].append(kernel.provenance())
            neptune_kernel = kernel
            kernel = RemoteSPK(resource("neptune_kernels", version)["nep101xl-802.bsp"])
        if id == "nereid":
            state, center = kernel.state(naif, et)
            if center != 899:
                planet, planet_center = neptune_kernel.state(899, et)
                assert center == planet_center
                state -= planet
        else:
            state = kernel.relative(naif, PARENTS[parent], et) if parent != "pluto" or id == "charon" else kernel.state(naif, et)[0]
        # Pluto's large companion contributes materially to the relative orbit.
        mu = GM[parent] if parent != "pluto" else 975.5
        orbit = orbit_from_state(state, mu)
        try:
            with spice_lock:
                radii = spice.bodvcd(naif, "RADII", 3)[1].tolist()
        except spice.utils.exceptions.SpiceyError: radii = raw_radii(asset)
        entry = {"name": name, "english": id.upper(), "parent": parent, "category": "satellite", "naif": naif,
                 "radiiKm": radii, "assetRadiiKm": raw_radii(asset), "asset": asset, "orbit": orbit,
                 "orbitSource": "Astronomy Engine / L1" if parent == "jupiter" else "OpenSpace SPK epoch / Kepler approximation",
                 "stateKm": state.tolist(), "stateEpochET": et, "gmKm3S2": mu,
                 "texture": None, "surface": "无全球影像，使用纯色形状示意", "rotationDays": orbit["period"]}
        entry["radiiSource"] = "OpenSpace general_pck / pck00011.tpc"
        if parent == "pluto" and id != "charon":
            entry["radiusQuality"] = "placeholder"
            entry["surface"] = "原资产与参数核中的历史占位尺寸；球体仅作定位，尚未接入新视野号形状数据"
        manifest["bodies"][id] = entry
        print(f"Satellite {id}: {orbit['period']:.4f} days", flush=True)
    manifest["spk"].append(kernel.provenance())


def import_distant():
    for id, name in DISTANT:
        folder = BASE + f"dwarf_planets/{id}"
        asset = folder + "/globe.asset"
        original = raw_radii(asset)
        dimensions = {"eris": [1163] * 3, "haumea": [1161, 852, 513], "makemake": [715] * 3,
                      "sedna": [497.5] * 3, "quaoar": [569, 569, 518], "orcus": [455, 455, 458.5]}
        if id in ["ceres", "pluto", "vesta"]:
            radii = spice.bodvcd({"ceres": 2000001, "pluto": 999, "vesta": 2000004}[id], "RADII", 3)[1].tolist()
        else: radii = dimensions.get(id, original)
        entry = {"name": name, "english": id.upper(), "parent": "sun", "category": "dwarf" if id in ["ceres", "pluto", "eris", "haumea", "makemake"] else "minor",
                 "radiiKm": radii, "assetRadiiKm": original, "asset": asset if original else folder + "/model.asset",
                 "orbitSource": "OpenSpace Kepler elements", "texture": None, "surface": "无全球影像，使用纯色形状示意"}
        if id == "pluto":
            entry["orbitSource"] = "Astronomy Engine"
            entry["rotationDays"] = 6.38723
        elif id != "ceres":
            source = text_asset(folder + "/transforms.asset")
            def number(key): return float(re.search(rf"{key}\s*=\s*([-+\d.eE]+)", source)[1])
            epoch_text = re.search(r'Epoch\s*=\s*"([^"]+)"', source)[1]
            date = datetime.strptime(epoch_text, "%Y %m %d %H:%M:%S" if len(epoch_text) > 16 else "%Y %m %d %H:%M").replace(tzinfo=timezone.utc)
            entry["orbit"] = {"a": number("SemiMajorAxis") * 149600000 / 149597870.7, "e": number("Eccentricity"), "i": number("Inclination"), "node": number("AscendingNode"), "peri": number("ArgumentOfPeriapsis"), "m": number("MeanAnomaly"), "period": number("Period"), "epoch": date.timestamp() * 1000}
            rotation = text_asset(entry["asset"])
            match = re.search(r"RotationRate\s*=\s*1.0\s*/\s*\(([\d.]+)", rotation)
            entry["rotationDays"] = float(match[1]) / 24 if match else None
        entry["radiiSource"] = "OpenSpace general_pck" if id in ["ceres", "pluto", "vesta"] else "观测估计尺寸，用于形状示意；保留原资产尺寸供核对"
        manifest["bodies"][id] = entry


def import_ceres():
    # Use the same project's SBDB snapshot when its legacy Ceres kernel does not cover this epoch.
    catalog = json.loads((WEB / "public/catalogs/main_belt_asteroid.json").read_text())
    row = next(row for row in catalog if row["name"].startswith("1 Ceres"))
    orbit = {k: v for k, v in row.items() if k != "name"}
    manifest["bodies"]["ceres"].update({"orbit": orbit, "orbitSource": "OpenSpace SBDB elements", "rotationDays": 9.074 / 24})


def import_texture(id):
    entry = manifest["bodies"][id]
    folder = ROOT / Path(entry["asset"]).parent
    candidates = sorted(folder.glob("layers/colorlayers/*.asset"))
    preferred = {"titan": "cassini_iss_global_mosaic_4km_local.asset", "ceres": "lamo_local.asset", "pluto": "mosaic.asset", "charon": "mosaic.asset"}
    if id in preferred: candidates = [folder / "layers/colorlayers" / preferred[id]]
    for layer in candidates:
        source = text_asset(str(layer.relative_to(ROOT)))
        match = re.search(r'FilePath\s*=\s*\w+\s*\.\.\s*"([^\"]+\.(?:jpg|png|tif))"', source)
        if not match or "HttpSynchronization" not in source: continue
        identifier = re.search(r'Identifier\s*=\s*"([^\"]+)"', source)[1]
        version = int(re.search(r"Version\s*=\s*(\d+)", source)[1])
        path, provenance = resource_file(identifier, version, match[1])
        with Image.open(path) as im:
            im = im.convert("RGB")
            im.thumbnail((2048, 1024), Image.Resampling.LANCZOS)
            output = WEB / "public/textures" / f"{id}.jpg"
            im.save(output, quality=88, optimize=True)
        entry.update({"texture": f"{id}.jpg", "surface": "OpenSpace 引用的观测影像拼接图；覆盖与色彩以原图为准"})
        if id == "titan": entry["surface"] = "卡西尼 ISS 地表拼接图，透过云雾的观测表示"
        manifest["resources"].append({**provenance, "asset": str(layer.relative_to(ROOT)), "output": f"textures/{id}.jpg", "outputSha256": digest(output)})
        return
    model = folder / "model.asset"
    if model.exists():
        source = text_asset(str(model.relative_to(ROOT)))
        m = re.search(r'GeometryFile\s*=\s*\w+\s*\.\.\s*"([^\"]+\.glb)"', source)
        if not m: return
        identifier = re.search(r'Identifier\s*=\s*"([^\"]+)"', source)[1]
        version = int(re.search(r"Version\s*=\s*(\d+)", source)[1])
        path, provenance = resource_file(identifier, version, m[1])
        blob = path.read_bytes()
        output = WEB / "public/models" / f"{id}.glb"
        output.parent.mkdir(exist_ok=True)
        output.write_bytes(blob)
        entry["model"] = f"models/{id}.glb"
        entry["surface"] = "OpenSpace 引用的三维模型；遥远天体表面为艺术示意"
        manifest["resources"].append({**provenance, "asset": str(model.relative_to(ROOT)), "output": entry["model"], "outputSha256": digest(output)})


if __name__ == "__main__":
    import_distant()
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(import_satellites, KERNELS))
    import_ceres()
    # Persist metadata before large texture downloads, enabling independent validation.
    output = WEB / "src/extended-data.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(import_texture, manifest["bodies"]))
    manifest["bodies"] = dict(sorted(manifest["bodies"].items()))
    manifest["resources"].sort(key=lambda r: r["url"])
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"Imported {len(manifest['bodies'])} additional bodies", flush=True)
