// Metres on the floor plan. Facing uses the same clockwise-from-north angle as the camera.
const shoppersByArea={
  100:[
    {look:0,x:2.43,y:2.36,facing:212,height:1.64},
    {look:1,x:1.86,y:3.13,facing:4,height:1.63},
    {look:2,x:6.08,y:10.25,facing:75,height:1.67},
    {look:5,x:6.96,y:10.52,facing:255,height:1.61},
    {look:3,x:6.91,y:6.77,facing:90,height:1.04},
    {look:6,x:1.04,y:8.01,facing:264,height:1.69},
    {look:4,x:6.85,y:4.69,facing:83,height:1.67}
  ],
  300:[
    {look:0,x:4.65,y:2.39,facing:220,height:1.64},
    {look:1,x:3.52,y:5.61,facing:270,height:1.63},
    {look:2,x:7.08,y:10.17,facing:29,height:1.67},
    {look:5,x:7.53,y:11.02,facing:209,height:1.61},
    {look:3,x:12.93,y:13.72,facing:91,height:1.01},
    {look:4,x:3.49,y:14.29,facing:235,height:1.67},
    {look:6,x:1.1,y:9.25,facing:273,height:1.69},
    {look:7,x:12.85,y:18.94,facing:90,height:1.68},
    {look:8,x:9.76,y:7.66,facing:38,height:1.66},
    {look:9,x:9.79,y:4.83,facing:147,height:1.65}
  ]
};

// Portrait proportions and upper-body motion for each shopping gesture.
const shopperLooks=[
  {aspect:0.414,motion:[0.014, 0.006, 0.007, 0.95]}, // Smell a scent strip
  {aspect:0.487,motion:[0.023, -0.009, 0.01, 1.1]}, // Swatch a lip tint
  {aspect:0.939,motion:[0.035, 0.005, 0.008, 0.79]}, // Offer a sample
  {aspect:1.184,motion:[0.05, -0.04, 0.009, 0.74]}, // Inspect the lower shelf
  {aspect:0.463,motion:[0.015, 0.021, 0.017, 0.87]}, // Frame a product photo
  {aspect:0.797,motion:[0.032, 0.009, 0.013, 0.79]}, // Receive the sample
  {aspect:0.748,motion:[0.047, 0.034, 0.005, 0.93]}, // Reach for a carton
  {aspect:0.492,motion:[0.016, 0.008, 0.018, 0.91]}, // Check a compact mirror
  {aspect:0.736,motion:[0.046, -0.033, 0.01, 1.02]}, // Pack a shopping tote
  {aspect:0.976,motion:[0.042, -0.009, 0.011, 0.83]} // Present a payment card
];

class ShopperLayer{
  constructor(gl){
    this.gl=gl;
    const vertex=`#version 300 es
      uniform vec4 pose; // floor x, floor y, height, facing (radians)
      uniform int look,shadow;
      uniform float aspect,time;
      uniform vec4 motion; // forward lean, lift, lateral shift, tempo
      out vec2 uv;out vec3 world;out float proximity;
      ${projection}
      void main(){
        vec2 corner=vec2(float(gl_VertexID%2),float(gl_VertexID/2)/(shadow==1?1.:8.));
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
          uv=(vec2(float(look),row)+vec2(u,1.-corner.y))/vec2(10.,5.);
          vec2 side=vec2(facing.y,-facing.x);
          float phase=time*motion.w+float(look)*2.12;
          float gesture=smoothstep(-.65,.85,sin(phase));
          float upper=smoothstep(.20,.96,corner.y);
          vec2 lean=facing*motion.x*gesture+side*motion.z*sin(phase*.5);
          vec2 xy=pose.xy+across*(corner.x-.5)*pose.z*aspect+upper*lean;
          world=vec3(xy,.015+corner.y*pose.z+upper*motion.y*gesture);
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
    this.u=uniforms(gl,this.program,'eye right up forward focal room pose aspect time motion look shadow portraits lightField displayField');
    gl.useProgram(this.program);
    gl.uniform1i(this.u.portraits,12);gl.uniform1i(this.u.lightField,6);gl.uniform1i(this.u.displayField,9);
    this.vao=gl.createVertexArray();
  }
  load(){
    if(this.ready)return this.ready;
    const img=new Image();
    img.src='assets/shoppers.webp?v=23';
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
  draw(scene,cam,w,h,time){
    const gl=this.gl,u=this.u,people=shoppersByArea[scene.W<10?100:300];
    const yaw=cam.yaw*Math.PI/180,sin=Math.sin(yaw),cos=Math.cos(yaw);
    const tanX=(w/h)*Math.tan(31.5*Math.PI/180)/(cam.zoom||1);
    this.nearby=people.some(person=>{
      const dx=person.x-cam.x,dy=person.y-cam.y;
      const forward=dx*sin+dy*cos,side=dx*cos-dy*sin;
      return dx*dx+dy*dy<49&&forward>-.7&&Math.abs(side)<Math.max(0,forward)*tanX+1.2;
    });
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);
    gl.uniform1f(u.time,time);
    cameraUniforms(gl,u,cam,scene,w,h);
    gl.activeTexture(gl.TEXTURE12);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    for(const shadow of [1,0]){
      gl.depthMask(!shadow);gl.uniform1i(u.shadow,shadow);
      for(const person of people){
        gl.uniform4f(u.pose,person.x,person.y,person.height,person.facing*Math.PI/180);
        const style=shopperLooks[person.look];
        gl.uniform1f(u.aspect,style.aspect);gl.uniform4fv(u.motion,style.motion);
        gl.uniform1i(u.look,person.look);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,shadow?4:18);
      }
    }
    gl.disable(gl.BLEND);gl.activeTexture(gl.TEXTURE0);
  }
}
