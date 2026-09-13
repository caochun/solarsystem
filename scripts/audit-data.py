"""Reconcile runtime datasets and original OpenSpace minor-moon candidates."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path

WEB=Path(__file__).resolve().parents[1]
def read(name): return json.loads((WEB/f'src/{name}.json').read_text())
def write(name,data): (WEB/f'src/{name}.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

def main():
    moons=read('minor-moons'); report=read('minor-moons-report'); extra=read('extended-data')['bodies']
    physical=read('supplemental-data')['physical']; refs=read('surface-references')['bodies']
    moon_ids={b['id'] for b in moons['bodies']}
    report['extractedCount']=len(moon_ids)
    report['extractedByParent']=dict(Counter(b['parent'] for b in moons['bodies']))
    report['unsupportedByParent']={parent:[{**b,'reason':'No imported orbit'} for b in candidates if b['id'] not in moon_ids]
        for parent,candidates in report['assetCandidatesByParent'].items()}
    write('minor-moons-report',report)
    epoch=datetime.fromisoformat(moons['epoch'].replace('Z','+00:00')).timestamp()*1000
    gaps=[key for key,b in extra.items() if not (b.get('texture') or b.get('model') or key=='vesta')]
    audit={'auditDate':'2026-09-13','scope':'Local OpenSpace asset snapshot, not a census of all known Solar System objects',
        'majorEntries':10+len(extra),'minorMoonEntries':len(moon_ids),'selectableEntries':10+len(extra)+len(moon_ids),
        'minorMoonsByParent':report['extractedByParent'],
        'missingOriginalMinorMoonCandidates':report['unsupportedByParent'],
        'minorMoonSamples':{'bodies':sum(bool(b.get('spiceSamples')) for b in moons['bodies']),
            'statePoints':sum(len(b.get('spiceSamples',[])) for b in moons['bodies']),
            'maxMidpointResidualKm':moons['sampleCoverage']['maxValidatedInterpolationErrorKm'],
            'referenceTimeUTC':moons['epoch'],
            'coveringReferenceTime':sum(b['sampleWindow'][0]<=epoch<=b['sampleWindow'][1] for b in moons['bodies']),
            'outsideWindow':'Fixed osculating Kepler orbit; residual does not describe true ephemeris accuracy'},
        'physicalRecords':len(physical),'minorMoonsWithPhysicalRecords':len(moon_ids & physical.keys()),
        'referencePhotos':len(refs),'missingGlobalMapAndIndependentMesh':gaps,
        'updatedSmallBodySnapshots':len(read('small-body-updates')['bodies']),
        'limitations':[
            'Global maps remain unavailable locally for 15 modeled entries; reference photos are not spherical maps.',
            'Distant dwarf-body dimensions still include unversioned display estimates; SBDB provides no GM/diameter/density for eight of ten queried bodies.',
            'Most small moons have no imported physical parameters or resolved surface data.',
            'Only local SPK windows are sampled, not continuous 1900–2100 ephemerides; major satellites mostly still use fixed Kepler elements.',
            'LROC/LOLA lunar resources are finite-resolution mosaics; illumination omits terrain shadow casting and eclipses.',
            'The sixteen full small-body catalogs remain the previously downloaded OpenSpace snapshots; one non-elliptic/incomplete record is not positioned.',
            'Other planetary terrain tiles, full ring dynamics, comet activity and full SPICE attitude/observation solvers are not integrated.'
        ]}
    write('data-coverage',audit)
    print(json.dumps(audit,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
