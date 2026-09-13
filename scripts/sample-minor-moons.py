"""Sample every imported minor moon with validated local SPICE state windows.

States use AU and AU/day in the browser's (ecliptic X, Z, -Y) frame.
Cubic Hermite interpolation uses positions and velocities. The reported error is
against the source kernel at interval midpoints, not against real observations.
"""
import importlib.util
import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import sys

import numpy as np
import spiceypy as spice
from data_json import dumps

WEB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location("minor_import", Path(__file__).with_name("import-minor-moons.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
AU = 149597870.7
DAY = 86400.0


def main():
    path = WEB / "src/minor-moons.json"
    payload = json.loads(path.read_text())
    kernels = {parent: [mod.RemoteSPK(url) for url in urls] for parent, (urls, _, _) in mod.KERNELS.items()}
    targets = {}
    for body in payload['bodies']:
        try:
            targets[body['id']] = spice.bodn2c(body['english'].upper())
        except Exception:
            aliases = {k.lower(): v for k,v in mod.kernel_ids(body['parent']).items()}
            candidate = aliases.get(body['id'])
            targets[body['id']] = int(candidate) if str(candidate).isdigit() else spice.bodn2c(candidate) if candidate else None
    failures = {}

    def sample_one(body):
        # Future non-SPK supplements retain their separately cited sample source.
        if 'horizons' in body['source']:
            return body
        parent = body['parent']
        target = targets[body['id']]
        epoch_et = mod.ET + (body['orbit']['epoch'] - mod.EPOCH_MS) / 1000
        candidates = [(k,s) for k in kernels[parent] for s in k.segments
                      if s[2] == target and s[5] in (2,3,17) and s[4] in (1,17) and s[0] <= epoch_et <= s[1]]
        if not candidates:
            raise ValueError('No supported SPK segment at the recorded source epoch')
        kernel,segment = next(((k,s) for k,s in candidates if k.url == body['source']), candidates[-1])
        period = body['orbit']['period']
        # Short-period moons need dense samples; do not span many orbits with a handful of points.
        span = min(7.0, period / 8) * DAY
        start,end = max(epoch_et-span, segment[0]), min(epoch_et+span, segment[1])
        if end <= start:
            raise ValueError('Empty source window')
        count = 64
        state = lambda t: kernel.relative(target, mod.KERNELS[parent][1], float(t))
        while True:
            times = np.linspace(start, end, count+1)
            states = [state(t) for t in times]
            errors = []
            for i in range(count):
                dt = times[i+1]-times[i]
                # Cubic Hermite evaluated at u=0.5.
                estimate = .5*(states[i][:3]+states[i+1][:3]) + dt/8*(states[i][3:]-states[i+1][3:])
                errors.append(float(np.linalg.norm(estimate-state((times[i]+times[i+1])/2)[:3])))
            if max(errors) <= 1.0:
                break
            count *= 2
            if count > 512:
                raise ValueError(f'Interpolation residual exceeds 1 km: {max(errors)}')
        samples,velocities = [],[]
        for et,vector in zip(times,states):
            t = mod.EPOCH_MS + (float(et)-mod.ET)*1000
            samples.append([t,float(vector[0]/AU),float(vector[2]/AU),float(-vector[1]/AU)])
            velocities.append([float(vector[3]*DAY/AU),float(vector[5]*DAY/AU),float(-vector[4]*DAY/AU)])
        return {**body,'spiceSamples':samples,'spiceVelocities':velocities,
                'sampleWindow':[samples[0][0],samples[-1][0]],
                'sampleValidation':{'source':kernel.url,'method':'cubic Hermite; every interval midpoint checked against source SPK',
                    'frame':'J2000 ecliptic (X, Z, -Y)','positionUnits':'AU','velocityUnits':'AU/day',
                    'maxInterpolationErrorKm':max(errors),'checks':len(errors)}}

    by_id = {body['id']:body for body in payload['bodies']}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(sample_one,body):body['id'] for body in payload['bodies']}
        for count,future in enumerate(as_completed(futures),1):
            identifier = futures[future]
            try:
                by_id[identifier] = future.result()
            except Exception as error:
                failures[identifier] = str(error)
                print('Failed',identifier,str(error),flush=True)
            if count % 10 == 0:
                print(f'{count}/{len(futures)} sampled',flush=True)
            # Checkpoint separately so an interrupted fetch never partially replaces runtime data.
            if count % 25 == 0:
                checkpoint = WEB/'data-cache/moon-samples-checkpoint.json'
                checkpoint.write_text(json.dumps(list(by_id.values())))
    payload['bodies'] = [by_id[body['id']] for body in payload['bodies']]
    payload['sampleMethod'] = 'Cubic Hermite in recorded local windows; Kepler fallback outside; AU, AU/day, J2000 ecliptic (X,Z,-Y)'
    payload['sampleCoverage'] = {'sampled':sum(len(b.get('spiceSamples',[]))>=2 for b in payload['bodies']), 'failed':failures,
        'maxValidatedInterpolationErrorKm':max((b.get('sampleValidation',{}).get('maxInterpolationErrorKm',0) for b in payload['bodies']),default=0)}
    if failures:
        (WEB/'data-cache/moon-samples-failures.json').write_text(json.dumps(failures,indent=2))
        raise RuntimeError(f'{len(failures)} bodies failed; runtime dataset preserved, inspect checkpoint')
    path.write_text(dumps(payload))
    print(json.dumps(payload['sampleCoverage']),flush=True)

if __name__=='__main__':
    main()
