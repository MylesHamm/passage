"""Reproducible static terrain build. Network used at build time only; application is offline-capable.
Requires Pillow, numpy, scipy. Source Terrarium tiles are cached beside this script.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, json, hashlib, math, datetime, os, re
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, distance_transform_edt
ROOT=Path(__file__).resolve().parents[2]
CACHE=Path(os.environ.get('TERRAIN_TILE_CACHE','/tmp/passage-terrain-source-tiles')); CACHE.mkdir(exist_ok=True)
ASSETS=ROOT/'dist'/'terrain'/'assets'; ASSETS.mkdir(exist_ok=True)
ALL_SCENES={'hormuz':{'x':166,'y':106,'center':[56.25,26.57]},
 # Gulf to Red Sea theatre: 4 x 4 zoom-5 tiles, 22.5-67.5 E and 0-41 N.
 'theatre':{'x':18,'y':12,'zoom':5,'exaggeration':24,'center':[45.0,21.94]}}
# PASSAGE_TERRAIN_SCENES=theatre rebuilds only that scene and merges its provenance,
# leaving other scenes' assets and records untouched.
WANTED=[n for n in os.environ.get('PASSAGE_TERRAIN_SCENES','hormuz,theatre').split(',') if n in ALL_SCENES]
SCENES={n:dict(ALL_SCENES[n]) for n in WANTED}
for s in SCENES.values(): s.setdefault('zoom',8); s.setdefault('exaggeration',4)
def fetch(job):
 name,x,y=job; z=SCENES[name]['zoom']; file=CACHE/f'{name}-{z}-{x}-{y}.png'; headers=file.with_suffix('.headers')
 url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
 if not file.exists():
  with urllib.request.urlopen(url,timeout=40) as r:
   file.write_bytes(r.read());headers.write_text(str(r.headers))
 arr=np.array(Image.open(file).convert('RGB'))
 assert arr.shape==(256,256,3), (file,arr.shape)
 return {'name':name,'x':x,'y':y,'url':url,'file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'header':headers.read_text() if headers.exists() else ''}
jobs=[(name, x,y) for name,s in SCENES.items() for y in range(s['y'],s['y']+4) for x in range(s['x'],s['x']+4)]
records=list(ThreadPoolExecutor(max_workers=8).map(fetch,jobs))
for name,s in SCENES.items():
 rgb=np.zeros((1024,1024,3),dtype=np.uint8)
 for r in records:
  if r['name']==name:
   rgb[(r['y']-s['y'])*256:(r['y']-s['y']+1)*256,(r['x']-s['x'])*256:(r['x']-s['x']+1)*256,:]=Image.open(CACHE/r['file']).convert('RGB')
 h=rgb[:,:,0].astype(float)*256+rgb[:,:,1].astype(float)+rgb[:,:,2]/256-32768
 # Preserve at-source coastline; non-positive terrain is displayed as undifferentiated water.
 # Smooth just 0.65 source pixels for lighting; never generate geographic shapes.
 land=h>0
 smooth=gaussian_filter(np.maximum(h,0),.65)
 centerlat=s['center'][1]; spacing=40075016.686*math.cos(math.radians(centerlat))/(256*2**s['zoom']); ex=s['exaggeration']
 gy,gx=np.gradient(smooth,spacing)
 # The display relief is exaggerated per scene. Normals correspond to that relief.
 normals=np.dstack((-gx*ex,np.ones_like(gx),-gy*ex)); normals/=np.linalg.norm(normals,axis=2)[:,:,None]
 normalbytes=np.round((normals*.5+.5)*255).astype(np.uint8)
 # Texture RG: metre elevation uint16; B: land mask; A: actual shore distance in pixels, capped.
 height=np.round(np.maximum(h,0)).clip(0,65535).astype(np.uint16)
 distance=distance_transform_edt(~land)
 packed=np.dstack((height>>8,height&255,land*255,np.minimum(distance*12,255))).astype(np.uint8)
 Image.fromarray(packed).save(ASSETS/f'{name}-height.png',optimize=True)
 Image.fromarray(normalbytes).save(ASSETS/f'{name}-normal.png',optimize=True)
 # A pre-rendered plan image is independent of WebGL, and remains available on GPU failure.
 light=np.array([-.48,.8,.36]);light/=np.linalg.norm(light)
 shade=np.maximum(0,(normals*light).sum(axis=2))
 low=np.array([96,112,113]);high=np.array([174,166,142])
 base=low[None,None,:]+(high-low)[None,None,:]*np.minimum(smooth/2200,1)[:,:,None]
 ambient=.34+.75*shade
 landcolor=base*ambient[:,:,None]
 sea=np.tile(np.array([10.,33.,47.]),(1024,1024,1))
 sea+=np.exp(-distance/9)[:,:,None]*np.array([3,19,22])[None,None,:]
 color=np.where(land[:,:,None],landcolor,sea).clip(0,255).astype(np.uint8)
 Image.fromarray(color).save(ASSETS/f'{name}-plan.webp',quality=88,method=6)
 # uint16 elevation grid stays uncompressed locally; HTTP compression helps transfer.
 # Sample source corners for exact mesh registration with texture: row 0 is north.
 indices=np.linspace(0,1023,256).round().astype(int)
 mesh=height[indices[:,None],indices[None,:]]
 mesh.astype('<u2').tofile(ASSETS/f'{name}-dem.bin')
 n=2**s['zoom']
 north=math.degrees(math.atan(math.sinh(math.pi*(1-2*s['y']/n))))
 south=math.degrees(math.atan(math.sinh(math.pi*(1-2*(s['y']+4)/n))))
 s.update({'tileCount':16,'width':1024,'height':1024,'meshSize':256,'retrieved':datetime.date.today().isoformat(),'bounds':{'west':s['x']/n*360-180,'east':(s['x']+4)/n*360-180,'north':north,'south':south},'sampleSpacingMetresAtSceneCenter':round(spacing,1),'meshSpacingMetresAtSceneCenter':round(spacing*1023/255,1),'maxElevationMetres':round(float(h.max()),1),'landFraction':round(float(land.mean()),4),'sourceAnomalies':[],'sourceModifiedDates':sorted(set(m.group(1).strip() for r in records if r['name']==name for m in [re.search(r'(?im)^last-modified:\s*(.+)$',r['header'])] if m))})
 print(name,json.dumps(s))
previous=json.loads((ASSETS/'provenance.json').read_text()) if (ASSETS/'provenance.json').exists() else {}
provenance={'retrieved':'2026-10-17','dataset':'Mapzen Terrain Tiles','encoding':'Terrarium: R × 256 + G + B/256 − 32768 metres','display':'Terrain uses vertical exaggeration (4× for the straits, 24× for the theatre). Water is flattened to sea level and shows no bathymetry. GPU normals use 0.65-pixel Gaussian display smoothing. Surface colors are a designed elevation palette, not satellite imagery. Coordinates follow Web Mercator; horizontal kilometre scale is local to scene center. DEM grid is 256 × 256; normal and coast textures retain 1024 × 1024 samples.','sources':['https://registry.opendata.aws/terrain-tiles/','https://github.com/tilezen/joerd/blob/master/docs/formats.md','https://github.com/tilezen/joerd/blob/master/docs/attribution.md'],'credit':'Mapzen Terrain Tiles. SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey. Global ETOPO1 terrain data: U.S. National Oceanic and Atmospheric Administration.','limitations':'Static reference geography, not current observations. Mixed source years and resolutions. Tile modification dates are not survey dates. Encoding precision does not establish accuracy. Not for navigation.','scenes':{**previous.get('scenes',{}),**SCENES},'tiles':[t for t in previous.get('tiles',[]) if t['name'] not in SCENES]+records}
(ASSETS/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
