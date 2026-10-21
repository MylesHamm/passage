import {isSnapshotVessel} from '../vessel-data.mjs';
// Regional reference coordinates, not event locations or navigable routes.
export const VERTICAL_EXAGGERATION = 4;
export const SCENES = {
  hormuz: { id:'hormuz', name:'Strait of Hormuz', shortName:'Hormuz', center:[56.25,26.57], tileOrigin:[166,106], zoom:8, tileSpan:4, extent:340,
    coordinates:'26.57° N / 56.25° E',
    labels:[
      {name:'IRAN',point:[56.88,27.12],kind:'country'},
      {name:'OMAN',point:[56.44,25.6],kind:'country'},
      {name:'UAE',point:[55.5,25.4],kind:'country'},
      {name:'Qeshm',point:[55.72,26.76],kind:'region'},
      {name:'Musandam',point:[56.3,26.13],kind:'region'},
      {name:'Bandar Abbas',point:[56.28,27.18],kind:'place'},
      {name:'GULF OF OMAN',point:[57.38,25.96],kind:'water'},
      {name:'PERSIAN GULF',point:[54.96,26.65],kind:'water'}
    ] },
  // Regional war theatre, Gulf to Red Sea. Labels are static reference names.
  theatre: { id:'theatre', name:'Gulf to Red Sea', shortName:'Regional war', center:[45.0,21.94], tileOrigin:[18,12], zoom:5, tileSpan:4, extent:3600, exaggeration:24,
    coordinates:'22.5–67.5° E / 0–41° N',
    labels:[
      {name:'IRAN',point:[54.5,32.4],kind:'country'},
      {name:'IRAQ',point:[43.6,33.0],kind:'country'},
      {name:'SAUDI ARABIA',point:[45.0,23.6],kind:'country'},
      {name:'YEMEN',point:[47.6,15.6],kind:'country'},
      {name:'OMAN',point:[56.6,20.6],kind:'country'},
      {name:'UAE',point:[54.4,23.6],kind:'country'},
      {name:'QATAR',point:[51.2,25.2],kind:'country'},
      {name:'KUWAIT',point:[47.6,29.4],kind:'country'},
      {name:'ISRAEL',point:[34.9,31.3],kind:'country'},
      {name:'JORDAN',point:[36.6,30.9],kind:'country'},
      {name:'SYRIA',point:[38.5,35.0],kind:'country'},
      {name:'EGYPT',point:[30.5,26.5],kind:'country'},
      {name:'SUDAN',point:[30.5,16.5],kind:'country'},
      {name:'ERITREA',point:[38.8,15.6],kind:'country'},
      {name:'DJIBOUTI',point:[42.6,11.7],kind:'country'},
      {name:'SOMALIA',point:[46.2,6.5],kind:'country'},
      {name:'Tehran',point:[51.39,35.69],kind:'place'},
      {name:'Bandar Abbas',point:[56.28,27.18],kind:'place'},
      {name:'Sanaa',point:[44.21,15.37],kind:'place'},
      {name:'Hodeidah',point:[42.95,14.8],kind:'place'},
      {name:'Aden',point:[45.03,12.79],kind:'place'},
      {name:'Riyadh',point:[46.72,24.71],kind:'place'},
      {name:'Jeddah',point:[39.19,21.49],kind:'place'},
      {name:'Tel Aviv',point:[34.78,32.08],kind:'place'},
      {name:'Eilat',point:[34.95,29.56],kind:'place'},
      {name:'Baghdad',point:[44.36,33.31],kind:'place'},
      {name:'Doha',point:[51.53,25.29],kind:'place'},
      {name:'Dubai',point:[55.27,25.2],kind:'place'},
      {name:'Muscat',point:[58.41,23.59],kind:'place'},
      {name:'RED SEA',point:[38.8,20.4],kind:'water'},
      {name:'GULF OF ADEN',point:[48.5,12.6],kind:'water'},
      {name:'ARABIAN SEA',point:[61.5,15.5],kind:'water'},
      {name:'PERSIAN GULF',point:[51.6,27.0],kind:'water'},
      {name:'GULF OF OMAN',point:[58.6,24.6],kind:'water'},
      {name:'MEDITERRANEAN',point:[29.5,33.6],kind:'water'}
    ] }
};
export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
// Relief exaggeration is per scene: 4x reads at strait scale, a 4,700 km theatre needs more.
export const exaggerationOf=scene=>Number.isFinite(scene?.exaggeration)&&scene.exaggeration>0?scene.exaggeration:VERTICAL_EXAGGERATION;
// Both straits is a separate overview, never an alias for a single terrain tile.
export function sceneFor(theatre){return SCENES[theatre]||null;}
export function mercatorY(latitude){return (1-Math.asinh(Math.tan(latitude*Math.PI/180))/Math.PI)/2;}
export function longitudeLatitudeToUV(point,scene){const n=2**scene.zoom;return [((point[0]+180)/360*n-scene.tileOrigin[0])/scene.tileSpan,(mercatorY(point[1])*n-scene.tileOrigin[1])/scene.tileSpan];}
export function sceneWidthKm(scene){return 40075.016686*Math.cos(scene.center[1]*Math.PI/180)*scene.tileSpan/2**scene.zoom;}
export function geographicPoint(point,scene,height=0){const uv=longitudeLatitudeToUV(point,scene),center=longitudeLatitudeToUV(scene.center,scene),width=sceneWidthKm(scene);return [(uv[0]-center[0])*width,height,(uv[1]-center[1])*width];}
export function buildTerrainMesh(heights,scene,size=256){
  if(!(heights instanceof Uint16Array)||heights.length!==size*size||size>256||size<2)throw new Error('Invalid terrain grid');
  const vertices=new Float32Array(size*size*5),indices=new Uint16Array((size-1)*(size-1)*6),width=sceneWidthKm(scene),center=longitudeLatitudeToUV(scene.center,scene);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,at=i*5,u=x/(size-1),v=y/(size-1);
    vertices[at]=(u-center[0])*width;vertices[at+1]=heights[i]/1000*exaggerationOf(scene);vertices[at+2]=(v-center[1])*width;vertices[at+3]=u;vertices[at+4]=v;
  }
  let j=0;for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const i=y*size+x;indices[j++]=i;indices[j++]=i+size;indices[j++]=i+1;indices[j++]=i+1;indices[j++]=i+size;indices[j++]=i+size+1;}
  return {vertices,indices};
}
export function multiply(a,b){const out=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++){let v=0;for(let k=0;k<4;k++)v+=a[k*4+row]*b[col*4+k];out[col*4+row]=v;}return out;}
function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
export function cameraMatrix(pose,scene,width,height){
  const aspect=Math.max(.1,width/height),fov=40*Math.PI/180;
  const span=scene.extent*Math.min(1,aspect/1.45)/pose.zoom;
  const distance=span/(2*Math.tan(fov/2)*aspect);
  const tilt=pose.topDown?.0001:pose.tilt, yaw=pose.yaw;
  const center=[pose.panX,0,pose.panZ];
  const eye=[center[0]+Math.sin(yaw)*Math.sin(tilt)*distance,Math.cos(tilt)*distance,center[2]+Math.cos(yaw)*Math.sin(tilt)*distance];
  const z=normalize(eye.map((n,i)=>n-center[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);
  const view=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-x.reduce((s,v,i)=>s+v*eye[i],0),-y.reduce((s,v,i)=>s+v*eye[i],0),-z.reduce((s,v,i)=>s+v*eye[i],0),1]);
  const near=Math.max(.2,scene.extent/1700),far=Math.max(2400,scene.extent*7),f=1/Math.tan(fov/2),projection=new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
  return {matrix:multiply(projection,view),span,eye};
}
export function project(point,matrix,width,height){const [x,y,z]=point,w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];if(w<=0)return{x:-1000,y:-1000,visible:false};const px=(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w,py=(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w;return{x:(px*.5+.5)*width,y:(.5-py*.5)*height,visible:px>-.97&&px<.97&&py>-.92&&py<.92};}
export function isCoordinate(point){return Number.isFinite(point?.longitude)&&Number.isFinite(point?.latitude)&&Math.abs(point.longitude)<=180&&Math.abs(point.latitude)<85;}
export function eligibleVessels(vessels,scene,now=Date.now()){return(Array.isArray(vessels)?vessels:[]).filter(v=>!isSnapshotVessel(v)&&isCoordinate(v)&&Number.isFinite(Date.parse(v.positionTime))&&now-Date.parse(v.positionTime)>=0&&now-Date.parse(v.positionTime)<1800000&&(!v.theater||v.theater===scene.id));}
export function defaultPose(){return {zoom:1,tilt:.72,yaw:-.1,panX:0,panZ:0,topDown:false};}
