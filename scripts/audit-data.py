"""Audit imported Solar System data and local visual resources."""
from collections import Counter
from datetime import datetime, timezone
import hashlib, json, math
from pathlib import Path

WEB=Path(__file__).resolve().parents[1]
SRC, PUBLIC = WEB/'src', WEB/'public'
def read(name): return json.loads((SRC/f'{name}.json').read_text())
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def finite(value): return isinstance(value,(int,float)) and math.isfinite(value)
def audit_resource(resource, errors, warnings, default_dir=''):
    output=resource.get('output')
    if not output: return {'identifier':resource.get('identifier'),'status':'metadata-only'}
    relative = f'{default_dir}/{output}' if default_dir and '/' not in output else output
    path=PUBLIC/relative
    item={'identifier':resource.get('identifier'),'output':relative,'manifestOutput':output,'bytes':path.stat().st_size if path.exists() else 0,'expectedSha256':resource.get('outputSha256') or resource.get('sha256Output')}
    if not path.exists(): item['status']='missing'; errors.append(f'missing resource: {output}'); return item
    item['sha256']=digest(path)
    if item['expectedSha256'] and item['sha256']!=item['expectedSha256']: item['status']='hash-mismatch'; errors.append(f'hash mismatch: {output}')
    else: item['status']='ok'
    if item['bytes']==0: item['status']='empty'; errors.append(f'empty resource: {output}')
    if path.suffix.lower() not in {'.jpg','.jpeg','.png','.webp','.glb','.bin','.bsp','.fits'}: warnings.append(f'unusual resource extension: {output}')
    return item
def audit_orbit(orbit,label,errors):
    if not isinstance(orbit,dict): errors.append(f'{label}: orbit is not an object'); return ['orbit-missing']
    issues=[]
    for key in ('a','e','i','node','peri','m','period','epoch'):
        if not finite(orbit.get(key)): issues.append(f'{key}-not-finite')
    if finite(orbit.get('a')) and orbit['a']<=0: issues.append('a-non-positive')
    if finite(orbit.get('e')) and not 0<=orbit['e']<1: issues.append('eccentricity-out-of-range')
    if finite(orbit.get('period')) and orbit['period']<=0: issues.append('period-non-positive')
    if issues: errors.append(f"{label}: {', '.join(issues)}")
    return issues

def main():
    openspace,extended,supplemental=read('openspace-data'),read('extended-data'),read('supplemental-data')
    moons=read('minor-moons'); report=read('minor-moons-report')
    physical=supplemental.get('physical',{}); refs=read('surface-references')['bodies']; errors=[]; warnings=[]; resources=[]; bodies={}
    for manifest in (openspace,extended,supplemental):
        default_dir = 'textures' if manifest is openspace else ''
        for resource in manifest.get('resources',[])+manifest.get('textures',[]): resources.append(audit_resource(resource,errors,warnings,default_dir))
    vesta=supplemental.get('vestaModel')
    if vesta:
        path=PUBLIC/vesta['path']; actual=digest(path) if path.exists() else None
        item={'identifier':'vesta_model','output':vesta['path'],'bytes':path.stat().st_size if path.exists() else 0,'expectedSha256':vesta.get('outputSha256'),'sha256':actual}
        item['status']='ok' if path.exists() and actual==vesta.get('outputSha256') else 'missing-or-hash-mismatch'; resources.append(item)
        if item['status']!='ok': errors.append('vesta model missing or hash mismatch')
    for body in ('sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','moon'):
        bodies[body]={'visual':'procedural' if body in {'sun','earth'} else 'texture','issues':[]}
    texture_outputs={r.get('output') for r in resources if r.get('output','').startswith('textures/')}; model_outputs={r.get('output') for r in resources if r.get('output','').startswith('models/')}
    extra=extended['bodies']
    for body_id,body in extra.items():
        issues=[]; parent=body.get('parent')
        if not parent: issues.append('parent-missing')
        if body.get('texture') and f"textures/{body['texture']}" not in texture_outputs: issues.append('texture-missing')
        if body.get('model') and body['model'] not in model_outputs and not (PUBLIC/body['model']).exists(): issues.append('model-missing')
        visual='texture' if body.get('texture') else ('model' if body.get('model') else 'location-only')
        issues.extend(audit_orbit(body['orbit'],body_id,errors)) if body.get('orbit') else issues.append('orbit-missing')
        radii=body.get('radiiKm')
        if not isinstance(radii,list) or len(radii)!=3 or any(not finite(x) or x<=0 for x in radii): issues.append('radii-invalid')
        if body_id not in physical: warnings.append(f'{body_id}: physical record unavailable')
        bodies[body_id]={'visual':visual,'parent':parent,'issues':sorted(set(issues)),'hasPhysical':body_id in physical,'hasOrbit':bool(body.get('orbit')),'hasReferenceImage':body_id in refs}
    known={'sun','earth','moon','mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto'}|set(extra)
    for body_id,body in extra.items():
        if body.get('parent') not in known: errors.append(f"{body_id}: unknown parent {body.get('parent')}")
    for body_id,body in extra.items():
        seen=set(); parent=body.get('parent')
        while parent in extra:
            if parent in seen: errors.append(f'{body_id}: parent cycle'); break
            seen.add(parent); parent=extra[parent].get('parent')
    moon_issues=0
    for body in moons['bodies']:
        issues=audit_orbit(body.get('orbit'),body['id'],errors); moon_issues+=bool(issues)
        bodies[body['id']]={'visual':'location-only','parent':body.get('parent'),'issues':issues,'hasPhysical':body['id'] in physical,'hasOrbit':bool(body.get('orbit')),'hasReferenceImage':body['id'] in refs}
    moon_ids={b['id'] for b in moons['bodies']}
    report['extractedCount']=len(moon_ids)
    report['extractedByParent']=dict(Counter(b['parent'] for b in moons['bodies']))
    report['unsupportedByParent']={parent:[{**b,'reason':'No imported orbit'} for b in candidates if b['id'] not in moon_ids]
        for parent,candidates in report['assetCandidatesByParent'].items()}
    (SRC/'minor-moons-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    audit={'auditDate':datetime.now(timezone.utc).isoformat(timespec='seconds'),'scope':'Local OpenSpace asset snapshot and imported browser datasets','summary':{'errors':len(errors),'warnings':len(warnings),'resources':len(resources),'bodies':len(bodies),'physicalRecords':len(physical),'referenceImages':len(refs)},'status':'error' if errors else ('warning' if warnings else 'ok'),'errors':errors,'warnings':warnings,'resources':resources,'bodies':bodies,'minorMoonSamples':{'bodies':sum(bool(b.get('spiceSamples')) for b in moons['bodies']),'statePoints':sum(len(b.get('spiceSamples',[])) for b in moons['bodies']),'maxMidpointResidualKm':moons['sampleCoverage']['maxValidatedInterpolationErrorKm'],'orbitIssueBodies':moon_issues},'missingGlobalMapAndIndependentMesh':sorted(k for k,b in extra.items() if not b.get('texture') and not b.get('model') and k!='vesta'),'modelThumbnails':{'objects':[p.stem for p in (PUBLIC/'thumbnails').glob('*.png')],'path':'public/thumbnails/{id}.png'}}
    (SRC/'data-quality-report.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n'); print(json.dumps(audit,ensure_ascii=False,indent=2))
    if errors: raise SystemExit(1)

if __name__=='__main__': main()
