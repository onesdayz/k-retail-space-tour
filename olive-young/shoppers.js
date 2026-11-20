// Metres on the floor plan. Facing uses the same clockwise-from-north angle as the camera.
const shoppersByArea={
  100:[
    {look:0,x:2.43,y:2.36,facing:212,height:1.64},
    {look:1,x:1.86,y:3.13,facing:4,height:1.63},
    {look:2,x:6.08,y:10.25,facing:75,height:1.67},
    {look:5,x:6.96,y:10.52,facing:255,height:1.61},
    {look:3,x:6.91,y:6.77,facing:90,height:1.04},
    {look:6,x:1.04,y:8.01,facing:264,height:1.69},
    {look:4,x:6.85,y:4.69,facing:83,height:1.67},
    {look:10,x:1.36,y:5.54,facing:270,height:1.82},
    {look:1,x:1.20,y:10.64,facing:268,height:1.66},
    {look:7,x:2.26,y:11.02,facing:339,height:1.71},
    {look:11,x:5.75,y:11.41,facing:29,height:1.80},
    {look:6,x:5.37,y:8.33,facing:146,height:1.68},
    {look:8,x:5.61,y:4.83,facing:157,height:1.66},
    {look:5,x:1.36,y:2.62,facing:168,height:1.64}
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
    {look:9,x:9.79,y:4.83,facing:147,height:1.65},
    {look:10,x:1.30,y:5.85,facing:270,height:1.83},
    {look:7,x:1.42,y:10.76,facing:275,height:1.71},
    {look:1,x:5.12,y:11.22,facing:12,height:1.66},
    {look:6,x:1.67,y:17.84,facing:310,height:1.69},
    {look:11,x:6.92,y:16.32,facing:96,height:1.80},
    {look:0,x:10.18,y:16.24,facing:14,height:1.64},
    {look:9,x:11.75,y:11.31,facing:353,height:1.69},
    {look:2,x:7.92,y:6.63,facing:13,height:1.67},
    {look:10,x:7.13,y:1.55,facing:304,height:1.82},
    {look:8,x:7.04,y:20.04,facing:7,height:1.66}
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
  {aspect:0.976,motion:[0.042, -0.009, 0.011, 0.83]}, // Present a payment card
  {aspect:0.54,motion:[0.028, 0.009, 0.018, 0.83],cells:[10,11]}, // Read a carton / adjust a sleeve
  {aspect:0.78,motion:[0.022, -0.008, 0.017, 1.07],cells:[12,13]} // Check a phone / gesture to the shelf
];

// Hold one of two stances per person until the floor is opened again.
const shopperStances=[
  [[.017, -.014, .001], [.095, .037, -.012]],
  [[.030, .021, -.006], [-.039, -.057, .010]],
  [[.014, -.029, .004], [.103, .039, -.024]]
];
const shopperAtlasColumns=14;

class ShopperLayer{
  constructor(gl){
    this.gl=gl;
    this.people=[];
    const vertex=`#version 300 es
      uniform vec4 pose; // floor x, floor y, height, facing (radians)
      uniform int look,shadow,seated;
      uniform float aspect,time;
      uniform vec4 motion; // forward lean, lift, lateral shift, tempo
      uniform vec3 stance; // forward lean, weight shift, waist height
      out vec2 uv;out vec3 world;out float proximity;
      ${projection}
      void main(){
        vec2 corner=vec2(float(gl_VertexID%2),float(gl_VertexID/2)/(shadow==1?1.:32.));
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
          uv=(vec2(float(look),row)+vec2(u,1.-corner.y))/vec2(${shopperAtlasColumns}.,5.);
          vec2 side=vec2(facing.y,-facing.x);
          float phase=time*motion.w+float(look)*2.12+pose.x*1.47+pose.y*.54;
          float gesture=smoothstep(-.65,.85,sin(phase));
          float y=corner.y;
          float upper=smoothstep(.28,.91,y);
          vec2 lean=facing*motion.x*gesture+side*motion.z*sin(phase*.5);
          float legExtension=.064*smoothstep(.04,.53,y)*(1.-smoothstep(.53,.89,y));
          float neckLift=.023*smoothstep(.61,.85,y)*(1.-smoothstep(.85,1.,y));
          float z=y+neckLift+(seated==0?legExtension:0.);
          float headWidth=mix(1.,.88,smoothstep(.79,.86,y));
          vec2 weight=facing*stance.x+side*stance.y;
          vec2 xy=pose.xy+across*(corner.x-.5)*pose.z*aspect*headWidth+upper*(lean+weight);
          float waist=smoothstep(.12,.53,y)*(1.-.65*smoothstep(.53,.97,y));
          world=vec3(xy,.015+z*pose.z+upper*motion.y*gesture+stance.z*waist);
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
    this.u=uniforms(gl,this.program,'eye right up forward focal room pose aspect time motion stance look shadow seated portraits lightField displayField');
    gl.useProgram(this.program);
    gl.uniform1i(this.u.portraits,12);gl.uniform1i(this.u.lightField,6);gl.uniform1i(this.u.displayField,9);
    this.vao=gl.createVertexArray();
  }
  selectArea(area){
    this.people=shoppersByArea[area].map(person=>{
      const variant=Math.random()<.5?0:1;
      const style=shopperLooks[person.look];
      const cell=style.cells?.[variant]??person.look;
      const facing=person.facing+(variant?(person.look%2?-13:16):0);
      const stance=shopperStances[person.look%shopperStances.length][variant];
      return {...person,variant,style,cell,angle:facing*Math.PI/180,stance,seated:person.look===3?1:0};
    });
  }
  load(){
    if(this.ready)return this.ready;
    const img=new Image();
    img.src='assets/shoppers.webp?v=28';
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
    const gl=this.gl,u=this.u;
    const yaw=cam.yaw*Math.PI/180,sin=Math.sin(yaw),cos=Math.cos(yaw);
    const tanX=(w/h)*Math.tan(31.5*Math.PI/180)/(cam.zoom||1);
    this.nearby=false;
    const visible=this.people.filter(person=>{
      const dx=person.x-cam.x,dy=person.y-cam.y;
      const forward=dx*sin+dy*cos,side=dx*cos-dy*sin;
      const onScreen=forward>-.8&&Math.abs(side)<Math.max(0,forward)*tanX+1.25;
      if(onScreen&&dx*dx+dy*dy<49)this.nearby=true;
      return onScreen;
    });
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);
    gl.uniform1f(u.time,time);
    cameraUniforms(gl,u,cam,scene,w,h);
    gl.activeTexture(gl.TEXTURE12);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    for(const shadow of [1,0]){
      gl.depthMask(!shadow);gl.uniform1i(u.shadow,shadow);
      for(const person of visible){
        gl.uniform4f(u.pose,person.x,person.y,person.height,person.angle);
        gl.uniform1f(u.aspect,person.style.aspect);gl.uniform4fv(u.motion,person.style.motion);
        gl.uniform3fv(u.stance,person.stance);
        gl.uniform1i(u.look,person.cell);gl.uniform1i(u.seated,person.seated);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,shadow?4:66);
      }
    }
    gl.disable(gl.BLEND);gl.activeTexture(gl.TEXTURE0);
  }
}
