"""Extract OpenSpace's minor giant-planet moon groups into compact orbit metadata.

The source kernels stay remote and are read through verified HTTP ranges.  Only
the epoch records needed for each moon are cached; the browser receives orbital
elements, not the multi-hundred-megabyte SPK files.
"""
import json, math, re
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
    "jupiter": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/jupiter/kernels/3/jup347.bsp"], 599, 126686534.911),
    "saturn": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/saturn/kernels/2/sat441.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/saturn/kernels/3/sat454.bsp"], 699, 37931207.8),
    "uranus": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/uranus/kernels/3/ura184_part-1.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/uranus/kernels/3/ura184_part-2.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/uranus/kernels/3/ura184_part-3.bsp"], 799, 5793951.3),
    "neptune": (["http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/neptune/kernels/2/nep095.bsp", "http://liu-se.cdn.openspaceproject.com/files/solarsystem/planets/neptune/kernels/2/nep101xl-802.bsp"], 899, 6835099.97),
}
FOLDERS = {p: ROOT / "data/assets/scene/solarsystem/planets" / p / "minor" for p in KERNELS}

def elements(state, mu):
    rp, e, inc, node, peri, mean, _, _ = spice.oscelt(state, ET, mu)
    a = rp / (1 - e)
    if not (a > 0 and 0 <= e < 1): raise ValueError("non-elliptic")
    return {"a": a / 149597870.7, "e": float(e), "i": math.degrees(inc), "node": math.degrees(node), "peri": math.degrees(peri), "m": math.degrees(mean), "period": 2 * math.pi * math.sqrt(a ** 3 / mu) / 86400, "epoch": EPOCH_MS}

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
        seen = set()
        for identifier, display, asset in names(FOLDERS[parent]):
            if identifier in seen: continue
            seen.add(identifier)
            try: target = spice.bodn2c(identifier.upper())
            except Exception: continue
            try:
                kernel = next(k for k in kernels if any(s[2] == target and s[0] <= ET <= s[1] for s in k.segments))
                state = kernel.relative(target, parent_naif, ET); orbit = elements(state, mu)
            except Exception as error:
                print(f"skip {parent}/{identifier}: {error}"); continue
            output.append({"id": identifier.lower(), "name": display, "english": identifier.upper(), "parent": parent, "orbit": orbit, "stateKm": [float(x) for x in state], "source": kernel.url})
            print(parent, identifier, flush=True)
    output.sort(key=lambda x: (x["parent"], x["id"]))
    target = ROOT / "src/minor-moons.json"
    target.write_text(json.dumps({"epoch": EPOCH, "count": len(output), "bodies": output}, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {len(output)} minor moons to {target}")

if __name__ == "__main__": main()
