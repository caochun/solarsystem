"""Import actual spacecraft photos as reference images, never as global textures.

NASA IDs are curated after inspecting their original metadata. Preserve the
published JPEG, captions, credits, processing caveats and checksum unchanged.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib, json, subprocess
from pathlib import Path
from PIL import Image

WEB = Path(__file__).resolve().parents[1]
CACHE = WEB/'data-cache/surface-references'
CHOICES = {
    'ariel': ('PIA00041', '旅行者 2 号拍摄的彩色影像，仅覆盖可见一侧。'),
    'umbriel': ('PIA00040', '旅行者 2 号近距离飞掠影像，仅覆盖可见一侧。'),
    'titania': ('PIA00036', '旅行者 2 号彩色合成影像，仅覆盖可见一侧。'),
    'oberon': ('PIA00034', '旅行者 2 号飞掠影像，仅覆盖可见一侧。'),
    'miranda': ('PIA00042', '旅行者 2 号彩色合成影像，仅覆盖可见一侧。'),
    'hyperion': ('PIA07768', '卡西尼号色彩变化影像；色彩处理用于突出地表差异。'),
    'nereid': ('PIA00054', '旅行者 2 号低分辨率影像，约 43 km/原始像素，只能辨认轮廓与亮度；旧图注中的尺寸不用于更新物理参数。'),
    'nix': ('PIA20287', '新视野号 MVIC 全色影像，2015 年 7 月 14 日拍摄，表面部分受光。'),
    'hydra': ('PIA19711', '新视野号早期回传影像，分辨率有限；显示像素不代表可辨认同等尺度的地貌。'),
    'kerberos': ('PIA20034', '2015 年 7 月 14 日四张 LORRI 影像合成，经去卷积和 8 倍放大；放大不增加原始观测分辨率。'),
    'styx': ('PIA20033', '新视野号 LORRI 卫星合图，含冥卫一及四颗小卫星，保留原标尺；冥卫五没有解析的全球地表图。'),
}

def fetch(url, path):
    if not path.exists():
        temp = path.with_suffix('.part')
        subprocess.run(['curl','-fsSL','--retry','2','--connect-timeout','15','--max-time','90',url,'-o',str(temp)], check=True)
        temp.replace(path)

def import_one(pair):
    body,(nasa_id,note) = pair
    api = f'https://images-api.nasa.gov/search?nasa_id={nasa_id}'
    metadata = CACHE/f'{nasa_id}.json'
    fetch(api,metadata)
    items = json.loads(metadata.read_text())['collection']['items']
    item = next(x for x in items if x['data'][0]['nasa_id']==nasa_id)
    data = item['data'][0]
    source = next(x['href'] for x in item['links'] if x.get('rel')=='canonical' and x['href'].endswith('.jpg'))
    path = WEB/f'public/reference-images/{nasa_id}.jpg'
    fetch(source,path)
    with Image.open(path) as im:
        width,height=im.size; im.verify()
    print(body,nasa_id,width,height,flush=True)
    return body, {'nasaId':nasa_id,'path':f'reference-images/{nasa_id}.jpg','source':source,
        'metadataUrl':api,'page':f'https://images.nasa.gov/details/{nasa_id}',
        'title':data['title'],'description':data['description'],'credit':data.get('secondary_creator',data['center']),
        'published':data['date_created'],'retrieved':'2026-09-13','note':note,
        'kind':'spacecraft observation reference; not a global map','width':width,'height':height,
        'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def main():
    CACHE.mkdir(parents=True,exist_ok=True)
    (WEB/'public/reference-images').mkdir(parents=True,exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        bodies=dict(pool.map(import_one,CHOICES.items()))
    (WEB/'src/surface-references.json').write_text(json.dumps({'bodies':bodies},ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__': main()
