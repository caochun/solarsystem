"""Import cited satellite physical data and PDS ring dimensions; convert Vesta OBJ."""
import hashlib
import json
from pathlib import Path
import subprocess
from bs4 import BeautifulSoup
import trimesh
from resources import WEB, resource_file, digest

CACHE = WEB / "data-cache/reference"
CACHE.mkdir(exist_ok=True,parents=True)
SATELLITES = "https://ssd.jpl.nasa.gov/sats/phys_par/"
G = 6.67430e-20  # CODATA 2018, km^3 kg^-1 s^-2; relative standard uncertainty 2.2e-5.

def source(name,url):
    path = CACHE / name
    if not path.exists():
        subprocess.run(['curl','-fLsS','--retry','2','--connect-timeout','15','--max-time','90',url,'-o',str(path)],check=True)
    return BeautifulSoup(path.read_text(),'html.parser'), {"url":url,"sha256":digest(path),"retrieved":"2026-09-11"}

def numeric(value):
    try: return float(value.replace(',','').lstrip('<~'))
    except ValueError: return None

def main():
    satellites, origin = source('satellite-physical.html',SATELLITES)
    known = json.loads((WEB/'src/extended-data.json').read_text())['bodies']
    known['moon'] = {}
    result = {"physical":{},"rings":{},"resources":[origin],"massConversion":{"G":G,"relativeSigmaG":2.2e-5,"source":"https://physics.nist.gov/cgi-bin/cuu/Value?bg"}}
    refs = [li.get_text(' ',strip=True) for li in satellites.select('ol.sat-ephem-ref li')]
    for row in satellites.select('tr'):
        cells=[' '.join(t.strip() for t in td.find_all(string=True,recursive=False) if t.strip()) or td.get_text(' ',strip=True) for td in row.select('td')]
        if len(cells)!=12 or cells[1].lower() not in known: continue
        id=cells[1].lower()
        gm,mean,density=map(numeric,[cells[3],cells[6],cells[9]])
        ref=int(cells[8]) if cells[8].isdigit() else None
        result['physical'][id]={"source":origin,"gm":gm,"gmSigma":numeric(cells[4]),"gmReference":cells[5],
          "massKg":gm/G if gm else None,"massUpperLimit":cells[3].startswith('<'),
          "meanRadiusKm":mean,"meanRadiusSigmaKm":numeric(cells[7]),
          "radiusReference":refs[ref-1] if ref else cells[8],
          "densityGcm3":density,"densitySigma":numeric(cells[10])}
    for id,number in [('ceres',1),('vesta',4)]:
        url=f'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr={number}&phys-par=true'
        path=CACHE/f'sbdb-{id}.json'
        if not path.exists():
            subprocess.run(['curl','-fLsS','--retry','2','--connect-timeout','15','--max-time','90',url,'-o',str(path)],check=True)
        raw=json.loads(path.read_text())
        parameters={p['name']:p for p in raw['phys_par']}
        gm,diameter,density=[parameters[key] for key in ['GM','diameter','density']]
        source_info={"url":url,"sha256":digest(path),"retrieved":"2026-09-11"}
        result['resources'].append(source_info)
        result['physical'][id]={"source":source_info,"gm":float(gm['value']),"gmSigma":numeric(gm.get('sigma') or ''),
          "gmReference":gm.get('ref','JPL SBDB'),"massKg":float(gm['value'])/G,"massUpperLimit":False,
          "meanRadiusKm":float(diameter['value'])/2,"meanRadiusSigmaKm":float(diameter['sigma'])/2 if numeric(diameter.get('sigma') or '') is not None else None,
          "radiusReference":diameter.get('ref','JPL SBDB'),"densityGcm3":float(density['value']),"densitySigma":numeric(density.get('sigma') or ''),
          "originalParameters":parameters}
    for planet in ['jupiter','uranus','neptune']:
        url=f'https://pds-rings.seti.org/{planet}/{planet}_rings_table.html'
        document, origin=source(planet+'-ring-table.html',url)
        result['resources'].append(origin)
        rings=[]
        chosen={'Zeta','Six','Five','Four','Alpha','Beta','Eta','Gamma','Delta','Lambda','Epsilon','Nu','Mu'} if planet=='uranus' else {'Galle','Le Verrier','Lassell','Arago','Adams'} if planet=='neptune' else None
        for row in document.select('table tr'):
            cells=[td.get_text(' ',strip=True) for td in row.select('td')]
            if len(cells)<4 or chosen is not None and cells[0] not in chosen:continue
            name=cells[0]
            if planet=='jupiter':
                inner,outer=numeric(cells[1]),numeric(cells[2]); width=outer-inner
            else:
                center,width=numeric(cells[1]),numeric(cells[2])
                inner=center-(width or 0)/2; outer=center+(width or 0)/2
            rings.append({"name":name,"innerKm":inner,"outerKm":outer,"widthKm":width,
              "widthUpperLimit":cells[2].startswith('<') if planet!='jupiter' else False,
              "opacityIllustrated": .3 if name in ['Main Ring','Epsilon','Adams'] else .12 if width and width>500 else .22,
              "color":"#a9aaa0" if planet=='jupiter' else "#8b999b" if planet=='uranus' else "#8999b4"})
        result['rings'][planet]={"source":origin,"bands":rings,"note":"NASA PDS 环尺寸；圆形共面示意，亮度增强，展示比例下细环加宽；未模拟偏心、环弧与颗粒散射"}
    model, provenance=resource_file('vesta_model',1,'VestaComet_5000.obj')
    resource_file('vesta_model',1,'VestaComet.mtl')
    scene=trimesh.load(model,force='scene',process=False)
    mesh=scene.to_geometry()
    mesh.merge_vertices(merge_tex=True, merge_norm=True, digits_vertex=5)
    source_faces=len(mesh.faces)
    center=mesh.bounds.mean(axis=0)
    span=mesh.extents.max()
    mesh.vertices=(mesh.vertices-center)/span
    if source_faces>80000:
        mesh=mesh.simplify_quadric_decimation(face_count=80000,aggression=10)
    mesh.vertices=mesh.vertices*span+center
    mesh.remove_unreferenced_vertices()
    assert len(mesh.faces)<=100000, "Vesta mesh exceeds browser face budget"
    output=WEB/'public/models/vesta.glb'
    output.write_bytes(mesh.export(file_type='glb'))
    result['vestaModel']={"path":"models/vesta.glb","source":provenance,"outputSha256":digest(output),"sourceFaces":source_faces,"outputFaces":len(mesh.faces),"note":"OpenSpace 引用的灶神星 OBJ 转换并简化网格；无表面影像，纯色着色"}
    (WEB/'src/supplemental-data.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Physical records:',len(result['physical']),'Ring systems:',len(result['rings']),'Vesta GLB bytes:',output.stat().st_size,flush=True)

if __name__=='__main__':main()
