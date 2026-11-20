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
// Window and ceiling reflections on polished dielectric surfaces.
vec3 glassSpec(vec3 p,vec3 N,vec3 V){
  vec3 ray=reflect(-V,N);
  float ribbons=0.;
  for(int i=0;i<2;i++){
    vec3 toPanel=normalize(vec3(i==0?-.80:.62,i==0?-.48:.75,.39));
    vec3 across=normalize(cross(toPanel,vec3(0.,0.,1.)));
    float width=dot(ray,across),height=dot(ray,cross(across,toPanel));
    ribbons+=max(dot(ray,toPanel),0.)*exp(-width*width*850.-height*height*6.);
  }
  return reflected(p,N,.075)*(.19+.65*fresnel(V,N,.04))+vec3(.92,.89,.80)*ribbons*.66;
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
uniform sampler2D lightField,displayField;
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
}
vec2 displayUV(float slice,vec2 xy,vec2 cells){
  return (vec2(mod(slice,6.),floor(slice/6.))+(xy*(cells-1.)+.5)/cells)/vec2(6.,8.);
}
vec3 displayLight(vec3 c,vec3 p,vec3 N,vec3 V,float gloss){
  vec3 q=p+N*.014;
  vec2 xy=clamp(q.xy/room,0.,1.);
  float z=47.*clamp(q.z/3.10,0.,1.),k=floor(z);
  vec2 cells=vec2(textureSize(displayField,0))/vec2(6.,8.);
  vec3 field=mix(textureLod(displayField,displayUV(k,xy,cells),0.).rgb,
                 textureLod(displayField,displayUV(min(k+1.,47.),xy,cells),0.).rgb,fract(z));
  vec2 horizontal=field.gb*2.-1.;
  vec3 L=normalize(vec3(horizontal,sqrt(max(.035,1.-dot(horizontal,horizontal)))));
  vec3 tint=mix(vec3(.98,.99,1.),vec3(1.,.936,.836),smoothstep(.46,.77,xy.x));
  float illuminance=2.*field.r;
  float diffuse=.14+.86*max(dot(N,L),0.);
  float specular=pow(max(dot(N,normalize(V+L+.0001)),0.),32.)*gloss;
  // Keep white cartons and printed lettering detailed as the bounce lifts the midtones.
  vec3 headroom=max(vec3(0.),1.-clamp(c,0.,1.));
  vec3 fill=(.057+.026*max(N.z,0.))*vec3(1.,.979,.942);
  return c+headroom*((.09+c)*fill+tint*illuminance*((.105+.78*c)*diffuse+.085*specular));
}`;
function cameraUniforms(gl,u,camera,room,w,h){
  const rad=Math.PI/180,a=camera.yaw*rad,b=camera.pitch*rad;
  const c=Math.cos(a),s=Math.sin(a),cp=Math.cos(b),sp=Math.sin(b);
  gl.uniform3f(u.eye,camera.x,camera.y,1.58);
  gl.uniform3f(u.right,c,-s,0);gl.uniform3f(u.up,-s*sp,-c*sp,cp);gl.uniform3f(u.forward,s*cp,c*cp,sp);
  const fy=(camera.zoom||1)/Math.tan(63*rad/2);gl.uniform2f(u.focal,fy*h/w,fy);gl.uniform2f(u.room,room.W,room.D);
}
// Lens response for the visible ceiling emitters. The visibility tiles are baked
// at the tour's eye height and use the same order as scene.ceilingLights.
class CeilingGlow {
  constructor(gl){
    this.gl=gl;
    const vertex=`#version 300 es
      layout(location=0) in vec4 emitter;
      uniform sampler2D lampVisibility;
      uniform ivec2 tileLayout;uniform vec2 room;
      uniform highp int lensPass;
      out vec2 uv;out vec3 tint;out float strength,defocus,globe;
      ${projection}
      void main(){
        vec2 tiles=vec2(tileLayout),cells=vec2(textureSize(lampVisibility,0))/tiles;
        vec2 tile=vec2(gl_InstanceID%tileLayout.x,gl_InstanceID/tileLayout.x);
        vec2 sampleUV=(tile+(clamp(eye.xy/room,0.,1.)*(cells-1.)+.5)/cells)/tiles;
        float visible=textureLod(lampVisibility,sampleUV,0.).r;
        vec3 toward=normalize(eye-emitter.xyz);
        globe=step(.08,emitter.w);
        vec4 center=project(emitter.xyz+toward*emitter.w*1.01);
        vec2 ndc=center.xy/max(.01,center.w);
        float edge=max(abs(ndc.x),abs(ndc.y));
        if(center.w<.12||visible<.003||edge>(lensPass==0?1.3:1.0)){
          gl_Position=vec4(2.,2.,2.,1.);return;
        }
        uv=vec2((gl_VertexID==1||gl_VertexID==3)?1.:-1.,gl_VertexID>=2?1.:-1.);
        float angle=clamp(dot(forward,-toward),0.,1.);
        float facing=mix(smoothstep(.035,.45,-toward.z),1.,globe);
        strength=visible*facing*(.44+.56*angle);
        defocus=smoothstep(3.6,12.,center.w);
        tint=mix(emitter.w<.04?vec3(1.,.87,.69):vec3(.88,.95,1.),vec3(1.,.83,.60),globe);
        if(lensPass==0){
          float radius=emitter.w*mix(6.5,3.35,globe)+center.w*.012*defocus;
          gl_Position=center+vec4(uv*focal*radius,0.,0.);
        }else{
          // A faint internal reflection falls across the optical axis from the source.
          strength*=smoothstep(.72,.99,angle)*(1.-smoothstep(.76,1.,edge))*mix(.33,1.,globe);
          float radius=.016+.026*globe+.010*defocus;
          gl_Position=vec4(-.34*ndc+uv*focal*radius,0.,1.);
        }
      }`;
    const fragment=`#version 300 es
      precision highp float;
      in vec2 uv;in vec3 tint;in float strength,defocus,globe;
      uniform highp int lensPass;out vec4 pixel;
      float aperture(vec2 p){
        vec2 q=abs(p);
        return mix(length(p),max(q.y,.866025*q.x+.5*q.y),.62);
      }
      float ray(vec2 axis){
        float along=abs(dot(uv,axis));
        float across=abs(dot(uv,vec2(-axis.y,axis.x)));
        return exp(-across/(.009+.015*along)-3.1*along);
      }
      void main(){
        float r=length(uv),a=aperture(uv);
        if(lensPass!=0){
          float disc=1.-smoothstep(.67,.95,a);
          float rim=exp(-38.*abs(a-.75));
          pixel=vec4(mix(tint,vec3(.78,.89,.92),.40),strength*(.052*disc+.042*rim));
          return;
        }
        float halo=.40*exp(-6.4*r*r);
        float flare=(ray(vec2(.99255,.12187))+.52*ray(vec2(.39073,.92050))
                    +.44*ray(vec2(-.60182,.79864)))*mix(.31,.14,globe);
        float blade=.28+.22*defocus;
        float bokeh=defocus*(.19*(1.-smoothstep(blade-.13,blade+.05,a))+
                             .095*exp(-25.*abs(a-blade)));
        pixel=vec4(tint,strength*(halo+flare+bokeh)*(1.-smoothstep(.76,1.,r)));
      }`;
    this.program=createProgram(gl,vertex,fragment);
    this.u=uniforms(gl,this.program,'eye right up forward focal room lampVisibility tileLayout lensPass');
    gl.useProgram(this.program);gl.uniform1i(this.u.lampVisibility,10);
  }
  prepare(lights){
    const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const data=lights.flatMap(light=>light.slice(0,4));
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,16,0);gl.vertexAttribDivisor(0,1);
    const columns=Math.ceil(Math.sqrt(lights.length));
    return {vao,buffer,count:lights.length,columns,rows:Math.ceil(lights.length/columns)};
  }
  draw(s,glow,cam,w,h){
    const gl=this.gl;gl.useProgram(this.program);gl.bindVertexArray(glow.vao);
    cameraUniforms(gl,this.u,cam,s,w,h);
    gl.uniform2i(this.u.tileLayout,glow.columns,glow.rows);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    gl.uniform1i(this.u.lensPass,0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,glow.count);
    gl.disable(gl.DEPTH_TEST);gl.uniform1i(this.u.lensPass,1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,glow.count);
    gl.enable(gl.DEPTH_TEST);
  }
}
// Partition large material batches into consecutive triangle ranges. A range outside
// any camera plane can be skipped without changing the order of the visible triangles.
function meshRanges(bytes,groups,origin,extent){
  const data=new Uint16Array(bytes),stride=7,passes=[[],[],[]];
  let first=0;
  for(const group of groups){
    const ranges=[];
    for(let start=first;start<first+group.n;start+=3072){
      const count=Math.min(3072,first+group.n-start),lo=[65535,65535,65535],hi=[0,0,0];
      for(let end=(start+count)*stride,i=start*stride;i<end;i+=stride){
        for(let k=0;k<3;k++){const q=data[i+k];if(q<lo[k])lo[k]=q;if(q>hi[k])hi[k]=q;}
      }
      const half=hi.map((v,k)=>(v-lo[k])*extent[k]/131070);
      const center=lo.map((v,k)=>origin[k]+v*extent[k]/65535+half[k]);
      ranges.push({start,count,center,half});
    }
    const pass=group.m===9?2:group.m===36?1:0;
    passes[pass].push({group,ranges});first+=group.n;
  }
  return passes;
}
function cameraPlanes(cam,w,h){
  const yaw=cam.yaw*Math.PI/180,pitch=cam.pitch*Math.PI/180;
  const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  const f=[sy*cp,cy*cp,sp],right=[cy,-sy,0],up=[-sy*sp,-cy*sp,cp];
  const ty=Math.tan(63*Math.PI/360)/(cam.zoom||1),tx=ty*w/h;
  return [f,...[[right,tx,1],[right,tx,-1],[up,ty,1],[up,ty,-1]].map(([axis,t,sign])=>
    f.map((v,k)=>t*v+axis[k]*sign))].map(([x,y,z])=>
      [x,y,z,Math.abs(x),Math.abs(y),Math.abs(z),-x*cam.x-y*cam.y-z*1.58]);
}
function visibleBox(planes,x,y,z,hx,hy,hz){
  for(const p of planes){
    if(p[0]*x+p[1]*y+p[2]*z+p[6]+p[3]*hx+p[4]*hy+p[5]*hz<-.005)return false;
  }
  return true;
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
    uniform sampler2D atlas,floorTex,ceilTex,lightmap,atelier,consultation,backdrop;
    uniform highp vec3 right,up;
    uniform vec4 contacts[12];
    ${reflection}
    ${ceilingIllumination}
    void main(){
      vec3 N=normalize(n),V=normalize(eye-wp);float alpha=1.;
      vec3 c=base*(.77+.13*N.z+.045*N.y-.03*N.x)*(.64+.39*sqrt(ao))*vec3(1.04,1.01,.97);
      vec2 plan=wp.xy/room;
      if(mode==1 || mode==23 || mode==34){
        vec2 printUV=rect.xy+vec2(st.x,1.-st.y)*rect.zw;
        vec3 ink=mode==34?texture(consultation,printUV).rgb:
                 mode==23?texture(atelier,printUV).rgb:texture(atlas,printUV).rgb;
        c=ink*(.90+.105*ao)*vec3(1.014,1.004,.985);
        c=mix(c,reflected(wp,N,.36),.025*fresnel(V,N,.28));
        if(finish==6)c=c*.97+.19*glassSpec(wp,N,V);
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
        }else if(room.x>10. && wp.x>9.7 && wp.x<12.2 && wp.y>6.8 && wp.y<18.9){
          // A narrow contact shadow joins each pedestal and recessed plinth to the baked floor.
          float shade=0.;
          for(int i=0;i<12;i++){
            vec4 foot=contacts[i];vec2 delta=wp.xy-foot.xy;
            float gap=i<3?length(max(abs(delta)-foot.zw,vec2(0.))):max(0.,length(delta)-foot.z);
            shade=max(shade,.24*exp(-gap/.029));
          }
          c*=1.-shade;
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
      else if(mode==15){c=vec3(.749,.302,.439)*(.82+.17*ao);}
      else if(mode==17){c=vec3(1.,.94,.79);}
      else if(mode==18){
        c=mix(vec3(.51,.32,.18)*(.72+.24*ao),reflected(wp,N,.30)*vec3(1.,.81,.61),.26);
      }else if(mode==36){
        // Refract the opaque shelf, labels, wax and reeds already drawn behind the vessel.
        if(dot(N,V)<=0.)discard;
        vec2 screen=vec2(textureSize(backdrop,0));
        float angle=abs(dot(N,V));
        vec2 bend=vec2(dot(N,right),dot(N,up));
        float thickness=.012/max(.30,distance(wp,eye));
        vec2 uv=gl_FragCoord.xy/screen-bend*thickness*vec2(screen.y/screen.x,1.);
        vec3 through=texture(backdrop,clamp(uv,.001,.999)).rgb;
        vec3 absorption=mix(base*.45,base+.12,.32+.68*angle);
        c=through*absorption*(.59+.18*angle)+base*.21+glassSpec(wp,N,V);
      }else if(mode==24 || mode==25 || mode==26){
        float diffuse=.78+.14*max(N.z,0.)+.105*max(dot(N,normalize(vec3(-.4,.26,.83))),0.);
        float roughness=mode==25?.62:mode==26?.24:.19;
        vec3 env=reflected(wp,N,roughness);
        float reflectivity=mode==25?.034:mode==26?.35:.14;
        c=mix(base*diffuse,env*(mode==26?mix(vec3(1),base,.55):vec3(1)),reflectivity+.12*fresnel(V,N,.04));
        if(mode==24)c+=vec3(.062)*pow(max(dot(N,normalize(V+vec3(-.4,.33,.84))),0.),38.);
      }else if(mode==27){
        // Veins follow the folded blade from petiole to tip. Fade fine detail at distance.
        vec2 leaf=vec2(st.x,st.y*2.-1.);
        float aa=max(fwidth(leaf.y),.009);
        float thin=(1.-smoothstep(.02,.07,aa));
        float midrib=1.-smoothstep(.014,.020+aa,abs(leaf.y));
        float veins=abs(fract(leaf.x*7.4-abs(leaf.y)*1.14)-.5);
        float ribs=(1.-smoothstep(.015,.078+fwidth(veins),veins))*(1.-abs(leaf.y))*thin;
        vec3 blade=mix(vec3(.094,.213,.115),vec3(.32,.45,.206),ao);
        float facing=gl_FrontFacing?1.:.84;
        c=blade*(.66+.32*abs(N.z)+.16*max(dot(N,normalize(vec3(-.4,.4,.82))),0.))*facing;
        c+=vec3(.084,.094,.039)*(midrib*.80+ribs*.42);
        c+=vec3(.060,.066,.046)*pow(max(dot(faceforward(N,-V,N),normalize(V+vec3(-.38,.28,.88))),0.),22.);
      }else if(mode==28){
        float flute=cos(st.x*6.283185*48.);
        float fade=1.-smoothstep(.004,.02,fwidth(st.x));
        c=base*(.72+.22*ao+.09*N.z+.038*flute*fade+.015*noise2(wp.xy*510.));
        c=mix(c,reflected(wp,N,.31),.13*fresnel(V,N,.11));
      }else if(mode==29||mode==31||mode==30){
        float speck=noise2(wp.xy*450.+wp.z*190.);
        c=base*(.68+.15*N.z+.12*speck+.14*ao);
      }else if(mode==35){
        float nap=noise2(wp.xy*470.+wp.z*318.);
        float diffuse=.68+.18*max(N.z,0.)+.10*max(dot(N,normalize(vec3(-.42,.28,.86))),0.);
        c=base*(diffuse+.027*nap)+vec3(.028,.021,.017)*pow(1.-abs(dot(N,V)),3.);
      }else if(mode==32){
        vec2 grain=vec2((wp.x+wp.y)*47.,wp.z*2.1);
        c=base*(.67+.14*N.z+.075*noise2(grain));
      }else if(mode==37){
        // The opal shell scatters the lamp across its face, with a warmer rim.
        float core=smoothstep(0.,.92,abs(dot(N,V)));
        c=mix(vec3(.94,.832,.65),vec3(1.,.976,.876),core);
      }else if(mode==19){
        float rim=pow(1.-abs(dot(V,N)),2.);
        c=mix(vec3(1.,.974,.866),vec3(.96,.827,.635),.57*rim+.12*(1.+N.z))+.11*glassSpec(wp,N,V);
        c*=pow(emission,1./2.2);
      }else if(mode==8||emission>2.){c=vec3(1.,.965,.854);}
      else if(mode==9){
        c=mix(vec3(.72,.82,.80),reflected(wp,N,.06),.83)+.32*glassSpec(wp,N,V);
        alpha=.12+.54*fresnel(V,N,.04);
      }
      if(finish==4 && mode!=37){
        vec3 irradiance=texture(lightmap,vec2(st.x,1.-st.y)).rgb;
        float light=dot(irradiance,vec3(.22,.70,.08))/max(.24,dot(base,vec3(.22,.70,.08)));
        c*=clamp(.43+.56*light,.51,1.03);
      }
      if(mode!=37 && mode!=19 && mode!=13 && mode!=17 && mode!=8 && mode!=9 && emission<2.){
        float gloss=(mode==36?.89:mode==14?.8:mode==10?.52:mode==2?.24:.12);
        if(mode==1||mode==23||mode==34){
          vec3 lit=ceilingLight(c,wp,N,V,.09);
          c=mix(c,displayLight(lit,wp,N,V,.09),.22);
        }else c=displayLight(ceilingLight(c,wp,N,V,gloss),wp,N,V,gloss);
      }
      pixel=vec4(c,alpha);
    }`;
    this.program=createProgram(gl,vertex,fragment);
    this.u=uniforms(gl,this.program,'extent origin eye right up forward focal room base rect mode finish emission atlas floorTex ceilTex lightmap environment lightField displayField atelier consultation');
    this.u.backdrop=gl.getUniformLocation(this.program,'backdrop');
    this.u.contacts=gl.getUniformLocation(this.program,'contacts[0]');
    gl.useProgram(this.program);
    ['atlas','floorTex','ceilTex','lightmap','environment'].forEach((key,i)=>gl.uniform1i(this.u[key],i));
    gl.uniform1i(this.u.backdrop,11);
    this.backdrop=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.backdrop);
    for(const option of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,option,gl.LINEAR);
    for(const option of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,option,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB8,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,null);
    gl.uniform1i(this.u.lightField,6);gl.uniform1i(this.u.atelier,7);gl.uniform1i(this.u.consultation,8);gl.uniform1i(this.u.displayField,9);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(.85,.85,.80,1);
    this.aniso=gl.getExtension('EXT_texture_filter_anisotropic');
    this.walkScale=1;this.slowTime=0;this.fastTime=0;
    this.touchDisplay=matchMedia('(pointer: coarse)');
    this.merch=new ShelfProducts(gl);
    this.glow=new CeilingGlow(gl);
    this.shoppers=new ShopperLayer(gl);
    this.showShoppers=true;
  }
  async prepare(s){
    const gl=this.gl,packed=Uint8Array.from(atob(s.geo),c=>c.charCodeAt(0));
    const binary=new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const urls=s.images.map((url,i)=>this.touchDisplay.matches?(s.mobileImages?.[i]||url):url);
    const shopReady=this.shoppers.load();
    const imagesReady=Promise.all(urls.map(url=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('매장 재질을 불러오지 못했습니다. 새로고침해 주세요.'));img.src=url;
    })));
    const [imgs,bytes]=await Promise.all([imagesReady,binary,shopReady]);
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);
    for(const [idx,count,type,offset] of [[0,3,gl.UNSIGNED_SHORT,0],[1,3,gl.BYTE,6],[2,2,gl.UNSIGNED_SHORT,10],[3,1,gl.UNSIGNED_BYTE,9]]){
      gl.enableVertexAttribArray(idx);gl.vertexAttribPointer(idx,count,type,true,14,offset);
    }
    const textures=imgs.map((img,i)=>{
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      const mipmapped=i!==6&&i!==9&&i!==10;
      if(mipmapped)gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mipmapped?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,i===4?gl.REPEAT:gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      if(this.aniso&&mipmapped)gl.texParameterf(gl.TEXTURE_2D,this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(this.touchDisplay.matches?2:8,gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return tex;
    });
    const finishes=['matte','wood','metal','satin','baked','porcelain','screen'];
    for(const g of s.groups){
      g.rgb=g.c.map(c=>Math.max(0,Math.min(1,1.055*Math.pow(c,1/2.4)-.055)));
      g.finishId=finishes.indexOf(g.finish);g.rect??=[0,0,1,1];
    }
    const contacts=new Float32Array((s.floorContacts||[]).flat());
    return {vao,vbo,textures,contacts,passes:meshRanges(bytes,s.groups,s.origin,s.extent),merch:this.merch.prepare(s),glow:this.glow.prepare(s.ceilingLights)};
  }
  release(gpu){
    const gl=this.gl;
    for(const texture of gpu.textures)gl.deleteTexture(texture);
    gl.deleteBuffer(gpu.vbo);gl.deleteVertexArray(gpu.vao);
    gl.deleteBuffer(gpu.glow.buffer);gl.deleteVertexArray(gpu.glow.vao);
  }
  motionScale(dt){
    // Change resolution only after sustained load, with slower recovery to avoid churn.
    this.slowTime=dt>.034?this.slowTime+dt:Math.max(0,this.slowTime-dt);
    this.fastTime=dt>0&&dt<.020?this.fastTime+dt:0;
    if(this.slowTime>.9){this.walkScale=Math.max(.72,this.walkScale-.14);this.slowTime=0;}
    if(this.fastTime>4){this.walkScale=Math.min(1,this.walkScale+.14);this.fastTime=0;}
    return this.walkScale;
  }
  draw(s,gpu,cam,moving=false,dt=0,shopperTime=0){
    const gl=this.gl,cv=gl.canvas,touch=this.touchDisplay.matches;
    const scale=Math.min(devicePixelRatio||1,touch?(moving?this.motionScale(dt):1.15):1.7,(touch?1200:2100)/Math.max(cv.clientWidth,cv.clientHeight,1));
    const w=Math.max(1,Math.round(cv.clientWidth*scale)),h=Math.max(1,Math.round(cv.clientHeight*scale));
    if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
    gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gpu.textures.forEach((tex,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex);});
    const u=this.u;
    gl.activeTexture(gl.TEXTURE11);gl.bindTexture(gl.TEXTURE_2D,this.backdrop);
    const planes=cameraPlanes(cam,w,h);
    function visible(range){
      const c=range.center,b=range.half;
      return visibleBox(planes,c[0],c[1],c[2],b[0],b[1],b[2]);
    }
    const architecture=pass=>{
      gl.useProgram(this.program);gl.bindVertexArray(gpu.vao);
      cameraUniforms(gl,u,cam,s,w,h);gl.uniform3fv(u.origin,s.origin);gl.uniform3fv(u.extent,s.extent);
      if(gpu.contacts.length)gl.uniform4fv(u.contacts,gpu.contacts);
      for(const {group:g,ranges} of gpu.passes[pass]){
        let bound=false,first=0,count=0;
        for(const range of ranges){
          if(visible(range)){
            if(!bound){
              gl.uniform3fv(u.base,g.rgb);gl.uniform4fv(u.rect,g.rect);
              gl.uniform1i(u.mode,g.m);gl.uniform1i(u.finish,g.finishId);gl.uniform1f(u.emission,g.e);
              bound=true;
            }
            if(count===0)first=range.start;
            count+=range.count;
          }else if(count){gl.drawArrays(gl.TRIANGLES,first,count);count=0;}
        }
        if(count)gl.drawArrays(gl.TRIANGLES,first,count);
      }
    };
    architecture(0);
    this.merch.draw(s,gpu.merch,cam,w,h,planes,touch&&moving);
    if(this.showShoppers)this.shoppers.draw(s,cam,w,h,shopperTime);
    if(gpu.passes[1].some(batch=>batch.ranges.some(visible))){
      gl.activeTexture(gl.TEXTURE11);gl.bindTexture(gl.TEXTURE_2D,this.backdrop);
      if(this.backdropWidth!==w || this.backdropHeight!==h){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB8,w,h,0,gl.RGB,gl.UNSIGNED_BYTE,null);
        this.backdropWidth=w;this.backdropHeight=h;
      }
      gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,w,h);
      architecture(1);
    }
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
    architecture(2);this.glow.draw(s,gpu.glow,cam,w,h);gl.depthMask(true);gl.disable(gl.BLEND);
  }
}
