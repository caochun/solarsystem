"""OpenSpace resource downloads with a persistent cache and verified HTTP ranges."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
CACHE = WEB / "data-cache/openspace"
CACHE.mkdir(parents=True, exist_ok=True)
REPOSITORY = "https://liu-se.bigbang.openspaceproject.com/request"


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def text_asset(path):
    return re.sub(r"--[^\n]*", "", (ROOT / path).read_text())


def ranged(url, start, end, destination):
    if destination.exists() and destination.stat().st_size == end - start + 1:
        return destination.read_bytes()
    header = destination.with_suffix(destination.suffix + ".headers")
    subprocess.run(["curl", "-fsSL", "--retry", "2", "--connect-timeout", "15", "--max-time", "180", "-r", f"{start}-{end}", "-D", str(header), url, "-o", str(destination)], check=True)
    response = header.read_text().lower()
    if f"content-range: bytes {start}-{end}/" not in response or destination.stat().st_size != end - start + 1:
        raise ValueError(f"Invalid HTTP range response for {url}")
    return destination.read_bytes()


def fetch(url, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path
    print(f"Download {path.name}", flush=True)
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
        size = int(response.headers.get("Content-Length", "0"))
        ranges = response.headers.get("Accept-Ranges") == "bytes"
    temporary = path.with_suffix(path.suffix + ".part")
    if ranges and size > 8 * 1024 * 1024:
        chunks = [(a, min(a + 4 * 1024 * 1024, size) - 1, path.with_suffix(path.suffix + f".range-{i}")) for i, a in enumerate(range(0, size, 4 * 1024 * 1024))]
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda c: ranged(url, *c), chunks))
        with temporary.open("wb") as out:
            for _, _, part in chunks:
                out.write(part.read_bytes())
        for _, _, part in chunks:
            part.unlink()
            part.with_suffix(part.suffix + ".headers").unlink(missing_ok=True)
    else:
        subprocess.run(["curl", "-fsSL", "--retry", "2", "--connect-timeout", "15", "--max-time", "180", url, "-o", str(temporary)], check=True)
    if size and temporary.stat().st_size != size:
        raise ValueError(f"Size mismatch: {path}")
    temporary.replace(path)
    return path


def resource(identifier, version):
    query = urllib.parse.urlencode({"identifier": identifier, "file_version": version, "application_version": 1})
    listing = fetch(f"{REPOSITORY}?{query}", CACHE / "lists" / f"{identifier}-{version}.txt")
    return {Path(urllib.parse.urlparse(u).path).name: u.replace("http://", "https://", 1) for u in listing.read_text().split() if u.startswith("http")}


def resource_file(identifier, version, filename):
    url = resource(identifier, version)[filename]
    file = fetch(url, CACHE / identifier / filename)
    return file, {"identifier": identifier, "version": version, "url": url, "sha256": digest(file), "bytes": file.stat().st_size}
