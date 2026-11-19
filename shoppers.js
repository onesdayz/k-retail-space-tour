// Metres on the floor plan. Facing uses the same clockwise-from-north angle as the camera.
const shoppersByArea={
  100:[
    {look:0,x:1.86,y:3.18,facing:6,height:1.63},
    {look:1,x:6.97,y:6.88,facing:86,height:1.67},
    {look:2,x:2.54,y:2.26,facing:216,height:1.62},
    {look:4,x:6.92,y:3.96,facing:99,height:1.77}
  ],
  300:[
    {look:0,x:3.48,y:5.62,facing:275,height:1.63},
    {look:1,x:7.24,y:8.84,facing:134,height:1.67},
    {look:2,x:11.76,y:13.73,facing:194,height:1.62},
    {look:3,x:3.48,y:12.75,facing:267,height:1.65},
    {look:4,x:12.97,y:17.54,facing:94,height:1.77}
  ]
};

class ShopperLayer{
  constructor(gl){
    this.gl=gl;
    const vertex=`#version 300 es
      uniform vec4 pose; // floor x, floor y, height, facing (radians)
      uniform int look,shadow;
      out vec2 uv;out vec3 world;out float proximity;
      ${projection}
      void main(){
        vec2 corner=vec2(float(gl_VertexID%2),float(gl_VertexID/2));
        vec2 delta=eye.xy-pose.xy;
        float distanceToEye=length(delta);
        vec2 toEye=delta/max(.001,distanceToEye);
        vec2 across=vec2(-toEye.y,toEye.x);
        vec2 facing=vec2(sin(pose.w),cos(pose.w));
        proximity=smoothstep(.28,.60,distanceToEye);
        if(shadow==1){
          vec2 footprint=(corner-.5)*vec2(.72,.51);
          vec2 side=vec2(facing.y,-facing.x);
          world=vec3(pose.xy+footprint.x*side+footprint.y*facing,.037);
          uv=corner*2.-1.;
        }else{
          float angle=acos(clamp(dot(facing,toEye),-1.,1.));
          float row=floor(angle/0.78539816+.5);
          float u=dot(facing,across)<0.?1.-corner.x:corner.x;
          uv=(vec2(float(look),row)+vec2(u,1.-corner.y))/5.;
          world=vec3(pose.xy+across*(corner.x-.5)*pose.z*(272./448.),.015+corner.y*pose.z);
        }
        gl_Position=project(world);
      }`;
    const fragment=`#version 300 es
      precision highp float;
      uniform sampler2D portraits;
      uniform vec2 room;uniform vec3 eye;uniform highp int shadow;
      in vec2 uv;in vec3 world;in float proximity;out vec4 pixel;
      ${ceilingIllumination}
      void main(){
        if(proximity<.01)discard;
        if(shadow==1){
          float d=dot(uv,uv);
          pixel=vec4(.16,.115,.08,(1.-smoothstep(.04,1.,d))*.28*proximity);
        }else{
          vec4 image=texture(portraits,uv);
          if(image.a<.07)discard;
          vec3 normal=vec3(0.,0.,1.);
          vec3 viewDir=normalize(eye-world);
          vec3 base=image.rgb*vec3(.985,.972,.956);
          vec3 lit=displayLight(ceilingLight(base,world,normal,viewDir,.02),world,normal,viewDir,.02);
          pixel=vec4(mix(base,lit,.32),image.a*proximity);
        }
      }`;
    this.program=createProgram(gl,vertex,fragment);
    this.u=uniforms(gl,this.program,'eye right up forward focal room pose look shadow portraits lightField displayField');
    gl.useProgram(this.program);
    gl.uniform1i(this.u.portraits,12);gl.uniform1i(this.u.lightField,6);gl.uniform1i(this.u.displayField,9);
    this.vao=gl.createVertexArray();
  }
  load(){
    if(this.ready)return this.ready;
    const img=new Image();
    img.src='assets/shoppers.webp';
    this.ready=img.decode().then(()=>{
      const gl=this.gl;
      this.texture=gl.createTexture();gl.activeTexture(gl.TEXTURE12);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
    }).catch(error=>{this.ready=null;throw error;});
    return this.ready;
  }
  draw(scene,cam,w,h){
    const gl=this.gl,u=this.u,people=shoppersByArea[scene.W<10?100:300];
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);
    cameraUniforms(gl,u,cam,scene,w,h);
    gl.activeTexture(gl.TEXTURE12);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    for(const shadow of [1,0]){
      gl.depthMask(!shadow);gl.uniform1i(u.shadow,shadow);
      for(const person of people){
        gl.uniform4f(u.pose,person.x,person.y,person.height,person.facing*Math.PI/180);
        gl.uniform1i(u.look,person.look);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
    }
    gl.disable(gl.BLEND);gl.activeTexture(gl.TEXTURE0);
  }
}
