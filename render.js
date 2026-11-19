// All geometry, lights, collision maps and camera coordinates use metres, Z up.
function createProgram(gl, vertex, fragment) {
  const program=gl.createProgram();
  for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  return program;
}
function uniforms(gl,program,names){
  return Object.fromEntries(names.split(' ').map(name=>[name,gl.getUniformLocation(program,name)]));
}
const projection= `
uniform vec3 eye,right,up,forward;
uniform vec2 focal;
vec4 project(vec3 p){
  vec3 d=p-eye;float z=dot(d,forward);
  return vec4(dot(d,right)*focal.x,dot(d,up)*focal.y,1.001*z-.056,z);
}`;
const reflection= `
uniform sampler2D environment;uniform vec3 eye;uniform vec2 room;
vec3 reflected(vec3 p,vec3 n,float roughness){
  vec3 ray=reflect(normalize(p-eye),n);
  vec3 edge=mix(vec3(0),vec3(room,3.1),step(vec3(0),ray));
  vec3 dist=(edge-clamp(p,vec3(.001),vec3(room,3.1)-.001))/(ray+vec3(.00001));
  float t=max(.01,min(dist.x,min(dist.y,dist.z)));
  vec3 probe=room.x<10.?vec3(4,5,1.5):vec3(8,10,1.5);
  vec3 envDir=normalize(p+ray*t-probe);
  vec2 uv=vec2(.5+atan(envDir.x,envDir.y)*.15915494,.5-asin(clamp(envDir.z,-1.,1.))*.31830989);
  return textureLod(environment,uv,roughness*7.).rgb;
}
float fresnel(vec3 view,vec3 n,float f0){
  return f0+(1.-f0)*pow(1.-clamp(abs(dot(view,n)),0.,1.),5.);
}
float noise2(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  vec3 p3=fract(vec3(i.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);
  float a=fract((p3.x+p3.y)*p3.z);
  return .56*a+.44*sin(dot(p,vec2(.43,.67))+sin(p.y*.94));
}`;
// Baked visibility and incident light direction from the real pendants and track fixtures.
// Four bilinear reads interpolate the two neighbouring height slices of the light field.
const ceilingIllumination = `
uniform sampler2D lightField;
vec2 fieldUV(float slice,vec2 grid,vec2 cells) {
  vec2 tile=vec2(mod(slice,7.),floor(slice/7.));
  return (tile+(grid*(cells-1.)+.5)/cells)/vec2(7.,8.);
}
vec3 ceilingLight(vec3 c,vec3 p,vec3 N,vec3 V,float gloss){
  float westEdge=room.x<10.?4.8:9.238;
  float southEdge=room.x<10.?2.50:1.13;
  vec3 lo=vec3(-.16,southEdge-.72,.025), hi=vec3(westEdge+.40,room.y+.06,3.035);
  if(any(lessThan(p.xy,lo.xy))||any(greaterThan(p.xy,hi.xy))||p.z>3.05)return c;
  float mask=(1.-smoothstep(westEdge-.07,hi.x,p.x))*smoothstep(lo.y,southEdge,p.y);
  vec3 q=clamp((p+N*.036-lo)/(hi-lo),0.,1.);
  float height=q.z*27.,level=floor(height);
  vec2 cells=vec2(textureSize(lightField,0))/vec2(7.,8.);
  vec2 a=fieldUV(level,q.xy,cells),b=fieldUV(min(level+1.,27.),q.xy,cells);
  vec3 moment=mix(textureLod(lightField,a,0.).rgb,textureLod(lightField,b,0.).rgb,fract(height))*2.-1.;
  vec2 light=mix(textureLod(lightField,a+vec2(0.,.5),0.).rg,textureLod(lightField,b+vec2(0.,.5),0.).rg,fract(height));
  float energy=3.*light.x*light.x;
  vec3 color=mix(vec3(.95,.985,1.),vec3(1.,.81,.57),light.y);
  float diffuse=energy*(.12+.88*max(dot(N,moment),0.));
  float spec=pow(max(dot(N,normalize(moment+V+.0001)),0.),mix(22.,72.,gloss));
  vec3 lit=c*(.86+color*.46*diffuse)+color*(.041*diffuse+gloss*.21*spec*energy);
  return mix(c,lit,mask);
}`;
function cameraUniforms(gl,u,camera,room,w,h){
  const rad=Math.PI/180,a=camera.yaw*rad,b=camera.pitch*rad;
  const c=Math.cos(a),s=Math.sin(a),cp=Math.cos(b),sp=Math.sin(b);
  gl.uniform3f(u.eye,camera.x,camera.y,1.58);
  gl.uniform3f(u.right,c,-s,0);gl.uniform3f(u.up,-s*sp,-c*sp,cp);gl.uniform3f(u.forward,s*cp,c*cp,sp);
  const fy=1/Math.tan(63*rad/2);gl.uniform2f(u.focal,fy*h/w,fy);gl.uniform2f(u.room,room.W,room.D);
}
// Depth-tested lens bloom. Each emitter uses its actual position and radius in metres.
class CeilingGlow {
  constructor(gl){
    this.gl=gl;
    const vertex=`#version 300 es
      layout(location=0) in vec4 emitter;
      layout(location=1) in float globe;
      out vec2 uv;out vec3 tint;out float strength;
      ${projection}
      void main(){
        vec2 corner=vec2((gl_VertexID==1||gl_VertexID==3)?1.:-1.,gl_VertexID>=2?1.:-1.);
        vec3 toward=normalize(eye-emitter.xyz);
        float size=emitter.w*mix(4.5,2.85,globe);
        float facing=smoothstep(.08,.7,-toward.z);
        strength=mix(.32*facing,.39,globe);
        tint=mix(vec3(.88,.96,1.),vec3(1.,.80,.50),globe);
        uv=corner;
        gl_Position=project(emitter.xyz+toward*emitter.w*1.01+size*(right*corner.x+up*corner.y));
      }`;
    const fragment=`#version 300 es
      precision mediump float;in vec2 uv;in vec3 tint;in float strength;out vec4 pixel;
      void main(){float r2=dot(uv,uv);pixel=vec4(tint,strength*exp(-4.6*r2)*(1.-smoothstep(.54,1.,r2)));}`;
    this.program=createProgram(gl,vertex,fragment);
    this.u=uniforms(gl,this.program,'eye right up forward focal room');
  }
  prepare(lights){
    const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const data=lights.flatMap(([x,y,z,r])=>[x,y,z,r,r>.08?1:0]);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
    for(const [i,width,offset] of [[0,4,0],[1,1,16]]){
      gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,width,gl.FLOAT,false,20,offset);gl.vertexAttribDivisor(i,1);
    }
    return {vao,buffer,count:lights.length};
  }
  draw(s,glow,cam,w,h){
    const gl=this.gl;gl.useProgram(this.program);gl.bindVertexArray(glow.vao);
    cameraUniforms(gl,this.u,cam,s,w,h);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,glow.count);
  }
}
class StoreRenderer {
  constructor(canvas) {
    const gl=this.gl=canvas.getContext('webgl2',{alpha:false,antialias:true,powerPreference:'high-performance'});
    if(!gl)throw Error('WebGL 2를 지원하는 Chrome 또는 Safari에서 열어주세요.');
    const vertex=`#version 300 es
    layout(location=0) in vec3 pos;layout(location=1) in vec3 normal;layout(location=2) in vec2 uv;layout(location=3) in float ambient;
    uniform vec3 extent,origin;
    out vec3 wp,n;out vec2 st;out float ao;
    ${projection}
    void main(){wp=pos*extent+origin;n=normal;st=uv;ao=ambient;gl_Position=project(wp);}`;
    const fragment=`#version 300 es
    precision highp float;in vec3 wp,n;in vec2 st;in float ao;out vec4 pixel;
    uniform vec3 base;uniform vec4 rect;uniform int mode,finish;uniform float emission;
    uniform sampler2D atlas,floorTex,ceilTex,lightmap,atelier;
    ${reflection}
    ${ceilingIllumination}
    void main(){
      vec3 N=normalize(n),V=normalize(eye-wp);float alpha=1.;
      vec3 c=base*(.77+.13*N.z+.045*N.y-.03*N.x)*(.64+.39*sqrt(ao))*vec3(1.04,1.01,.97);
      vec2 plan=wp.xy/room;
      if(mode==1 || mode==23){
        vec2 printUV=rect.xy+vec2(st.x,1.-st.y)*rect.zw;
        vec3 ink=mode==23?texture(atelier,printUV).rgb:texture(atlas,printUV).rgb;
        c=ink*(.90+.105*ao)*vec3(1.014,1.004,.985);
        c=mix(c,reflected(wp,N,.36),.025*fresnel(V,N,.28));
      }else if(mode==2){
        c=texture(floorTex,vec2(plan.x,1.-plan.y)).rgb;
        vec3 r=reflected(wp,N,.31);
        c=mix(c,r,.22*fresnel(V,N,.055));
        // Porcelain under the beauty fixtures retains the baked shadows at the base of each shelf.
        if(finish==5){
          vec2 uv=vec2(plan.x,1.-plan.y);
          float illumination=dot(textureLod(floorTex,uv,2.6).rgb,vec3(.24,.67,.09));
          vec2 tile=wp.xy/vec2(.66,1.08);
          tile.y+=.5*mod(floor(tile.x),2.);
          vec2 line=min(fract(tile),1.-fract(tile));
          vec2 aa=max(fwidth(tile),vec2(.0004));
          vec2 seal=smoothstep(vec2(.001),vec2(.002)+aa,line);
          float grain=noise2(wp.xy*160.)*.012+.014*sin(dot(floor(tile),vec2(7.67,13.2)));
          c=vec3(.76,.77,.76)*(.55+.61*illumination+grain-.073*(1.-min(seal.x,seal.y)));
          c=mix(c,r,.13*fresnel(V,N,.085));
        }
      }else if(mode==3){
        c=texture(ceilTex,plan).rgb;
      }else if(mode==4){
        // Cycles-baked diffuse irradiance and albedo. Cap the mip level at the UV gutter.
        vec2 uv=vec2(st.x,1.-st.y);
        vec2 texels=vec2(textureSize(lightmap,0));
        float lod=clamp(log2(max(length(dFdx(uv)*texels),length(dFdy(uv)*texels))),0.,1.65);
        vec3 b=textureLod(lightmap,uv,lod).rgb;
        c=mix(b,base*.78,.115);
        if(finish==1){
          vec2 grain=vec2((wp.x+wp.y)*22.+wp.z*.86,wp.z*390.+(wp.x-wp.y)*48.);
          c*=1.+.023*(noise2(grain)-.3);
        }
        float rough=finish==2?.25:finish==3?.28:.51;
        vec3 r=reflected(wp,N,rough);
        if(finish==2)c=mix(base*.58,r*mix(vec3(1),base,.45),.61+.26*fresnel(V,N,.25));
        else c=mix(c,r,(finish==3?.28:.15)*fresnel(V,N,.06));
      }else if(mode==5){
        vec2 q=st*2.-1.;float margin=1.-abs(q.x)*abs(q.x)*.95;
        if(abs(q.y)>margin)discard;
        float vein=exp(-abs(q.y)*23.)+.40*exp(-12.*abs(sin(15.*(abs(q.y)*.55-q.x))))*(1.-abs(q.y));
        float hue=fract(sin(dot(floor(wp.xy*9.),vec2(17.1,92.4)))*758.4);
        c=mix(vec3(.125,.235,.091),vec3(.34,.49,.18),.44*ao+.30*hue+.15*N.z)+vec3(.044,.052,.014)*vein;
      }else if(mode==6){
        vec2 uv=abs(N.z)>.5?wp.xy:vec2(wp.x+wp.y,wp.z);
        vec2 tile=abs(fract(uv/vec2(1.20,.62))-.5);
        float grout=smoothstep(.492,.5,max(tile.x,tile.y));
        c=base*(.97+.025*sin(uv.x*13.+sin(uv.y*13.))+.018*noise2(uv*24.)-.10*grout);
      }else if(mode==7){c=mix(base*.64,reflected(wp,N,.24)*vec3(.99,.93,.78),.53);}
      else if(mode==10||mode==14){
        // Brushed stainless and polished soffits pick up the colours of the surrounding aisles.
        float polish=mode==14?.09:.34;
        vec3 env=reflected(wp,N,polish);
        float luminance=dot(env,vec3(.24,.67,.09));
        vec2 grain=abs(N.z)>.6?wp.xy:vec2(wp.x+wp.y,wp.z);
        float brushed=noise2(grain*vec2(4.,670.))*.023;
        vec3 silver=mode==14?vec3(.67,.70,.69):vec3(.69,.705,.70);
        vec3 sky=mix(vec3(luminance),env,.31);
        c=mix(silver,sky,(mode==14?.72:.31)+.13*fresnel(V,N,.14))*(.75+.23*sqrt(ao)+.07*N.z)+brushed;
      }else if(mode==11){
        c=vec3(.95,.965,.951)*(.78+.20*sqrt(ao)+.035*N.z)+.015*reflected(wp,N,.44);
      }else if(mode==12){
        c=vec3(.096,.117,.112)*(.80+.26*ao+.12*N.z)+.16*reflected(wp,N,.46);
      }else if(mode==13){c=vec3(.977,1.,.991);}
      else if(mode==15){c=vec3(.066,.79,.28)*(.82+.17*ao);}
      else if(mode==17){c=vec3(1.,.94,.79);}
      else if(mode==18){
        c=mix(vec3(.51,.32,.18)*(.72+.24*ao),reflected(wp,N,.30)*vec3(1.,.81,.61),.26);
      }else if(mode==24 || mode==25 || mode==26){
        float diffuse=.78+.14*max(N.z,0.)+.105*max(dot(N,normalize(vec3(-.4,.26,.83))),0.);
        float roughness=mode==25?.62:mode==26?.24:.19;
        vec3 env=reflected(wp,N,roughness);
        float reflectivity=mode==25?.034:mode==26?.35:.14;
        c=mix(base*diffuse,env*(mode==26?mix(vec3(1),base,.55):vec3(1)),reflectivity+.12*fresnel(V,N,.04));
        if(mode==24)c+=vec3(.062)*pow(max(dot(N,normalize(V+vec3(-.4,.33,.84))),0.),38.);
      }else if(mode==19){
        float rim=pow(1.-abs(dot(V,N)),2.);
        c=mix(vec3(1.,.974,.866),vec3(.96,.827,.635),.57*rim+.12*(1.+N.z));
      }else if(mode==8||emission>2.){c=vec3(1.,.965,.854);}
      else if(mode==9){c=mix(vec3(.78,.86,.84),reflected(wp,N,.055),.79);alpha=.11+.44*fresnel(V,N,.04);}
      if(finish==4){
        vec3 irradiance=texture(lightmap,vec2(st.x,1.-st.y)).rgb;
        float light=dot(irradiance,vec3(.22,.70,.08))/max(.24,dot(base,vec3(.22,.70,.08)));
        c*=clamp(.43+.56*light,.51,1.03);
      }
      if(mode!=19 && mode!=13 && mode!=17 && mode!=8 && mode!=9 && emission<2.){
        float gloss=(mode==14?.8:mode==10?.52:mode==2?.24:.12);
        if(mode==1||mode==23)c=mix(c,ceilingLight(c,wp,N,V,.09),.18);
        else c=ceilingLight(c,wp,N,V,gloss);
      }
      pixel=vec4(c,alpha);
    }`;
    this.program=createProgram(gl,vertex,fragment);
    this.u=uniforms(gl,this.program,'extent origin eye right up forward focal room base rect mode finish emission atlas floorTex ceilTex lightmap environment lightField atelier');
    gl.useProgram(this.program);
    ['atlas','floorTex','ceilTex','lightmap','environment'].forEach((key,i)=>gl.uniform1i(this.u[key],i));
    gl.uniform1i(this.u.lightField,6);gl.uniform1i(this.u.atelier,7);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(.85,.85,.80,1);
    this.aniso=gl.getExtension('EXT_texture_filter_anisotropic');
    this.merch=new ShelfProducts(gl);
    this.glow=new CeilingGlow(gl);
  }
  async prepare(s){
    const gl=this.gl,packed=Uint8Array.from(atob(s.geo),c=>c.charCodeAt(0));
    const binary=new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const imgs=await Promise.all(s.images.map(url=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('매장 재질을 불러오지 못했습니다. 새로고침해 주세요.'));img.src=url;
    })));
    const bytes=await binary,vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);
    for(const [idx,count,type,offset] of [[0,3,gl.UNSIGNED_SHORT,0],[1,3,gl.BYTE,6],[2,2,gl.UNSIGNED_SHORT,10],[3,1,gl.UNSIGNED_BYTE,9]]){
      gl.enableVertexAttribArray(idx);gl.vertexAttribPointer(idx,count,type,true,14,offset);
    }
    const textures=imgs.map((img,i)=>{
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,i===4?gl.REPEAT:gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      if(this.aniso)gl.texParameterf(gl.TEXTURE_2D,this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return tex;
    });
    let start=0;
    for(const g of s.groups){g.start=start;start+=g.n;g.rgb=g.c.map(c=>Math.max(0,Math.min(1,1.055*Math.pow(c,1/2.4)-.055)));g.finishId=['matte','wood','metal','satin','baked','porcelain'].indexOf(g.finish);}
    return {vao,vbo,textures,merch:this.merch.prepare(s),glow:this.glow.prepare(s.ceilingLights)};
  }
  draw(s,gpu,cam){
    const gl=this.gl,cv=gl.canvas,scale=Math.min(devicePixelRatio||1,1.7,2100/Math.max(cv.clientWidth,cv.clientHeight,1));
    const w=Math.max(1,Math.round(cv.clientWidth*scale)),h=Math.max(1,Math.round(cv.clientHeight*scale));
    if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
    gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gpu.textures.forEach((tex,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex);});
    const u=this.u;
    const architecture=glass=>{
      gl.useProgram(this.program);gl.bindVertexArray(gpu.vao);
      cameraUniforms(gl,u,cam,s,w,h);gl.uniform3fv(u.origin,s.origin);gl.uniform3fv(u.extent,s.extent);
      for(const g of s.groups){
        if((g.m===9)!==glass)continue;
        gl.uniform3fv(u.base,g.rgb);gl.uniform4fv(u.rect,g.rect||[0,0,1,1]);gl.uniform1i(u.mode,g.m);gl.uniform1i(u.finish,g.finishId);gl.uniform1f(u.emission,g.e);
        gl.drawArrays(gl.TRIANGLES,g.start,g.n);
      }
    };
    architecture(false);
    this.merch.draw(s,gpu.merch,cam,w,h);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
    architecture(true);this.glow.draw(s,gpu.glow,cam,w,h);gl.depthMask(true);gl.disable(gl.BLEND);
  }
}
