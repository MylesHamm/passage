"""Reproducible static terrain build. Network used at build time only; application is offline-capable.
Requires Pillow, numpy, scipy. Source Terrarium tiles are cached beside this script.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, json, hashlib, math, datetime, os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, distance_transform_edt
ROOT=Path(__file__).resolve().parents[2]
CACHE=Path(os.environ.get('TERRAIN_TILE_CACHE','/tmp/passage-terrain-source-tiles')); CACHE.mkdir(exist_ok=True)
ASSETS=ROOT/'dist'/'terrain'/'assets'; ASSETS.mkdir(exist_ok=True)
SCENES={'hormuz':{'x':166,'y':106,'center':[56.25,26.57]},'bab':{'x':157,'y':117,'center':[43.33,12.58]}}
def fetch(job):
 name,x,y=job; file=CACHE/f'{name}-8-{x}-{y}.png'; headers=file.with_suffix('.headers')
 url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/{x}/{y}.png'
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
 centerlat=s['center'][1]; spacing=40075016.686*math.cos(math.radians(centerlat))/(256*256)
 gy,gx=np.gradient(smooth,spacing)
 # The display relief is exaggerated 4x. Normals correspond to that relief.
 normals=np.dstack((-gx*4,np.ones_like(gx),-gy*4)); normals/=np.linalg.norm(normals,axis=2)[:,:,None]
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
 north=math.degrees(math.atan(math.sinh(math.pi*(1-2*s['y']/256))))
 south=math.degrees(math.atan(math.sinh(math.pi*(1-2*(s['y']+4)/256))))
 s.update({'zoom':8,'tileCount':16,'width':1024,'height':1024,'meshSize':256,'bounds':{'west':s['x']/256*360-180,'east':(s['x']+4)/256*360-180,'north':north,'south':south},'sampleSpacingMetresAtSceneCenter':round(spacing,1),'meshSpacingMetresAtSceneCenter':round(spacing*1023/255,1),'maxElevationMetres':round(float(h.max()),1),'landFraction':round(float(land.mean()),4),'sourceAnomalies':([{'description':'One isolated 6,803 m source sample at mosaic x361,y293, outside the focused strait. Not validated as a physical peak and not sampled by the display mesh. Raw source is retained; normal-texture display smoothing applies.','pixel':[361,293],'rawElevationMetres':6803}] if name=='bab' else []),'sourceModifiedDates':sorted(set(r['header'].split('last-modified: ')[1].split('\n')[0].strip() for r in records if r['name']==name and 'last-modified:' in r['header'].lower()))})
 print(name,json.dumps(s))
provenance={'retrieved':'2026-10-17','dataset':'Mapzen Terrain Tiles','encoding':'Terrarium: R × 256 + G + B/256 − 32768 metres','display':'Terrain uses 4× vertical exaggeration. Water is flattened to sea level and shows no bathymetry. GPU normals use 0.65-pixel Gaussian display smoothing. Surface colors are a designed elevation palette, not satellite imagery. Coordinates follow Web Mercator; horizontal kilometre scale is local to scene center. DEM grid is 256 × 256; normal and coast textures retain 1024 × 1024 samples.','sources':['https://registry.opendata.aws/terrain-tiles/','https://github.com/tilezen/joerd/blob/master/docs/formats.md','https://github.com/tilezen/joerd/blob/master/docs/attribution.md'],'credit':'Mapzen Terrain Tiles. SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey. Global ETOPO1 terrain data: U.S. National Oceanic and Atmospheric Administration.','limitations':'Static reference geography, not current observations. Mixed source years and resolutions. Tile modification dates are not survey dates. Encoding precision does not establish accuracy. Not for navigation.','scenes':SCENES,'tiles':records}
(ASSETS/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
