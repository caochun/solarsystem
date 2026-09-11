"""Read epoch states from OpenSpace SPK type 2/3 segments using verified ranges.

Caches only requested records, not an entire multi-gigabyte kernel. The exported
state is exact to SPK polynomial evaluation; Kepler propagation of it is approximate.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import struct
import numpy as np
from resources import CACHE, ranged


class RemoteSPK:
    def __init__(self, url):
        self.url = url
        self.cache = CACHE / "spk-records" / hashlib.sha256(url.encode()).hexdigest()[:16]
        self.cache.mkdir(parents=True, exist_ok=True)
        head = self.read(0, 1024)
        if not head.startswith(b"DAF/SPK"):
            raise ValueError("Not an SPK kernel")
        self.order = "<" if head[88:96] == b"LTL-IEEE" else ">"
        if struct.unpack_from(self.order + "ii", head, 8) != (2, 6):
            raise ValueError("Unsupported DAF layout")
        record = struct.unpack_from(self.order + "i", head, 76)[0]
        self.segments = []
        while record:
            data = self.read((record - 1) * 1024, 1024)
            following, _, count = struct.unpack_from(self.order + "3d", data)
            for index in range(int(count)):
                self.segments.append(struct.unpack_from(self.order + "dd6i", data, 24 + 40 * index))
            record = int(following)

    def read(self, offset, length):
        return ranged(self.url, offset, offset + length - 1, self.cache / f"{offset}-{length}.bin")

    def state(self, target, et):
        segment = next(s for s in reversed(self.segments) if s[2] == target and s[0] <= et <= s[1])
        start, end, _, center, frame, kind, address, final = segment
        if kind not in (2, 3) or frame not in (1, 17):
            raise ValueError(f"Unsupported segment {kind}, frame {frame}")
        initial, interval, record_size, count = struct.unpack(self.order + "4d", self.read((final - 4) * 8, 32))
        index = min(int((et - initial) // interval), int(count) - 1)
        record_size = int(record_size)
        data = np.frombuffer(self.read((address - 1 + index * record_size) * 8, record_size * 8), dtype=self.order + "f8")
        midpoint, scale = data[:2]
        components = 3 if kind == 2 else 6
        coefficients = data[2:].reshape(components, -1)
        x = (et - midpoint) / scale
        state = [float(np.polynomial.chebyshev.chebval(x, c)) for c in coefficients]
        if kind == 2:
            state += [float(np.polynomial.chebyshev.chebval(x, np.polynomial.chebyshev.chebder(c)) / scale) for c in coefficients]
        if frame == 1:
            angle = np.deg2rad(23.43929111111111)
            rotation = np.array([[1, 0, 0], [0, np.cos(angle), np.sin(angle)], [0, -np.sin(angle), np.cos(angle)]])
            state = [*(rotation @ state[:3]), *(rotation @ state[3:])]
        return np.array(state), center

    def relative(self, target, parent, et):
        state, center = self.state(target, et)
        if center == parent:
            return state
        parent_state, parent_center = self.state(parent, et)
        if parent_center != center:
            raise ValueError(f"Different state origins: {center}, {parent_center}")
        return state - parent_state

    def provenance(self):
        files = sorted(self.cache.glob("*.bin"))
        return {"url": self.url, "downloadMode": "SPK header, descriptors and epoch records via HTTP Range", "downloadedBytes": sum(p.stat().st_size for p in files), "records": [{"range": p.stem, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
