'use strict';
window.storeData={};
const el=id=>document.getElementById(id);
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.input='pointer';},true);
document.addEventListener('keydown',()=>{document.documentElement.dataset.input='keyboard';},true);
const view=el('view'),map=el('map'),statusBox=el('load');
const names=['입구','올리브영','중소 브랜드 A–D','종근당건강','WZ바이오','결제·포장','공용 체험·기획전'];
const colors=['#aaa69b','#c5b888','#b79570','#e0b250','#a49dba','#c5b49a','#bf8663'];
const rad=Math.PI/180, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let area=100,scene=null,gpu=null,renderer=null,generation=0,active=-1,loading=false;
let cam={x:0,y:0,yaw:0,pitch:0},frame=0,dirty=false,last=0,tourTime=0,playing=false;
const pointers=new Map();
const lookOffset={yaw:0,pitch:0};
let stickPress=null,slide=null,zoom=1;
let keyset=new Set(),joy=null,axis={x:0,y:0},mapLayout=null,overview=null;
const stores=new Map(),nav=el('stops');
const stopButtons=names.map((name,i)=>{
  const button=document.createElement('button'),dot=document.createElement('i');dot.style.setProperty('--color',colors[i]);
  button.append(dot,document.createTextNode(name));button.onclick=()=>jump(i);nav.append(button);return button;
});
const experienceIndex=names.indexOf('공용 체험·기획전');
stopButtons[0].after(stopButtons[experienceIndex]);
function message(text){statusBox.hidden=!text;statusBox.textContent=text;}
function readAsset(id){
  if(window.storeData[id])return Promise.resolve(window.storeData[id]);
  return new Promise((resolve,reject)=>{const js=document.createElement('script');js.src='assets/store-'+id+'.js?v=18';
    js.onload=()=>resolve(window.storeData[id]);js.onerror=()=>{js.remove();reject(Error('매장 자료를 열 수 없습니다. 페이지를 새로고침해 주세요.'));};document.head.append(js);});
}
const planLink=el('planFile');
const floorPlans={
  100:{url:planLink.getAttribute('href'),filename:planLink.download},
  300:{url:planLink.dataset.plan300,filename:'300㎡_매대배치_수정평면도.pdf'}
};
async function openArea(id){
  if(loading&&id===area)return;
  const token=++generation;area=id;loading=true;resetInput();scene=null;last=0;
  document.querySelectorAll('[data-area]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.area===id)));
  planLink.href=floorPlans[id].url;
  planLink.download=floorPlans[id].filename;
  planLink.querySelector('span').textContent=id+'㎡ 배치도 PDF';
  el('sizeLabel').textContent=id+'㎡';el('where').textContent='입구';el('tour').disabled=true;
  document.querySelector('.viewer').style.backgroundImage='url(assets/entrance-'+id+'.webp?v=18)';
  view.style.visibility='hidden';message('매장을 여는 중…');closeGuide();
  try{
    if(!renderer)renderer=new StoreRenderer(view);
    const owner=renderer;
    if(owner.touchDisplay.matches){
      for(const [other,pending] of stores){
        if(other===id)continue;
        stores.delete(other);
        pending.then(old=>owner.release(old.buffers),()=>{});
      }
    }
    if(!stores.has(id)){
      const pending=(async()=>{
        const data=await readAsset(id);
        data.blocked=Uint8Array.from(atob(data.solid),c=>c.charCodeAt(0));
        data.fixtures=Uint8Array.from(atob(data.walls),c=>c.charCodeAt(0));
        return {data,buffers:await owner.prepare(data)};
      })();
      stores.set(id,pending);
      pending.catch(()=>{if(stores.get(id)===pending)stores.delete(id);});
    }
    const result=await stores.get(id);if(token!==generation)return;
    scene=result.data;gpu=result.buffers;loading=false;active=-1;makeOverview();jump(0);
    view.style.visibility='visible';el('tour').disabled=false;message('');requestRender();
  }catch(e){if(token===generation){loading=false;message(e.message||'매장을 열 수 없습니다. 페이지를 새로고침해 주세요.');}}
}
function walkable(x,y){
  const [w,h,d]=scene.grid,c=Math.floor(x/d),r=Math.floor(y/d);
  return c>=0&&r>=0&&c<w&&r<h&&!scene.blocked[r*w+c];
}
function nearestSafe(x,y){
  if(walkable(x,y))return [x,y];
  const [w,h,d]=scene.grid;let best=Infinity,bx=x,by=y;
  for(let r=0;r<h;r++)for(let c=0;c<w;c++){
    if(scene.blocked[r*w+c])continue;
    const px=(c+.5)*d,py=(r+.5)*d,ds=(x-px)**2+(y-py)**2;
    if(ds<best){best=ds;bx=px;by=py;}
  }return [bx,by];
}
function setStop(i){if(i===active)return;active=i;el('where').textContent=names[i];stopButtons.forEach((b,j)=>b.setAttribute('aria-current',String(i===j)));}
function nearestIndex(arr,xy){let best=Infinity,index=0;arr.forEach((p,i)=>{const d=(p[0]-xy.x)**2+(p[1]-xy.y)**2;if(d<best){best=d;index=i;}});return index;}
function zone(routeIndex=nearestIndex(scene.route,cam)){
  // The two parallel aisles belong to different sides of the same loop.
  const [ex,ey]=scene.experienceView;
  if(Math.hypot(cam.x-ex,cam.y-ey)<.85){setStop(experienceIndex);return;}
  const t=routeIndex/5;
  const breaks=area===100?[7,22,33,39.5,45]:[13,32,42.5,50.5,58];
  setStop(breaks.filter(b=>t>=b).length);
}
function jump(i){
  if(!scene)return;resetInput();
  const customView=i===experienceIndex?scene.experienceView:i===5?scene.checkoutView:null;
  const pose=customView||scene.route[Math.round(scene.stops[i]*5)];
  const [x,y,yaw,pitch]=pose;
  tourTime=i===experienceIndex?nearestIndex(scene.route,{x,y})/5:scene.stops[i];
  const [sx,sy]=nearestSafe(x,y);cam={x:sx,y:sy,yaw,pitch,zoom};
  if(playing)alignTourView();
  setStop(i);closeGuide();requestRender();
}
function setPlayback(on){
  playing=on;el('tour').setAttribute('aria-pressed',String(on));
  el('playIcon').textContent=on?'Ⅱ':'▶';el('playText').textContent=on?'일시 정지':'동선 따라가기';
  stick.setAttribute('aria-label',on?'자유 방향 둘러보기':'자유 방향 이동');
  const labels=on?['위로 보기','왼쪽 보기','오른쪽 보기','아래로 보기']:['앞으로 이동','왼쪽으로 이동','오른쪽으로 이동','뒤로 이동'];
  ['up','left','right','down'].forEach((key,i)=>stick.querySelector('[data-move='+key+']').setAttribute('aria-label',labels[i]));
}
function sampledPose(time){
  const j=Math.min(scene.route.length-2,Math.floor(time*5)),f=time*5-j;
  const a=scene.route[j],b=scene.route[j+1],turn=(b[2]-a[2]+540)%360-180;
  return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+turn*f,a[3]+(b[3]-a[3])*f];
}
function alignTourView(){
  const pose=sampledPose(tourTime);
  lookOffset.yaw=cam.yaw-pose[2];lookOffset.pitch=cam.pitch-pose[3];
}
function lookBy(yaw,pitch){
  const target=clamp(cam.pitch+pitch,-75,75);
  if(playing){lookOffset.yaw+=yaw;lookOffset.pitch+=target-cam.pitch;}
  cam.yaw+=yaw;cam.pitch=target;
}
function resetInput(){slide=null;keyset.clear();pointers.clear();clearStick();}
function closeGuide(){document.body.classList.remove('panel');el('mapToggle').setAttribute('aria-expanded','false');}
function requestRender(){dirty=true;if(!frame)frame=requestAnimationFrame(tick);}
function tick(ts){
  frame=0;const dt=last?Math.min((ts-last)/1000,.12):0;last=ts;
  if(!scene)return;
  if(playing){
    const end=(scene.route.length-1)/5;tourTime=(tourTime+dt)%end;
    const [x,y,yaw,pitch]=sampledPose(tourTime);
    cam.x=x;cam.y=y;cam.yaw=yaw+lookOffset.yaw;cam.pitch=clamp(pitch+lookOffset.pitch,-75,75);
    const k=key=>Number(keyset.has(key));
    const pan=axis.x+k('KeyD')-k('KeyA')+k('ArrowRight')-k('ArrowLeft');
    const tilt=axis.y+k('KeyW')-k('KeyS')+k('ArrowUp')-k('ArrowDown');
    if(pan||tilt)lookBy(dt*75*pan,dt*55*tilt);
    const cuts=area===100?[7,22,33,39.5,45]:[13,32,42.5,50.5,58];setStop(cuts.filter(b=>tourTime>=b).length);
    dirty=true;
  }else if(keyset.size||axis.x||axis.y){
    const k=key=>+keyset.has(key);
    cam.yaw+=dt*85*(k('ArrowRight')-k('ArrowLeft'));
    let side=k('KeyD')-k('KeyA')+axis.x,fwd=k('KeyW')+k('ArrowUp')-k('KeyS')-k('ArrowDown')+axis.y;
    walk(side,fwd,dt*1.55);
    dirty=true;
  }
  const moving=Boolean(playing||keyset.size||axis.x||axis.y||pointers.size);
  if(dirty){renderer.draw(scene,gpu,cam,moving,dt);drawMap();dirty=false;}
  if(playing||keyset.size||axis.x||axis.y)frame=requestAnimationFrame(tick);else last=0;
}
function makeOverview(){
  const [w,h,d]=scene.grid;overview=document.createElement('canvas');overview.width=w;overview.height=h;
  const ctx=overview.getContext('2d'),pic=ctx.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const occupied=scene.fixtures[y*w+x],oy=x/w<(area===100?.6:.666);
    const mx=(x+.5)*d,my=(y+.5)*d;
    const tile=scene.displayFloors?.some(([l,b,r,t])=>mx>=l&&mx<=r&&my>=b&&my<=t);
    const rgb=occupied?(oy?[140,135,122]:[159,145,119]):tile?[84,80,70]:(oy?[56,56,57]:[64,61,56]);
    const i=((h-1-y)*w+x)*4;pic.data.set([...rgb,255],i);
  }ctx.putImageData(pic,0,0);
}
function drawMap(){
  if(!scene||(compactHeader.matches&&!document.body.classList.contains('panel'))||!map.clientWidth||!map.clientHeight)return;
  const w=map.clientWidth,h=map.clientHeight,ratio=Math.min(2,devicePixelRatio||1);
  if(map.width!==Math.round(w*ratio)||map.height!==Math.round(h*ratio)){
    map.width=Math.round(w*ratio);map.height=Math.round(h*ratio);
  }
  const ctx=map.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  const s=Math.min((w-14)/scene.W,(h-10)/scene.D),x=(w-scene.W*s)/2,y=(h-scene.D*s)/2;
  mapLayout={s,x,y};const mx=v=>x+v*s,my=v=>y+(scene.D-v)*s;
  ctx.drawImage(overview,x,y,scene.W*s,scene.D*s);ctx.strokeStyle='#a69a7b';ctx.lineWidth=1.3;ctx.strokeRect(x,y,scene.W*s,scene.D*s);
  ctx.strokeStyle='#9c8860';ctx.lineWidth=.8;
  for(const [l,b,r,t] of scene.displayFloors||[])ctx.strokeRect(mx(l),my(t),(r-l)*s,(t-b)*s);
  ctx.beginPath();ctx.setLineDash([3,3]);ctx.lineWidth=1.5;ctx.strokeStyle='#e1ba63';
  scene.route.forEach((p,i)=>{if(i===0)ctx.moveTo(mx(p[0]),my(p[1]));else ctx.lineTo(mx(p[0]),my(p[1]));});ctx.stroke();ctx.setLineDash([]);
  ctx.save();ctx.translate(mx(cam.x),my(cam.y));ctx.rotate(cam.yaw*rad);ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,17,-2.12,-1.02);ctx.closePath();ctx.fillStyle='#e8ba5463';ctx.fill();
  ctx.beginPath();ctx.arc(0,0,4.6,0,Math.PI*2);ctx.fillStyle='#ffce59';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
}
map.onclick=e=>{
  if(!scene||!mapLayout)return;const r=map.getBoundingClientRect(),m=mapLayout,x=(e.clientX-r.left-m.x)/m.s,y=scene.D-(e.clientY-r.top-m.y)/m.s;
  if(!walkable(x,y))return;
  const index=nearestIndex(scene.route,{x,y});tourTime=index/5;
  if(playing){const pose=scene.route[index];cam.x=pose[0];cam.y=pose[1];}
  else{cam.x=x;cam.y=y;}
  zone(index);closeGuide();requestRender();
};
el('tour').onclick=()=>{
  if(!scene)return;
  resetInput();
  if(playing)setPlayback(false);
  else{alignTourView();setPlayback(true);}
  requestRender();
};
document.querySelectorAll('[data-area]').forEach(b=>b.onclick=()=>{if(+b.dataset.area!==area||!scene)openArea(+b.dataset.area);});
el('mapToggle').onclick=()=>{const show=document.body.classList.toggle('panel');el('mapToggle').setAttribute('aria-expanded',String(show));requestRender();};
el('closeGuide').onclick=closeGuide;
const compactHeader=matchMedia('(max-width:760px)');
compactHeader.addEventListener('change',()=>{closeGuide();requestRender();});
const help=el('instructions');
document.querySelectorAll('footer [aria-haspopup="dialog"]').forEach(button=>{
  button.onclick=()=>{resetInput();help.showModal();};
});
el('dismiss').onclick=()=>help.close();
const fs=el('full');if(!document.documentElement.requestFullscreen)fs.hidden=true;
fs.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{fs.hidden=true;}};
document.addEventListener('fullscreenchange',()=>{fs.setAttribute('aria-label',document.fullscreenElement?'전체 화면 종료':'전체 화면');requestRender();});
function setZoom(value){
  zoom=clamp(value,.7,2.5);cam.zoom=zoom;
  el('zoomLevel').textContent=Number(zoom.toFixed(2))+'×';
  el('zoomIn').disabled=zoom>=2.5;el('zoomOut').disabled=zoom<=.7;
  requestRender();
}
el('zoomIn').onclick=()=>setZoom(zoom*1.25);
el('zoomOut').onclick=()=>setZoom(zoom/1.25);
view.addEventListener('wheel',e=>{
  if(e.ctrlKey && scene){e.preventDefault();setZoom(zoom*Math.exp(-e.deltaY*.01));}
},{passive:false});
view.onpointerdown=e=>{
  if(!scene||e.button!==0||pointers.size>=2)return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  view.setPointerCapture(e.pointerId);view.focus({preventScroll:true});
};
view.onpointermove=e=>{
  const old=pointers.get(e.pointerId);
  if(!old)return;
  const next={x:e.clientX,y:e.clientY};
  if(pointers.size===2){
    const other=Array.from(pointers.entries()).find(([id])=>id!==e.pointerId)[1];
    const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(next.x-other.x,next.y-other.y);
    if(before>2 && after>2)setZoom(zoom*after/before);
  }else{
    lookBy((next.x-old.x)*.22,-(next.y-old.y)*.18);
    requestRender();
  }
  pointers.set(e.pointerId,next);
};
view.onpointerup=view.onpointercancel=view.onlostpointercapture=e=>{
  if(pointers.delete(e.pointerId))requestRender();
};
const stick=el('stick'),knob=stick.querySelector('i');
const directions={up:[0,1],down:[0,-1],left:[-1,0],right:[1,0]};
// For a head-on contact, follow the edge with the nearest reachable opening.
function bypassScore(tx,ty,nx,ny){
  const cell=scene.grid[2],stride=cell*.5;
  let run=0;
  for(let i=1;i<=120;i++){
    const d=i*stride,x=cam.x+tx*d,y=cam.y+ty*d;
    if(!walkable(x,y))break;
    run=d;
    if(walkable(x+nx*cell*1.5,y+ny*cell*1.5))return 10-d;
  }
  return run;
}
function slideStep(nx,ny,intent,step){
  // The normal is axis-aligned because the floor plan is an occupancy grid.
  const tx=ny===0?0:1,ty=nx===0?0:1;
  const along=Math.abs(intent)>.24?Math.sign(intent):0;
  let sign=along;
  if(!sign){
    if(slide&&slide.nx===nx&&slide.ny===ny)sign=slide.sign;
    else sign=bypassScore(tx,ty,nx,ny)>=bypassScore(-tx,-ty,nx,ny)?1:-1;
  }
  const travel=step*(.80+.20*Math.abs(intent));
  if(!walkable(cam.x+tx*travel*sign,cam.y+ty*travel*sign)){
    if(!walkable(cam.x-tx*travel*sign,cam.y-ty*travel*sign))return;
    sign=-sign;
  }
  slide={nx,ny,sign};cam.x+=tx*travel*sign;cam.y+=ty*travel*sign;
}
function walk(side,forward,distance){
  if(!scene||(!side&&!forward)||distance<=0)return;
  if(!walkable(cam.x,cam.y))[cam.x,cam.y]=nearestSafe(cam.x,cam.y);
  const input=Math.hypot(side,forward),a=cam.yaw*rad;
  const ux=(Math.sin(a)*forward+Math.cos(a)*side)/input;
  const uy=(Math.cos(a)*forward-Math.sin(a)*side)/input;
  const travel=distance*Math.min(1,input),steps=Math.ceil(travel/(scene.grid[2]*.45)),step=travel/steps;
  for(let i=0;i<steps;i++){
    const x=cam.x+ux*step,y=cam.y+uy*step;
    const freeX=walkable(x,cam.y),freeY=walkable(cam.x,y);
    if((freeX||freeY)&&walkable(x,y)){cam.x=x;cam.y=y;continue;}
    // When only the diagonal is blocked, carry on along the dominant free axis.
    let wallX=!freeX;
    if(freeX===freeY){
      const mostlyX=Math.abs(ux)>=Math.abs(uy);
      wallX=freeX?!mostlyX:mostlyX;
    }
    if(wallX)slideStep(Math.sign(ux)||1,0,uy,step);
    else slideStep(0,Math.sign(uy)||1,ux,step);
  }
  const nearest=nearestIndex(scene.route,cam);
  zone(nearest);tourTime=nearest/5;
}
function clearStick(){
  const id=joy;
  joy=null;stickPress=null;slide=null;axis={x:0,y:0};
  knob.style.transform='';stick.removeAttribute('data-active');
  if(id!==null && stick.hasPointerCapture(id))stick.releasePointerCapture(id);
}
function dragStick(e){
  const b=stickPress.bounds;
  const dx=e.clientX-b.left-b.width/2,dy=b.top+b.height/2-e.clientY;
  const distance=Math.hypot(dx,dy);
  // Retain the last heading through the centre until the pointer is released.
  if(distance<4)return;
  const reach=b.width*.33;
  const scale=Math.max(distance,reach);
  axis={x:dx/scale,y:dy/scale};
  const knobTravel=b.width*.19;
  knob.style.transform='translate('+axis.x*knobTravel+'px,'+(-axis.y*knobTravel)+'px)';
  stick.dataset.active='true';
  requestRender();
}
stick.onpointerdown=e=>{
  if(!scene||joy!==null||e.button!==0)return;
  if(e.pointerType==='touch')e.preventDefault();
  joy=e.pointerId;stick.setPointerCapture(joy);
  stickPress={bounds:stick.getBoundingClientRect(),startX:e.clientX,startY:e.clientY,
             time:performance.now(),dragged:false};
  dragStick(e);
};
stick.oncontextmenu=e=>e.preventDefault();
stick.onpointermove=e=>{
  if(joy!==e.pointerId||!stickPress)return;
  if(Math.hypot(e.clientX-stickPress.startX,e.clientY-stickPress.startY)>5)stickPress.dragged=true;
  dragStick(e);
};
function releaseStick(e){
  if(joy!==e.pointerId)return;
  if(e.type==='pointerup' && stickPress && !stickPress.dragged){
    const remaining=.16-(performance.now()-stickPress.time)/1000;
    if(remaining>0)nudge(axis.x,axis.y,remaining);
  }
  clearStick();requestRender();
}
stick.onpointerup=stick.onpointercancel=stick.onlostpointercapture=releaseStick;
function nudge(x,y,seconds){
  if(playing)lookBy(x*75*seconds,y*55*seconds);else walk(x,y,seconds*1.55);
}
stick.onclick=e=>{
  const key=e.target.closest('[data-move]')?.dataset.move;
  if(e.detail===0 && key && scene){nudge(...directions[key],.16);requestRender();}
};
const allowed=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
window.addEventListener('keydown',e=>{if(e.code==='Escape')closeGuide();if(!scene||help.open||e.metaKey||e.ctrlKey||e.altKey||!allowed.has(e.code))return;e.preventDefault();keyset.add(e.code);requestRender();});
window.addEventListener('keyup',e=>{if(keyset.delete(e.code)){slide=null;requestRender();}});window.addEventListener('blur',resetInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden){resetInput();last=0;}});
window.addEventListener('resize',requestRender);
view.addEventListener('webglcontextlost',e=>{e.preventDefault();resetInput();scene=null;message('그래픽 화면이 중단되었습니다. 복구하는 중…');});
view.addEventListener('webglcontextrestored',()=>{renderer=null;stores.clear();loading=false;openArea(area);});
openArea(100);
