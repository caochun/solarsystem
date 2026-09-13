"""Recover OpenSpace's separate Daphnis type-17 kernel and verify with CSPICE."""
import importlib.util, json
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
import spiceypy as spice
from resources import WEB,resource_file
from data_json import dumps

def main():
    spec=importlib.util.spec_from_file_location('minor_import',Path(__file__).with_name('import-minor-moons.py'))
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    path,source=resource_file('saturn_shepherd_kernels',1,'sat393_daphnis.bsp')
    kernel=mod.RemoteSPK(source['url'])
    spice.furnsh(str(path))
    checks=[]
    for segment in kernel.segments:
        for et in np.linspace(segment[0],segment[1],5):
            actual=kernel.relative(635,699,float(et))
            expected=spice.spkgeo(635,float(et),'ECLIPJ2000',699)[0]
            error=float(np.linalg.norm(actual[:3]-expected[:3]))
            velocity_error=float(np.linalg.norm(actual[3:]-expected[3:]))
            assert error<1e-6 and velocity_error<1e-9,(error,velocity_error)
            checks.append({'et':float(et),'positionDifferenceKm':error,'velocityDifferenceKmS':velocity_error})
    state=kernel.relative(635,699,mod.ET)
    orbit=mod.elements(state,mod.KERNELS['saturn'][2],mod.ET,mod.EPOCH_MS)
    body={'id':'daphnis','name':'Daphnis','english':'DAPHNIS','parent':'saturn','orbit':orbit,
        'stateKm':[float(x) for x in state],'source':source['url'],'sourceEpoch':mod.EPOCH,
        'sourceAsset':'data/assets/scene/solarsystem/planets/saturn/minor/shepherd_group/transforms.asset'}
    target=WEB/'src/minor-moons.json'
    payload=json.loads(target.read_text())
    previous=next((b for b in payload['bodies'] if b['id']=='daphnis'),{})
    payload['bodies']=[b for b in payload['bodies'] if b['id']!='daphnis']+[{**previous,**body}]
    payload['bodies'].sort(key=lambda b:(b['parent'],b['id']))
    payload['count']=len(payload['bodies'])
    target.write_text(dumps(payload))
    audit={'source':source,'kernelType':17,'checks':checks,'body':body}
    (WEB/'src/daphnis-source.json').write_text(dumps(audit))
    print('Daphnis imported:',orbit,'CSPICE checks:',len(checks),flush=True)

if __name__=='__main__': main()
