"""Sample major-satellite SPK states for continuous browser interpolation."""
import importlib.util, json, math, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
from data_json import dumps
from spk import RemoteSPK

WEB=Path(__file__).resolve().parents[1]; AU=149597870.7; DAY=86400.0
EPOCH=datetime.fromisoformat('2026-09-10T00:00:00+00:00').timestamp()*1000
ET=(EPOCH/1000 - datetime(2000,1,1,12,tzinfo=timezone.utc).timestamp()) + 69.184
KERNELS={
 'mars':('mar097.bsp',401,402,499), 'jupiter':('jup365.bsp',501,502,503,504,599),
 'saturn':('sat441.bsp',601,602,603,604,605,606,607,608,609,612,613,614,632,634,699),
 'uranus':('ura111.bsp',701,702,703,704,705,799), 'neptune':('nep097.bsp',801,899),
 'pluto':('ssd_jpl_nasa_gov_plu043.bsp',901,902,903,904,905,999)
}
PARENT_NAIF={'mars':499,'jupiter':599,'saturn':699,'uranus':799,'neptune':899,'pluto':999}

def scene_state(state):
    return [float(state[0]/AU),float(state[2]/AU),float(-state[1]/AU)]
def scene_velocity(state):
    return [float(state[3]*DAY/AU),float(state[5]*DAY/AU),float(-state[4]*DAY/AU)]

def main():
    manifest=json.loads((WEB/'src/extended-data.json').read_text())
    urls={x['url'].rsplit('/',1)[-1]:x['url'] for x in manifest['spk']}
    targets=[]
    for parent,(name,*ids) in KERNELS.items():
        for target in ids:
            if target==PARENT_NAIF[parent]: continue
            body=next((b for b in manifest['bodies'].values() if b.get('naif')==target),None)
            if body: targets.append((parent,name,target,body))
    def sample(item):
        parent,name,target,body=item; kernel=RemoteSPK(urls[name]); pnaif=PARENT_NAIF[parent]
        segment=next(s for s in kernel.segments if s[2]==target and s[0]<=ET<=s[1])
        # A 30-day local window provides useful continuous SPK coverage while
        # retaining enough samples for the shortest-period inner moons.
        start=max(segment[0],ET-15*DAY); end=min(segment[1],ET+15*DAY)
        times=np.linspace(start,end,257); states=[]
        for t in times:
            if parent=='pluto': state=kernel.state(target,float(t))[0]
            else: state=kernel.relative(target,pnaif,float(t))
            states.append(state)
        samples=[]; velocities=[]
        for t,state in zip(times,states):
            samples.append([EPOCH+(float(t)-ET)*1000,*scene_state(state)])
            velocities.append(scene_velocity(state))
        body['spiceSamples']=samples; body['spiceVelocities']=velocities
        body['sampleWindow']=[samples[0][0],samples[-1][0]]
        body['sampleValidation']={'source':kernel.url,'method':'SPK state samples with cubic Hermite interpolation','frame':'J2000 ecliptic (X,Z,-Y)','positionUnits':'AU','velocityUnits':'AU/day','sampleCount':len(samples),'windowDays':30}
        return body['english']
    with ThreadPoolExecutor(max_workers=8) as pool:
        for name in pool.map(sample,targets): print('Sampled',name,flush=True)
    (WEB/'src/extended-data.json').write_text(dumps(manifest))
    print('Updated',len(targets),'major satellites')
if __name__=='__main__': main()
