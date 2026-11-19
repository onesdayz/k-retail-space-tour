// Manufacturer packshots are mapped onto closed, profiled vessels. Instances share
// topology and material; the nearest shelf retains the detailed closure geometry.
class ShelfProducts {
  constructor(gl){
    this.gl=gl;this.meshes=new Map();
    const vertex=`#version 300 es
    layout(location=0)in vec3 pos;layout(location=1)in vec3 normal;
    layout(location=2)in vec4 surface;layout(location=3)in vec4 placement;
    layout(location=4)in vec4 scaleAngle;layout(location=5)in vec2 irradiance;
    ${projection}
    out vec3 wp,n;out vec4 local;out vec2 light;
    void main(){
      vec3 dims=vec3(placement.w,scaleAngle.xy);vec2 front=scaleAngle.zw,side=vec2(-front.y,front.x);
      vec2 xy=side*pos.x*dims.x+front*pos.y*dims.y;
      wp=placement.xyz+vec3(xy,pos.z*dims.z);
      vec3 corrected=normal/max(dims,vec3(.001));
      n=normalize(vec3(side*corrected.x+front*corrected.y,corrected.z));
      local=surface;light=irradiance;gl_Position=project(wp);
    }`;
    const fragment=`#version 300 es
    precision highp float;in vec3 wp,n;in vec4 local;in vec2 light;out vec4 pixel;
    uniform sampler2D packages;uniform vec4 rect;uniform int family;
    ${reflection}
    void main(){
      vec3 N=normalize(n),V=normalize(eye-wp);
      float u=clamp(local.x,.01,.99),z=clamp(local.y,.002,.998);
      // The back and sides use the edge stock colour. Only the documented front carries artwork.
      float front=smoothstep(-.12,.25,local.z);
      vec3 face=texture(packages,rect.xy+vec2(u,1.-z)*rect.zw).rgb;
      vec3 side=texture(packages,rect.xy+vec2(.974,1.-z)*rect.zw).rgb;
      vec3 c=mix(side,face,front);
      if(family==1 && local.z<.34){c=mix(vec3(.072,.095,.175),c,.19);}
      if(abs(N.z)>.89){c=mix(c,texture(packages,rect.xy+vec2(.76,1.-z)*rect.zw).rgb,.74);}
      float illuminance=mix(light.x,light.y,smoothstep(-.12,.91,N.z));
      float gain=clamp(.69+.34*sqrt(max(illuminance,.0)),.66,1.23);
      float contact=.87+.13*smoothstep(0.,.09,z);
      float warmth=clamp(.85-illuminance*.46,0.,.8);
      vec2 panel=vec2((floor(wp.x/(room.x/3.))+.45)*room.x/3.,(floor(wp.y/(room.y/4.))+.5)*room.y/4.);
      vec3 lamp=normalize(vec3(panel-wp.xy,3.04-wp.z));float shapeLight=.86+.20*smoothstep(-.54,.88,dot(N,lamp));
      c*=gain*shapeLight*contact*mix(vec3(1.015,1.01,.997),vec3(1.06,.995,.916),warmth);
      float rough=family==1?.59:family==2?.35:.23;
      float gloss=family==1?.18:family==2?.33:.64;
      float ridges=local.w;
      if(ridges>0. && fwidth(local.x)<.025){
        float rib=sin(u*212.)*.5+.5;c*=1.-.052*pow(rib,3.)*ridges;
      }
      vec3 refl=reflected(wp,N,rough);float F=fresnel(V,N,.045);
      vec3 halfDir=normalize(V+normalize(vec3(-.39,.28,.88)));
      float strip=pow(max(dot(N,halfDir),0.),mix(110.,22.,rough));
      c=mix(c,refl,gloss*(.065+.66*F))+vec3(1.,.95,.84)*strip*gloss*.19;
      pixel=vec4(c,1.);
    }`;
    this.program=createProgram(gl,vertex,fragment);
    this.u=uniforms(gl,this.program,'eye right up forward focal room packages environment rect family');
    gl.useProgram(this.program);gl.uniform1i(this.u.environment,4);gl.uniform1i(this.u.packages,5);
  }
  mesh(shape,profile,lod){
    const gl=this.gl,key=shape+lod;
    if(this.meshes.has(key))return this.meshes.get(key);
    let rings=profile;
    if(lod){const spacing=lod===1?.055:.115;
      rings=profile.filter(([z,r],i)=>i===0||i===profile.length-1||z-profile[i-1][0]>spacing||i%(lod===1?3:5)===0||Math.abs(r-profile[Math.max(0,i-1)][1])>.12);}
    const count=[36,20,10][lod],perimeter=[];
    if(shape==='box'){
      for(const [cx,cy,begin] of [[.965,.91,0],[.965,-.91,90],[-.965,-.91,180],[-.965,.91,270]]){
        for(let j=0;j<=3;j++){const t=(begin+j*30)*Math.PI/180;perimeter.push([cx+.035*Math.sin(t),cy+.09*Math.cos(t),Math.sin(t),Math.cos(t)]);}
      }
    }else{
      for(let j=0;j<count;j++){const t=j*2*Math.PI/count;perimeter.push([Math.sin(t),Math.cos(t),Math.sin(t),Math.cos(t)]);}
    }
    const xyDepth=(z,r)=>{
      if(shape==='tube'||shape==='pump')return r*(z<.18?1.38:Math.max(.095,1.24-1.13*Math.pow(z,1.5)));
      return r;
    };
    const data=[],indices=[],sides=perimeter.length,capRib=z=>(shape==='drop'&&z>.65&&z<.77)||(shape==='tube'&&z>.95)||(shape==='pump'&&z>.94)||(shape==='vial'&&z>.72);
    for(let i=0;i<rings.length;i++){
      const [z,r]=rings[i],prev=rings[Math.max(0,i-1)],next=rings[Math.min(rings.length-1,i+1)];
      const slopeX=(next[1]-prev[1])/Math.max(.001,next[0]-prev[0])*.5;
      const slopeY=(xyDepth(...next)-xyDepth(...prev))/Math.max(.001,next[0]-prev[0])*.5;
      perimeter.forEach(([x,y,nx,ny],j)=>{
        data.push(x*r*.5,y*xyDepth(z,r)*.5,z,nx,ny,-(nx*nx*slopeX+ny*ny*slopeY),.5+.5*x,z,ny,capRib(z)?1:0);
        if(i){const b=(i-1)*sides+j,e=(i-1)*sides+(j+1)%sides;indices.push(b,e,b+sides,b+sides,e,e+sides);}
      });
    }
    for(const idx of [0,rings.length-1]){
      const [z,r]=rings[idx],first=data.length/10,sign=idx===0?-1:1;
      data.push(0,0,z,0,0,sign,.5,z,1,0);
      for(const [x,y] of perimeter)data.push(x*r*.5,y*xyDepth(z,r)*.5,z,0,0,sign,.5+.16*x,z,1,0);
      for(let j=0;j<sides;j++)indices.push(first,first+1+j,first+1+(j+1)%sides);
    }
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
    for(const [i,n,offset] of [[0,3,0],[1,3,12],[2,4,24]]){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,40,offset);}
    const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    const instances=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,instances);
    for(const [i,n,offset] of [[3,4,0],[4,4,16],[5,2,32]]){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,40,offset);gl.vertexAttribDivisor(i,1);}
    const mesh={vao,instances,count:indices.length};this.meshes.set(key,mesh);return mesh;
  }
  prepare(s){
    const {skus,profiles}=s.catalog;
    const groups=skus.map(sku=>({sku,instances:[],meshes:[0,1,2].map(l=>this.mesh(sku.shape,profiles[sku.shape],l))}));
    for(const [id,x,y,z,w,d,h,a,front,top] of s.products)groups[id].instances.push([x,y,z,w,d,h,Math.sin(a),Math.cos(a),front,top]);
    for(const g of groups){g.layers=[0,1,2].map(()=>new Float32Array(g.instances.length*10));}
    return groups;
  }
  draw(s,groups,cam,w,h){
    const gl=this.gl,u=this.u;gl.useProgram(this.program);cameraUniforms(gl,u,cam,s,w,h);
    const a=cam.yaw*Math.PI/180,sn=Math.sin(a),cs=Math.cos(a),tanX=.614*w/h;
    for(const {sku,instances,layers,meshes} of groups){
      const counts=[0,0,0];
      for(const instance of instances){
        const dx=instance[0]-cam.x,dy=instance[1]-cam.y,front=dx*sn+dy*cs;
        if(Math.abs(cam.pitch)<48 && (front<-.24||Math.abs(dx*cs-dy*sn)>Math.max(0,front)*(tanX+.18)+.9))continue;
        const d=dx*dx+dy*dy+(instance[2]-1.58)**2;
        const lod=d<3.8?0:d<33?1:2;
        layers[lod].set(instance,counts[lod]++*10);
      }
      gl.uniform4fv(u.rect,sku.rect);gl.uniform1i(u.family,sku.shape==='box'?1:['tube','tin','pump'].includes(sku.shape)?2:0);
      for(let i=0;i<3;i++){
        if(!counts[i])continue;const m=meshes[i];gl.bindVertexArray(m.vao);gl.bindBuffer(gl.ARRAY_BUFFER,m.instances);
        gl.bufferData(gl.ARRAY_BUFFER,layers[i],gl.DYNAMIC_DRAW,0,counts[i]*10);
        gl.drawElementsInstanced(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0,counts[i]);
      }
    }
  }
}
