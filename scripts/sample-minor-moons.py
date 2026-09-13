"""Create compact multi-point SPICE position samples for imported minor moons.

Samples are intentionally limited to a local window around the source epoch.
The browser interpolates inside that window and keeps the existing Kepler model
outside it, so no unsupported long-range precision is implied.
"""
import json, math, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import spiceypy as spice

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
sys.path.insert(0, str(Path(__file__).parent))
from importlib.machinery import SourceFileLoader
mod = SourceFileLoader("minor_import", str(Path(__file__).with_name("import-minor-moons.py"))).load_module()

DAY = 86400.0

def main():
    payload = json.loads((WEB / "src/minor-moons.json").read_text())
    kernels = {parent: [mod.RemoteSPK(url) for url in urls] for parent, (urls, _, _) in mod.KERNELS.items()}
    aliases = {parent: mod.kernel_ids(parent) for parent in mod.KERNELS}
    def sample_one(body):
        parent = body["parent"]
        try:
            target = spice.bodn2c(body["english"].upper())
        except Exception:
            target = aliases[parent].get(body["id"])
        if target is None:
            return None
        candidates = [(k, s) for k in kernels[parent] for s in k.segments
                      if s[2] == target and s[5] in (2, 3) and s[4] in (1, 17)]
        if not candidates:
            return None
        kernel, segment = max(candidates, key=lambda item: item[1][1])
        period = float(body["orbit"]["period"])
        span_days = min(365.0, max(1.0, 4.0 * period))
        start = max(mod.ET - span_days * DAY, segment[0])
        end = min(mod.ET + span_days * DAY, segment[1])
        if end <= start:
            return None
        count = max(9, min(32, math.ceil((end - start) / max(period * DAY / 8.0, 7 * DAY))))
        samples = []
        for i in range(count + 1):
            et = start + (end - start) * i / count
            state = kernel.relative(target, mod.KERNELS[parent][1], et)
            samples.append([mod.EPOCH_MS + (et - mod.ET) * 1000, *[float(x) for x in state[:3]]])
        body = dict(body)
        body["spiceSamples"] = samples
        body["sampleWindow"] = [samples[0][0], samples[-1][0]]
        return body
    completed = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(sample_one, body) for body in payload["bodies"]]
        for future, original in zip(futures, payload["bodies"]):
            try:
                result = future.result()
                if result:
                    original.clear(); original.update(result)
            except Exception as error:
                print(f"skip {original['id']}: {error}", flush=True)
            completed += 1
            if completed % 10 == 0: print(f"{completed}/{len(payload['bodies'])}", flush=True)
    payload["sampleMethod"] = "SPICE relative positions; local window with linear browser interpolation"
    (WEB / "src/minor-moons.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

if __name__ == "__main__": main()
