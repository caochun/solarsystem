"""Refresh the ten modeled dwarf/small bodies from cited JPL SBDB snapshots.

Preserve absent/ambiguous physical fields. Updated osculating elements are still
Kepler approximations; raw values, uncertainties, TDB epochs and references remain
in the audit manifest. Pluto continues to use Astronomy Engine at runtime.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib,json,subprocess
from pathlib import Path
import spiceypy as spice

WEB=Path(__file__).resolve().parents[1]
CACHE=WEB/'data-cache/sbdb-20260913'
BODIES={'ceres':1,'vesta':4,'pluto':134340,'eris':136199,'haumea':136108,'makemake':136472,'sedna':90377,'quaoar':50000,'gonggong':225088,'orcus':90482}


def download(url,path):
    if not path.exists():
        temp=path.with_suffix(path.suffix+'.part')
        subprocess.run(['curl','-fsSL','--retry','2','--connect-timeout','15','--max-time','90',url,'-o',str(temp)],check=True)
        temp.replace(path)
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    CACHE.mkdir(parents=True,exist_ok=True)
    lsk_url='https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls'
    # Same NAIF kernel already distributed in OpenSpace's horizonsTest fixtures.
    lsk=WEB/'scripts/reference/naif0012.tls'
    spice.furnsh(str(lsk))
    def fetch(pair):
        identifier,number=pair
        url=f'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr={number}&phys-par=true&full-prec=true'
        path=download(url,CACHE/f'{identifier}.json')
        raw=json.loads(path.read_text())
        assert raw['object']['des']==str(number),(identifier,raw.get('object'))
        assert raw['signature']['source'].startswith('NASA/JPL')
        return identifier,raw,{'url':url,'sha256':digest(path),'retrieved':'2026-09-13'}
    with ThreadPoolExecutor(max_workers=3) as pool:
        records=list(pool.map(fetch,BODIES.items()))
    extended=json.loads((WEB/'src/extended-data.json').read_text())
    supplement=json.loads((WEB/'src/supplemental-data.json').read_text())
    manifest={'source':'NASA/JPL SBDB','retrieved':'2026-09-13','timeConversion':{'kernel':lsk_url,'sha256':digest(lsk),'method':'CSPICE JDTDB to UTC using NAIF leap seconds'},'bodies':{}}
    for identifier,raw,source in records:
        orbit=raw['orbit']
        elements={e['name']:e for e in orbit['elements']}
        physical={p['name']:p for p in raw.get('phys_par',[])}
        et=spice.unitim(float(orbit['epoch']),'JDTDB','ET')
        utc=spice.et2utc(et,'ISOC',3)+'Z'
        timestamp=datetime.fromisoformat(utc.replace('Z','+00:00')).timestamp()*1000
        converted={field:float(elements[key]['value']) for field,key in [('a','a'),('e','e'),('i','i'),('node','om'),('peri','w'),('m','ma'),('period','per')]}
        assert converted['a']>0 and 0<=converted['e']<1
        converted['epoch']=timestamp
        entry=extended['bodies'][identifier]
        if identifier!='pluto':
            entry['orbit']=converted
            entry['orbitSource']='JPL SBDB osculating elements / Kepler approximation'
            entry['orbitProvenance']=source
        num=lambda name:float(physical[name]['value']) if name in physical and physical[name].get('value') is not None else None
        gm,diameter,density=num('GM'),num('diameter'),num('density')
        if any(x is not None for x in [gm,diameter,density]):
            # Do not assign uncertain light-curve rotation periods as a texture spin.
            previous=supplement['physical'].get(identifier,{})
            sigma=lambda name:float(physical[name]['sigma']) if name in physical and physical[name].get('sigma') else None
            record={**previous,'source':source,'gm':gm,'gmSigma':sigma('GM'),'gmReference':physical.get('GM',{}).get('ref',''),
                'massKg':gm/6.67430e-20 if gm is not None else None,'massUpperLimit':False,
                'meanRadiusKm':diameter/2 if diameter is not None else None,'meanRadiusSigmaKm':sigma('diameter')/2 if sigma('diameter') is not None else None,
                'radiusReference':physical.get('diameter',{}).get('ref',''),'densityGcm3':density,'densitySigma':sigma('density'),'originalParameters':physical}
            groups={'GM':['gm','gmSigma','gmReference','massKg','massUpperLimit'],
                    'diameter':['meanRadiusKm','meanRadiusSigmaKm','radiusReference'],
                    'density':['densityGcm3','densitySigma']}
            for parameter,fields in groups.items():
                if parameter not in physical:
                    for field in fields:
                        if field in previous: record[field]=previous[field]
            record['originalParameters']={**previous.get('originalParameters',{}),**physical}
            record['parameterSources']={parameter:source if parameter in physical else previous.get('parameterSources',{}).get(parameter,previous.get('source')) for parameter in groups}
            supplement['physical'][identifier]=record
        manifest['bodies'][identifier]={'source':source,'object':raw['object'],'orbit':orbit,'epochUTC':utc,'physical':physical,
            'missingPhysical':[key for key in ['GM','diameter','density'] if key not in physical],
            'runtimePosition':'Astronomy Engine' if identifier=='pluto' else 'fixed osculating elements / Kepler'}
        print(identifier,utc,'physical',list(physical),flush=True)
    for name,data in [('extended-data',extended),('supplemental-data',supplement),('small-body-updates',manifest)]:
        (WEB/f'src/{name}.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__': main()
