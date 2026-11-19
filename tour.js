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
let stickPress=null,zoom=1;
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
  return new Promise((resolve,reject)=>{const js=document.createElement('script');js.src='assets/store-'+id+'.js?v=12';
    js.onload=()=>resolve(window.storeData[id]);js.onerror=()=>{js.remove();reject(Error('매장 자료를 열 수 없습니다. 페이지를 새로고침해 주세요.'));};document.head.append(js);});
}
const planLink=el('planFile');
const floorPlans={
  100:{url:planLink.getAttribute('href'),filename:planLink.download},
  300:{url:planLink.dataset.plan300,filename:'300㎡_매대배치_수정평면도.pdf'}
};
async function openArea(id){
  if(loading&&id===area)return;
  const token=++generation;area=id;loading=true;stopTour();resetInput();scene=null;
  document.querySelectorAll('[data-area]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.area===id)));
  planLink.href=floorPlans[id].url;
  planLink.download=floorPlans[id].filename;
  planLink.querySelector('span').textContent=id+'㎡ 배치도 PDF';
  el('sizeLabel').textContent=id+'㎡';el('where').textContent='입구';el('tour').disabled=true;
  document.querySelector('.viewer').style.backgroundImage='url(assets/entrance-'+id+'.webp?v=12)';
  view.style.visibility='hidden';message('매장을 여는 중…');closeGuide();
  try{
    if(!renderer)renderer=new StoreRenderer(view);
    if(!stores.has(id))stores.set(id,(async()=>{
      const data=await readAsset(id);
      data.blocked=Uint8Array.from(atob(data.solid),c=>c.charCodeAt(0));
      data.fixtures=Uint8Array.from(atob(data.walls),c=>c.charCodeAt(0));
      return {data,buffers:await renderer.prepare(data)};
    })().catch(e=>{stores.delete(id);throw e;}));
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
function zone(){
  // The two parallel aisles belong to different sides of the same loop.
  const [ex,ey]=scene.experienceView;
  if(Math.hypot(cam.x-ex,cam.y-ey)<.85){setStop(experienceIndex);return;}
  const t=nearestIndex(scene.route,cam)/5;
  const breaks=area===100?[7,22,33,39.5,45]:[13,32,42.5,50.5,58];
  setStop(breaks.filter(b=>t>=b).length);
}
function jump(i){
  if(!scene)return;stopTour();resetInput();
  const customView=i===experienceIndex?scene.experienceView:i===5?scene.checkoutView:null;
  const pose=customView||scene.route[Math.round(scene.stops[i]*5)];
  const [x,y,yaw,pitch]=pose;
  tourTime=i===experienceIndex?nearestIndex(scene.route,{x,y})/5:scene.stops[i];
  const [sx,sy]=nearestSafe(x,y);cam={x:sx,y:sy,yaw,pitch,zoom};setStop(i);closeGuide();requestRender();
}
function stopTour(){
  playing=false;el('tour').setAttribute('aria-pressed','false');el('playIcon').textContent='▶';el('playText').textContent='동선 따라가기';
}
function manual(){
  if(!scene)return;
  if(playing){stopTour();[cam.x,cam.y]=nearestSafe(cam.x,cam.y);}
  tourTime=nearestIndex(scene.route,cam)/5;
}
function resetInput(){keyset.clear();pointers.clear();clearStick();}
function closeGuide(){document.body.classList.remove('panel');el('mapToggle').setAttribute('aria-expanded','false');}
function requestRender(){dirty=true;if(!frame)frame=requestAnimationFrame(tick);}
function tick(ts){
  frame=0;const dt=last?Math.min((ts-last)/1000,.05):0;last=ts;
  if(!scene)return;
  if(playing){
    const end=(scene.route.length-1)/5;tourTime=Math.min(end,tourTime+dt);
    const j=Math.min(scene.route.length-2,Math.floor(tourTime*5)),f=tourTime*5-j;
    const p=scene.route[j].map((v,k)=>v+(scene.route[j+1][k]-v)*f);
    [cam.x,cam.y,cam.yaw,cam.pitch]=p;
    const cuts=area===100?[7,22,33,39.5,45]:[13,32,42.5,50.5,58];setStop(cuts.filter(b=>tourTime>=b).length);
    if(tourTime>=end){stopTour();[cam.x,cam.y]=nearestSafe(cam.x,cam.y);}
    dirty=true;
  }else if(keyset.size||axis.x||axis.y){
    const k=key=>+keyset.has(key);
    cam.yaw+=dt*85*(k('ArrowRight')-k('ArrowLeft'));
    let side=k('KeyD')-k('KeyA')+axis.x,fwd=k('KeyW')+k('ArrowUp')-k('KeyS')-k('ArrowDown')+axis.y;
    walk(side,fwd,dt*1.55);
    dirty=true;
  }
  if(dirty){renderer.draw(scene,gpu,cam);drawMap();dirty=false;}
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
  if(!scene||!map.clientWidth||!map.clientHeight)return;
  const w=map.clientWidth,h=map.clientHeight,ratio=Math.min(2,devicePixelRatio||1);
  map.width=w*ratio;map.height=h*ratio;
  const ctx=map.getContext('2d');ctx.scale(ratio,ratio);
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
  if(!walkable(x,y))return;manual();cam.x=x;cam.y=y;zone();tourTime=nearestIndex(scene.route,cam)/5;closeGuide();requestRender();
};
el('tour').onclick=()=>{
  if(!scene)return;
  if(playing){stopTour();[cam.x,cam.y]=nearestSafe(cam.x,cam.y);requestRender();return;}
  resetInput();if(tourTime>=(scene.route.length-1)/5-.02)tourTime=0;
  playing=true;el('tour').setAttribute('aria-pressed','true');el('playIcon').textContent='Ⅱ';el('playText').textContent='일시 정지';requestRender();
};
document.querySelectorAll('[data-area]').forEach(b=>b.onclick=()=>{if(+b.dataset.area!==area||!scene)openArea(+b.dataset.area);});
el('mapToggle').onclick=()=>{const show=document.body.classList.toggle('panel');el('mapToggle').setAttribute('aria-expanded',String(show));requestRender();};
el('closeGuide').onclick=closeGuide;
const compactHeader=matchMedia('(max-width:760px)');
function positionHelp(){
  const helpButton=el('help');
  if(compactHeader.matches)el('mapToggle').before(helpButton);
  else document.querySelector('header').append(helpButton);
}
positionHelp();
compactHeader.addEventListener('change',()=>{positionHelp();closeGuide();requestRender();});
const help=el('instructions');el('help').onclick=()=>{resetInput();if(playing)manual();help.showModal();};
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
  manual();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
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
    cam.yaw+=(next.x-old.x)*.22;
    cam.pitch=clamp(cam.pitch-(next.y-old.y)*.18,-75,75);
    requestRender();
  }
  pointers.set(e.pointerId,next);
};
view.onpointerup=view.onpointercancel=view.onlostpointercapture=e=>pointers.delete(e.pointerId);
const stick=el('stick'),knob=stick.querySelector('i');
const directions={up:[0,1],down:[0,-1],left:[-1,0],right:[1,0]};
function walk(side,forward,distance){
  if(!scene||(!side&&!forward))return;
  const speed=distance/Math.max(1,Math.hypot(side,forward)),a=cam.yaw*rad;
  const dx=speed*(Math.sin(a)*forward+Math.cos(a)*side);
  const dy=speed*(Math.cos(a)*forward-Math.sin(a)*side);
  // Keep even short single taps on the traversable cells of the floor plan.
  const steps=Math.max(1,Math.ceil(distance/.045));
  for(let i=0;i<steps;i++){
    if(walkable(cam.x+dx/steps,cam.y))cam.x+=dx/steps;
    if(walkable(cam.x,cam.y+dy/steps))cam.y+=dy/steps;
  }
  zone();tourTime=nearestIndex(scene.route,cam)/5;
}
function steer(x,y){
  const d=Math.max(1,Math.hypot(x,y));axis={x:x/d,y:y/d};
  knob.style.transform='translate('+axis.x*10+'px,'+(-axis.y*10)+'px)';
  if(Math.hypot(x,y)<.12){axis={x:0,y:0};knob.style.transform='';stick.removeAttribute('data-active');}
  else stick.dataset.active=Math.abs(axis.x)>Math.abs(axis.y)?(axis.x>0?'right':'left'):(axis.y>0?'up':'down');
  requestRender();
}
function clearStick(){
  const id=joy;
  joy=null;stickPress=null;axis={x:0,y:0};
  knob.style.transform='';stick.removeAttribute('data-active');
  if(id!==null && stick.hasPointerCapture(id))stick.releasePointerCapture(id);
}
function insideStick(e){
  const b=stick.getBoundingClientRect();
  return Math.hypot((e.clientX-b.left)/b.width-.5,(e.clientY-b.top)/b.height-.5)<=.5;
}
function dragStick(e){
  const b=stick.getBoundingClientRect();
  steer((e.clientX-b.left-b.width/2)/(b.width*.35),(b.top+b.height/2-e.clientY)/(b.height*.35));
}
stick.onpointerdown=e=>{
  if(!scene||joy!==null||e.button!==0)return;
  manual();joy=e.pointerId;stick.setPointerCapture(joy);
  const key=e.target.closest('[data-move]')?.dataset.move;
  stickPress={key,x:e.clientX,y:e.clientY,t:performance.now()};
  if(key)steer(...directions[key]);else dragStick(e);
};
stick.onpointermove=e=>{
  if(joy!==e.pointerId||!stickPress)return;
  if(!insideStick(e)){clearStick();return;}
  if(stickPress.key && Math.hypot(e.clientX-stickPress.x,e.clientY-stickPress.y)<5)return;
  stickPress.key=null;dragStick(e);
};
function releaseStick(e){
  if(joy!==e.pointerId)return;
  if(e.type==='pointerup' && stickPress?.key && insideStick(e)){
    const remaining=.16-(performance.now()-stickPress.t)/1000;
    if(remaining>0)walk(...directions[stickPress.key],remaining*1.55);
  }
  clearStick();requestRender();
}
stick.onpointerup=stick.onpointercancel=stick.onlostpointercapture=releaseStick;
stick.onclick=e=>{
  const key=e.target.closest('[data-move]')?.dataset.move;
  if(e.detail===0 && key && scene){manual();walk(...directions[key],.24);requestRender();}
};
const allowed=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
window.addEventListener('keydown',e=>{if(e.code==='Escape')closeGuide();if(!scene||help.open||e.metaKey||e.ctrlKey||e.altKey||!allowed.has(e.code))return;e.preventDefault();if(!e.repeat)manual();keyset.add(e.code);requestRender();});
window.addEventListener('keyup',e=>keyset.delete(e.code));window.addEventListener('blur',resetInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden){resetInput();last=0;}});
window.addEventListener('resize',requestRender);
view.addEventListener('webglcontextlost',e=>{e.preventDefault();stopTour();resetInput();scene=null;message('그래픽 화면이 중단되었습니다. 복구하는 중…');});
view.addEventListener('webglcontextrestored',()=>{renderer=null;stores.clear();loading=false;openArea(area);});
openArea(100);
