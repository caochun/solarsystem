"""Extract OpenSpace's minor giant-planet moon groups into compact orbit metadata.

The source kernels stay remote and are read through verified HTTP ranges.  Only
the epoch records needed for each moon are cached; the browser receives orbital
elements, not the multi-hundred-megabyte SPK files.
"""
import json, math, re
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from datetime import datetime, timezone
from pathlib import Path
import spiceypy as spice
from resources import ROOT, CACHE, ranged
from spk import RemoteSPK

EPOCH = "2026-09-10T00:00:00Z"
EPOCH_MS = datetime.fromisoformat(EPOCH.replace("Z", "+00:00")).timestamp() * 1000
ET = (EPOCH_MS - datetime(2000, 1, 1, 12, tzinfo=timezone.utc).timestamp() * 1000) / 1000 + 69.184
ET += .001657 * math.sin(math.radians(357.53 + .9856003 * ET / 86400))
KERNELS = {
    "jupiter": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/jupiter/kernels/3/jup347.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/jupiter/kernels/2/jup365.bsp"], 599, 126686534.911),
    "saturn": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/saturn/kernels/2/sat415.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/saturn/kernels/2/sat441.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/saturn/kernels/3/sat454.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/saturn/kernels/3/sat455.bsp"], 699, 37931207.8),
    "uranus": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/uranus/kernels/3/ura184_part-1.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/uranus/kernels/3/ura184_part-2.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/uranus/kernels/3/ura184_part-3.bsp"], 799, 5793951.3),
    "neptune": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/neptune/kernels/2/nep095.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/neptune/kernels/2/nep101xl-802.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/neptune/kernels/3/nep104.bsp"], 899, 6835099.97),
}
FOLDERS = {p: ROOT / "data/assets/scene/solarsystem/planets" / p / "minor" for p in KERNELS}
spice_lock = Lock()
KERNEL_ASSETS = {
    "jupiter": [ROOT / "data/assets/scene/solarsystem/planets/jupiter/kernels.asset", ROOT / "data/assets/scene/solarsystem/planets/jupiter/kernels347.asset"],
    "saturn": [ROOT / "data/assets/scene/solarsystem/planets/saturn/kernels415.asset", ROOT / "data/assets/scene/solarsystem/planets/saturn/kernels454.asset", ROOT / "data/assets/scene/solarsystem/planets/saturn/kernels455.asset"],
    "uranus": [ROOT / "data/assets/scene/solarsystem/planets/uranus/kernels184.asset"],
    "neptune": [ROOT / "data/assets/scene/solarsystem/planets/neptune/kernels095.asset", ROOT / "data/assets/scene/solarsystem/planets/neptune/kernels104.asset"],
}

def kernel_ids(parent):
    result = {}
    for path in KERNEL_ASSETS[parent]:
        text = re.sub(r"--[^\n]*", "", path.read_text())
        match = re.search(r"local ID\s*=\s*\{(.*?)\n\}", text, re.S)
        if not match: continue
        for name, string_value, number_value in re.findall(r"^\s*([A-Za-z0-9]+)\s*=\s*(?:\"([^\"]+)\"|(\d+))", match.group(1), re.M):
            result[name] = string_value or int(number_value)
    return result

def elements(state, mu, epoch_et, epoch_ms):
    rp, e, inc, node, peri, mean, _, _ = spice.oscelt(state, epoch_et, mu)
    a = rp / (1 - e)
    if not (a > 0 and 0 <= e < 1): raise ValueError("non-elliptic")
    return {"a": a / 149597870.7, "e": float(e), "i": math.degrees(inc), "node": math.degrees(node), "peri": math.degrees(peri), "m": math.degrees(mean), "period": 2 * math.pi * math.sqrt(a ** 3 / mu) / 86400, "epoch": epoch_ms}

def names(folder):
    result = []
    for asset in sorted(folder.glob("**/globe.asset")):
        text = re.sub(r"--[^\n]*", "", asset.read_text())
        for identifier, display in re.findall(r'Identifier\s*=\s*"([A-Za-z0-9]+)"[\s\S]{0,360}?Name\s*=\s*"([^"]+)"', text):
            result.append((identifier, display, asset))
    return result

def main():
    output = []
    for parent, (urls, parent_naif, mu) in KERNELS.items():
        kernels = [RemoteSPK(url) for url in urls]
        aliases = kernel_ids(parent)
        unique = {}
        for identifier, display, asset in names(FOLDERS[parent]):
            unique.setdefault(identifier, (display, asset))

        def extract(item):
            identifier, (display, asset) = item
            try:
                with spice_lock: target = spice.bodn2c(identifier.upper())
            except Exception:
                target = aliases.get(identifier)
                if target is None: return None, f"name mapping unavailable ({identifier})"
            try:
                # Many irregular-moon segments end before the common 2026 epoch.
                # Use the latest usable segment and clamp the extraction epoch to
                # its coverage instead of discarding an otherwise valid SPK record.
                candidates = [(k, s) for k in kernels for s in k.segments
                              if s[2] == target and s[5] in (2, 3) and s[4] in (1, 17)]
                if not candidates: raise ValueError("no usable elliptic segment")
                kernel, segment = max(candidates, key=lambda item: item[1][1])
                epoch_et = min(max(ET, segment[0]), segment[1])
                epoch_ms = EPOCH_MS + (epoch_et - ET) * 1000
                state = kernel.relative(target, parent_naif, epoch_et)
                with spice_lock: orbit = elements(state, mu, epoch_et, epoch_ms)
            except Exception as error:
                return None, str(error)
            return ({"id": identifier.lower(), "name": display, "english": identifier.upper(), "parent": parent, "orbit": orbit, "stateKm": [float(x) for x in state], "source": kernel.url, "sourceEpoch": datetime.fromtimestamp(epoch_ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z")}, None)

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(extract, item) for item in unique.items()]
            for future in as_completed(futures):
                result, error = future.result()
                if result:
                    output.append(result); print(parent, result["english"], flush=True)
                elif error:
                    print(f"skip {parent}: {error}", flush=True)
    output.sort(key=lambda x: (x["parent"], x["id"]))
    target = ROOT / "web/src/minor-moons.json"
    target.write_text(json.dumps({"epoch": EPOCH, "count": len(output), "bodies": output}, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(output)} minor moons to {target}")

if __name__ == "__main__": main()
