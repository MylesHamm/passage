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
  bab: { id:'bab', name:'Bab el-Mandeb', shortName:'Bab el-Mandeb', center:[43.33,12.58], tileOrigin:[157,117], zoom:8, tileSpan:4, extent:310,
    coordinates:'12.58° N / 43.33° E',
    labels:[
      {name:'YEMEN',point:[44.03,13.03],kind:'country'},
      {name:'DJIBOUTI',point:[42.64,12.18],kind:'country'},
      {name:'ERITREA',point:[42.45,13.08],kind:'country'},
      {name:'Djibouti',point:[43.14,11.6],kind:'place'},
      {name:'Assab',point:[42.74,13.01],kind:'place'},
      {name:'RED SEA',point:[42.96,13.54],kind:'water'},
      {name:'GULF OF ADEN',point:[44.25,12.05],kind:'water'}
    ] }
};
export const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function sceneFor(theatre){return SCENES[theatre]||SCENES.hormuz;}
export function mercatorY(latitude){return (1-Math.asinh(Math.tan(latitude*Math.PI/180))/Math.PI)/2;}
export function longitudeLatitudeToUV(point,scene){const n=2**scene.zoom;return [((point[0]+180)/360*n-scene.tileOrigin[0])/scene.tileSpan,(mercatorY(point[1])*n-scene.tileOrigin[1])/scene.tileSpan];}
export function sceneWidthKm(scene){return 40075.016686*Math.cos(scene.center[1]*Math.PI/180)*scene.tileSpan/2**scene.zoom;}
export function geographicPoint(point,scene,height=0){const uv=longitudeLatitudeToUV(point,scene),center=longitudeLatitudeToUV(scene.center,scene),width=sceneWidthKm(scene);return [(uv[0]-center[0])*width,height,(uv[1]-center[1])*width];}
export function buildTerrainMesh(heights,scene,size=256){
  if(!(heights instanceof Uint16Array)||heights.length!==size*size||size>256||size<2)throw new Error('Invalid terrain grid');
  const vertices=new Float32Array(size*size*5),indices=new Uint16Array((size-1)*(size-1)*6),width=sceneWidthKm(scene),center=longitudeLatitudeToUV(scene.center,scene);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*size+x,at=i*5,u=x/(size-1),v=y/(size-1);
    vertices[at]=(u-center[0])*width;vertices[at+1]=heights[i]/1000*VERTICAL_EXAGGERATION;vertices[at+2]=(v-center[1])*width;vertices[at+3]=u;vertices[at+4]=v;
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
  const near=.2,far=2400,f=1/Math.tan(fov/2),projection=new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
  return {matrix:multiply(projection,view),span,eye};
}
export function project(point,matrix,width,height){const [x,y,z]=point,w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];if(w<=0)return{x:-1000,y:-1000,visible:false};const px=(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w,py=(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w;return{x:(px*.5+.5)*width,y:(.5-py*.5)*height,visible:px>-.97&&px<.97&&py>-.92&&py<.92};}
export function isCoordinate(point){return Number.isFinite(point?.longitude)&&Number.isFinite(point?.latitude)&&Math.abs(point.longitude)<=180&&Math.abs(point.latitude)<85;}
export function eligibleVessels(vessels,scene,now=Date.now()){return(Array.isArray(vessels)?vessels:[]).filter(v=>isCoordinate(v)&&Number.isFinite(Date.parse(v.positionTime))&&now-Date.parse(v.positionTime)>=0&&now-Date.parse(v.positionTime)<1800000&&(!v.theater||v.theater===scene.id));}
export function defaultPose(){return {zoom:1,tilt:.72,yaw:-.1,panX:0,panZ:0,topDown:false};}
