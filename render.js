// WebGL uses Blender's metric, Z-up coordinates throughout.
class StoreRenderer {
  constructor(canvas) {
    this.gl=canvas.getContext('webgl2',{alpha:false, antialias:true,powerPreference:'high-performance'});
    if(!this.gl) throw new Error('이 브라우저에서는 WebGL 2를 사용할 수 없습니다. Chrome 또는 Safari에서 열어주세요.');
    const gl=this.gl;
    const vs=`#version 300 es
    layout(location=3) in float ambient; out float ao; layout(location=0) in vec3 pos; layout(location=1) in vec3 normal; layout(location=2) in vec2 uv;
    uniform vec3 extent,eye,right,up,forward;uniform vec2 focal;
    out vec3 wp,n; out vec2 st;
    void main(){ao=ambient;wp=pos*extent-1.;n=normal;st=uv;vec3 delta=wp-eye;
      float z=dot(delta,forward);gl_Position=vec4(dot(delta,right)*focal.x,dot(delta,up)*focal.y,1.001*z-.056,z);}`;
    const fs=`#version 300 es
    precision highp float;
    in float ao;in vec3 wp,n;in vec2 st;out vec4 outColor;
    uniform vec3 base,extent;uniform vec4 rect;uniform int mode;uniform float wood,emission;
    uniform sampler2D atlas,floorTex,ceilTex,eastTex,westTex,backTex;
    vec3 wallColor(vec3 c,sampler2D im,vec2 uv,float depth,float facing){
      vec4 tex=texture(im,uv);float err=abs(tex.a*1.25*255./254.-depth);
      float valid=(1.-smoothstep(.009,.035,err))*smoothstep(.25,.76,facing);
      return mix(c,tex.rgb,valid);}
    void main(){
      vec2 dim=extent.xy-2.;vec3 norm=normalize(n);
      vec3 albedo=base;
      if(mode==1){albedo=texture(atlas,rect.xy+vec2(st.x,1.-st.y)*rect.zw).rgb;}
      float grain=sin(wp.x*199.+wp.y*157.+sin(wp.z*17.+wp.x*2.5))*0.013;
      float fill=(.86+.115*norm.z+.05*norm.y-.03*norm.x)*(.60+.43*sqrt(ao));
      vec3 c=albedo*vec3(1.05,1.016,.974)*(fill+wood*grain);
      if(emission>2.) c=mix(albedo,vec3(1.,.97,.88),.74);
      if(mode==2){c=texture(floorTex,vec2(wp.x/dim.x,1.-wp.y/dim.y)).rgb;}
      else if(mode==3){c=texture(ceilTex,vec2(wp.x/dim.x,wp.y/dim.y)).rgb;}
      else if(wp.z>=0. && wp.z<=3.14){
        float h=1.-wp.z/3.14;
        if(wp.x>dim.x-.85) c=wallColor(c,eastTex,vec2(1.-wp.y/dim.y,h),wp.x-dim.x+.85,-norm.x);
        if(wp.x<.85)c=wallColor(c,westTex,vec2(wp.y/dim.y,h),.85-wp.x,norm.x);
        if(wp.y>dim.y-.85)c=wallColor(c,backTex,vec2(wp.x/dim.x,h),wp.y-dim.y+.85,-norm.y);
      }
      outColor=vec4(c,1.);}`;
    const prog=gl.createProgram();
    for (const [type,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]) {
      const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog,sh);
    }
    gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);this.u={};
    for(const name of 'extent eye right up forward focal base rect mode wood emission atlas floorTex ceilTex eastTex westTex backTex'.split(' '))this.u[name]=gl.getUniformLocation(prog,name);
    ['atlas','floorTex','ceilTex','eastTex','westTex','backTex'].forEach((n,i)=>gl.uniform1i(this.u[n],i));
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(.76,.76,.73,1);
    this.aniso=gl.getExtension('EXT_texture_filter_anisotropic');
  }
  async prepare(s) {
    const gl=this.gl;
    const compressed=Uint8Array.from(atob(s.geo),x=>x.charCodeAt(0));
    const inflated=new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const imgs=await Promise.all(s.images.map(url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;})));
    const bytes=await inflated;
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);
    for(const [idx,num,t,offset] of [[0,3,gl.UNSIGNED_SHORT,0],[1,3,gl.BYTE,6],[2,2,gl.UNSIGNED_SHORT,10],[3,1,gl.UNSIGNED_BYTE,9]]){
      gl.enableVertexAttribArray(idx);gl.vertexAttribPointer(idx,num,t,true,14,offset);}
    const textures=imgs.map(img=>{
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      if(this.aniso)gl.texParameterf(gl.TEXTURE_2D,this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,4);
      gl.generateMipmap(gl.TEXTURE_2D);return tex;
    });
    s.groups.forEach(g=>{g.rgb=g.c.map(c=>Math.min(1,1.055*Math.pow(c,1/2.4)-.055));});
    return {vao,vbo,textures};
  }
  draw(s,gpu,cam){
    const gl=this.gl,canvas=gl.canvas,ratio=Math.min(devicePixelRatio||1,1.45,1800/Math.max(canvas.clientWidth,canvas.clientHeight,1));
    const w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.max(1,Math.round(canvas.clientHeight*ratio));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.bindVertexArray(gpu.vao);
    gpu.textures.forEach((t,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);});
    const u=this.u,rad=Math.PI/180,yaw=cam.yaw*rad,pitch=cam.pitch*rad,c=Math.cos(yaw),sn=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    gl.uniform3f(u.extent,s.W+2,s.D+2,6);gl.uniform3f(u.eye,cam.x,cam.y,1.58);
    gl.uniform3f(u.right,c,-sn,0);gl.uniform3f(u.up,-sn*sp,-c*sp,cp);gl.uniform3f(u.forward,sn*cp,c*cp,sp);
    const fy=1/Math.tan(63*rad/2);gl.uniform2f(u.focal,fy*h/w,fy);
    let start=0;
    for(const g of s.groups){gl.uniform3fv(u.base,g.rgb);gl.uniform4fv(u.rect,g.rect||[0,0,1,1]);gl.uniform1i(u.mode,g.m);gl.uniform1f(u.emission,g.e);gl.uniform1f(u.wood,g.wood?1:0);gl.drawArrays(gl.TRIANGLES,start,g.n);start+=g.n;}
  }
}
