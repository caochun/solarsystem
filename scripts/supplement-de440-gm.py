"""Import explicitly published KBO GM values from the local NAIF DE440 PCK.

The source file is already part of the OpenSpace import cache. Values are copied
verbatim; no radius, density, or uncertainty is inferred from them.
"""
import hashlib, json, re
from pathlib import Path

WEB=Path(__file__).resolve().parents[1]
SOURCE=WEB/'data-cache/reference/gm_de440.tpc'
URL='https://ssd.jpl.nasa.gov/ftp/xfr/gm_Horizons.pck'
OBJECTS={'haumea':920136108,'eris':920136199,'quaoar':920050000,'orcus':920090482}
G=6.67430e-20

def main():
    text=SOURCE.read_text()
    digest=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    values={}
    for name,naif in OBJECTS.items():
        match=re.search(rf'BODY{naif}_GM\s*=\s*\(\s*([0-9.Ee+-]+)',text)
        if not match: raise RuntimeError(f'missing BODY{naif}_GM')
        gm=float(match.group(1))
        values[name]={'naif':naif,'gm':gm,'massKg':gm/G,'massUpperLimit':False,
            'gmReference':'DE440 / gm_Horizons.pck; KBO system primary',
            'source':{'url':URL,'localSource':'data-cache/reference/gm_de440.tpc','sha256':digest,'retrieved':'2026-09-14'},
            'parameter':'GM (km³/s²), mass converted using G = 6.67430e-20 km³ kg⁻¹ s⁻²'}
    out={'source':{'url':URL,'localPath':'data-cache/reference/gm_de440.tpc','sha256':digest,
        'description':'NAIF/JPL Horizons mass-parameter PCK; values preserved verbatim'},'objects':values}
    (WEB/'src/de440-gm-sources.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    physical=json.loads((WEB/'src/supplemental-data.json').read_text())
    for name,data in values.items():
        previous=physical['physical'].get(name,{})
        physical['physical'][name]={**previous,'source':data['source'],'gm':data['gm'],'gmSigma':None,
            'gmReference':data['gmReference'],'massKg':data['massKg'],'massUpperLimit':False,
            'massReference':data['gmReference'],'parameterSources':{**previous.get('parameterSources',{}),'GM':data['source']},
            'originalParameters':{**previous.get('originalParameters',{}),'GM':{'name':'GM','value':str(data['gm']),'units':'km^3/s^2','ref':data['gmReference']}}}
    (WEB/'src/supplemental-data.json').write_text(json.dumps(physical,ensure_ascii=False,indent=2)+'\n')
    updates=json.loads((WEB/'src/small-body-updates.json').read_text())
    for name,data in values.items():
        p=updates['bodies'][name]['physical']; p['GM']= {'name':'GM','value':str(data['gm']),'units':'km^3/s^2','ref':data['gmReference']}
        p.pop('missingPhysical',None) if False else None
        updates['bodies'][name]['missingPhysical']=[x for x in ['GM','diameter','density'] if x not in p]
        updates['bodies'][name]['physicalSourceSupplement']=data['source']
    (WEB/'src/small-body-updates.json').write_text(json.dumps(updates,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(values,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
