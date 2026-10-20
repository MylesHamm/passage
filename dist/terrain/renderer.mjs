import {buildTerrainMesh,cameraMatrix,geographicPoint,project,longitudeLatitudeToUV,sceneWidthKm,clamp} from './geometry.mjs';
const VERTEX=`
attribute vec3 a_position;
attribute vec2 a_uv;
uniform mat4 u_matrix;
varying vec2 v_uv;
varying vec3 v_position;
void main(){v_uv=a_uv;v_position=a_position;gl_Position=u_matrix*vec4(a_position,1.0);}`;
const FRAGMENT=`
precision highp float;
varying vec2 v_uv;
varying vec3 v_position;
uniform sampler2D u_height;
uniform sampler2D u_normal;
uniform vec3 u_eye;
void main(){
 vec4 data=texture2D(u_height,v_uv);
 float elevation=(data.r*65280.0+data.g*255.0);
 vec3 normal=normalize(texture2D(u_normal,v_uv).rgb*2.0-1.0);
 vec3 sun=normalize(vec3(-0.55,0.8,-0.4));
 float diffuse=max(dot(normal,sun),0.0);
 float ambient=0.37+diffuse*0.76;
 float altitude=smoothstep(40.0,2500.0,elevation);
 vec3 rock=mix(vec3(0.34,0.40,0.39),vec3(0.64,0.60,0.48),altitude);
 float steep=1.0-normal.y;
 rock=mix(rock,vec3(0.38,0.41,0.40),clamp(steep,0.0,1.0)*0.3);
 vec3 land=rock*ambient;
 // Display contours derive only from the DEM. Surface color is not satellite imagery.
 float contour=1.0-smoothstep(0.0,7.0,min(mod(elevation,250.0),250.0-mod(elevation,250.0)));
 land*=1.0-contour*0.09*smoothstep(50.0,150.0,elevation);
 float shore=exp(-data.a*9.0);
 vec3 water=mix(vec3(0.025,0.105,0.15),vec3(0.055,0.22,0.255),shore*0.63);
 // Static water shading carries no current, depth, or traffic meaning.
 float horizon=clamp((v_position.z+250.0)/600.0,0.0,1.0);
 water*=0.91+horizon*0.16;
 vec3 color=mix(water,land,smoothstep(0.36,0.64,data.b));
 float edge=min(min(v_uv.x,1.0-v_uv.x),min(v_uv.y,1.0-v_uv.y));
 float edgeFade=smoothstep(0.0,0.065,edge);
 float fog=clamp(length(v_position-u_eye)/1100.0,0.0,0.55);
 color=mix(color,vec3(0.025,0.085,0.125),fog*fog*0.5);
 color=mix(vec3(0.025,0.105,0.15),color,edgeFade);
 gl_FragColor=vec4(color,1.0);
}`;
function compile(gl,type,source){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`Terrain shader: ${error}`);}return shader;}
function texture(gl,image){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
export function createWebGLRenderer(canvas){
 const gl=canvas.getContext('webgl',{alpha:false,antialias:true,depth:true,preserveDrawingBuffer:false,powerPreference:'low-power'});
 if(!gl)throw new Error('WebGL is unavailable');
 const vs=compile(gl,gl.VERTEX_SHADER,VERTEX),fs=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT),program=gl.createProgram();
 gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Terrain GPU program unavailable');
 gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(.025,.105,.15,1);
 const position=gl.getAttribLocation(program,'a_position'),uv=gl.getAttribLocation(program,'a_uv');
 const uniforms=Object.fromEntries(['matrix','height','normal','eye'].map(name=>[name,gl.getUniformLocation(program,`u_${name}`)]));
 const vertexBuffer=gl.createBuffer(),indexBuffer=gl.createBuffer();let count=0,textures=[],scene,data,width=1,height=1,lastMatrix,lastSpan;
 function setScene(next,assets){
  scene=next;data=assets;const mesh=buildTerrainMesh(assets.heights,scene);
  gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);count=mesh.indices.length;
  textures.forEach(t=>gl.deleteTexture(t));textures=[texture(gl,assets.heightImage),texture(gl,assets.normalImage)];
 }
 function resize(w,h){width=w;height=h;const dpr=Math.min(1.75,globalThis.devicePixelRatio||1),maxPixels=2300000,ratio=Math.min(dpr,Math.sqrt(maxPixels/(w*h)));canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));gl.viewport(0,0,canvas.width,canvas.height);}
 function draw(pose){if(!scene)return;const camera=cameraMatrix(pose,scene,width,height);lastMatrix=camera.matrix;lastSpan=camera.span;
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,20,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.uniformMatrix4fv(uniforms.matrix,false,camera.matrix);gl.uniform3fv(uniforms.eye,camera.eye);
  textures.forEach((t,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);gl.uniform1i(i===0?uniforms.height:uniforms.normal,i);});
  gl.drawElements(gl.TRIANGLES,count,gl.UNSIGNED_SHORT,0);
 }
 function elevation(point){const [u,v]=longitudeLatitudeToUV(point,scene);if(u<0||u>1||v<0||v>1)return 0;return data.heights[Math.round(v*255)*256+Math.round(u*255)]*.004;}
 return {mode:'webgl',setScene,resize,draw,
   point(point,offset=.4){return lastMatrix?project(geographicPoint(point,scene,elevation(point)+offset),lastMatrix,width,height):{visible:false};},
   localPoint(point){return project(point,lastMatrix,width,height);},
   get span(){return lastSpan;},get triangleCount(){return count/3;},get pixelCount(){return canvas.width*canvas.height;},
   destroy(){textures.forEach(t=>gl.deleteTexture(t));gl.deleteBuffer(vertexBuffer);gl.deleteBuffer(indexBuffer);gl.deleteProgram(program);},get gl(){return gl;}
 };
}
export function createPlanRenderer(canvas){
 const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Canvas rendering is unavailable');let width=1,height=1,scene,data,pose,span=1,scale=1;
 function resize(w,h){width=w;height=h;const ratio=Math.min(1.5,globalThis.devicePixelRatio||1);canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);}
 function localPoint(point){const x=(point[0]-pose.panX)*scale+width/2,y=(point[2]-pose.panZ)*scale+height/2;return{x,y,visible:x>10&&x<width-10&&y>15&&y<height-15};}
 return{mode:'plan',setScene(next,assets){scene=next;data=assets;},resize,draw(next){pose=next;const aspect=width/height;span=scene.extent*Math.min(1,aspect/1.45)/pose.zoom;scale=width/span;ctx.fillStyle='#061b26';ctx.fillRect(0,0,width,height);if(!scene||!data?.planImage)return;const center=longitudeLatitudeToUV(scene.center,scene),size=sceneWidthKm(scene)*scale;ctx.drawImage(data.planImage,width/2-center[0]*size-pose.panX*scale,height/2-center[1]*size-pose.panZ*scale,size,size);},point(point){return localPoint(geographicPoint(point,scene));},localPoint,get span(){return span;},get triangleCount(){return 0;},get pixelCount(){return canvas.width*canvas.height;},destroy(){}};
}
export {loadSceneAssets} from './scene-assets.mjs';
