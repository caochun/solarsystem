"""Download all sixteen OpenSpace SBDB categories; archive full CSVs and build preview samples."""
from concurrent.futures import ThreadPoolExecutor
import csv
import gzip
import hashlib
import heapq
import json
import math
import re
import shutil
from datetime import datetime, timezone
from resources import WEB, ROOT, resource_file, text_asset, digest

OUT = WEB / "public/catalogs"
OUT.mkdir(parents=True, exist_ok=True)
LABELS = {
    "amor_asteroid": "阿莫尔型近地小行星", "apollo_asteroid": "阿波罗型近地小行星",
    "aten_asteroid": "阿登型近地小行星", "atira_asteroid": "阿提拉型近地小行星",
    "centaur_asteroid": "半人马小天体", "chiron-type_comet": "喀戎型彗星",
    "encke-type_comet": "恩克型彗星", "halley-type_comet": "哈雷型彗星",
    "inner_main_belt_asteroid": "内主带小行星", "main_belt_asteroid": "主带小行星",
    "outer_main_belt_asteroid": "外主带小行星", "jupiter-family_comet": "木星族彗星",
    "jupiter_trojan_asteroid": "木星特洛伊小行星", "mars-crossing_asteroid": "穿越火星轨道的小行星",
    "pha": "潜在危险小行星", "transneptunian_object_asteroid": "海王星外小天体",
}


def elements(row):
    epoch = row["epoch_cal"].strip()
    day, _, fraction = epoch.partition(".")
    ms = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000
    if fraction:
        ms += float("0." + fraction) * 86400000
    values = [float(row[k]) for k in ["a", "e", "i", "om", "w", "ma", "per"]]
    if not all(math.isfinite(v) for v in values) or not (values[0] > 0 and 0 <= values[1] < 1 and values[-1] > 0):
        raise ValueError("Non-elliptic or incomplete orbit")
    return {"a": values[0], "e": values[1], "i": values[2], "node": values[3], "peri": values[4], "m": values[5], "period": values[6], "epoch": round(ms)}


def download(category):
    asset = f"data/assets/scene/solarsystem/sssb/{category}.asset"
    source = text_asset(asset)
    identifier = re.search(r'Identifier\s*=\s*"([^"]+)"', source)[1]
    version = int(re.search(r"Version\s*=\s*(\d+)", source)[1])
    filename = re.search(r'Path\s*=\s*sssb\s*\.\.\s*"([^"]+)"', source)[1]
    path, provenance = resource_file(identifier, version, filename)
    sample = []
    total = skipped = valid = 0
    special = {}
    with path.open(newline="") as stream:
        for row in csv.DictReader(stream):
            total += 1
            try:
                orbit = elements(row)
            except (ValueError, KeyError):
                skipped += 1
                continue
            valid += 1
            name = row["full_name"].strip()
            entry = {"name": name, **orbit}
            if re.match(r"^(1 Ceres|2 Pallas|3 Juno|4 Vesta|1P/Halley|2P/Encke|67P/)", name):
                special[name] = entry
            rank = int(hashlib.sha256(name.encode()).hexdigest()[:12], 16)
            item = (-rank, valid, entry)
            if len(sample) < 3000:
                heapq.heappush(sample, item)
            elif item > sample[0]:
                heapq.heapreplace(sample, item)
    rows = {v[2]["name"]: v[2] for v in sample}
    rows.update(special)
    records = sorted(rows.values(), key=lambda row: row["name"])
    (OUT / f"{category}.json").write_text(json.dumps(records, separators=(",", ":")) + "\n")
    archive = OUT / f"{category}.csv.gz"
    with path.open("rb") as inp, archive.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as out:
            shutil.copyfileobj(inp, out)
    result = {"id": category, "name": LABELS[category], "total": total, "validElliptic": valid,
              "skipped": skipped, "displayed": len(records), "asset": asset,
              "sample": f"catalogs/{category}.json", "archive": f"catalogs/{category}.csv.gz",
              "archiveBytes": archive.stat().st_size, "archiveSha256": digest(archive), **provenance}
    print(f"Catalog {category}: {total} source rows, {len(records)} preview orbits, {skipped} unsupported", flush=True)
    # Persist each completed category; a failed download can resume from the cache.
    (OUT / f"{category}.meta.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


if __name__ == "__main__":
    assets = json.loads((ROOT / "data/profiles/addons/asteroids.addon").read_text())["assets"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        summary = list(pool.map(download, [a.rsplit("/", 1)[1] for a in assets]))
    (OUT / "summary.json").write_text(json.dumps({"source": "OpenSpace / JPL SBDB", "categoriesMayOverlap": True, "categories": summary}, ensure_ascii=False, indent=2) + "\n")
